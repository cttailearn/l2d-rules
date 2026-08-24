// golden-frames.ts —— 确定性帧序列（rig 像素 golden；测试与生成脚本共用同一实现）
import { createHash } from "node:crypto";
import { L2dmPlayer, SoftwareRenderer, type L2dmModel } from "@l2dp/engine";

export interface RigFrame { note: string; hash: string }
export type ParamSetter = { set(id: string, v: number): boolean };

export function hashPixels(px: Uint8Array): string {
  return createHash("sha256").update(px).digest("hex");
}

/** 渲染静态状态一帧 → 帧哈希（同输入同输出）。 */
export function renderState(model: L2dmModel, apply: (ps: ParamSetter) => void): string {
  const player = new L2dmPlayer(model, new Map());
  const sw = new SoftwareRenderer();
  player.params.reset();
  apply(player.params);
  player.render(sw);
  const px = sw.readPixels();
  if (!px) throw new Error("软件渲染返回空像素");
  return hashPixels(px);
}

/** 完整 golden 帧序列：静态参数档 + 物理瞬态采样。 */
export function goldenRigFrames(model: L2dmModel): RigFrame[] {
  const frames: RigFrame[] = [];
  const states: [string, (ps: ParamSetter) => void][] = [
    ["rest", () => {}],
    ["blink", (ps) => { ps.set("眼闭左", 1); ps.set("眼闭右", 1); }],
    ["turn+20", (ps) => ps.set("头转向", 20)],
    ["turn-20", (ps) => ps.set("头转向", -20)],
    ["nod+15", (ps) => ps.set("头点头", 15)],
    ["mouth-open", (ps) => ps.set("嘴开", 1)],
    ["smile", (ps) => ps.set("嘴笑", 1)],
    ["brow-lift", (ps) => { ps.set("眉左升", 1); ps.set("眉右升", 1); }],
    ["sway-right", (ps) => ps.set("发摆", 1)],
    ["sway-left", (ps) => ps.set("发摆", -1)],
    ["breathe", (ps) => ps.set("呼吸", 1)],
  ];
  for (const [note, apply] of states) frames.push({ note, hash: renderState(model, apply) });

  // 物理瞬态：头转向 25°，tick 40 帧（16ms），采样若干帧
  const player = new L2dmPlayer(model, new Map());
  const sw = new SoftwareRenderer();
  player.params.reset();
  player.params.set("头转向", 25);
  const samples = new Set([5, 12, 24, 40]);
  for (let f = 1; f <= 40; f++) {
    player.tick(16);
    if (samples.has(f)) {
      player.render(sw);
      frames.push({ note: `physics-t${f}`, hash: hashPixels(sw.readPixels()!) });
    }
  }
  return frames;
}

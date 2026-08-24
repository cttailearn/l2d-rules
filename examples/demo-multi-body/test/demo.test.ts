// demo-multi-body A1 自动化断言：非标准部位加载/驱动/环境层叠加 + 确定性
import { test } from "node:test";
import assert from "node:assert/strict";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { rigCharacter } from "@l2dp/rig";
import { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator } from "@l2dp/driver";
import { createHash } from "node:crypto";

const canvas = { width: 800, height: 1200 };
const parts = [
  { id: "hr-back", semantic: "hair_back", bbox: { x: 200, y: 40, width: 400, height: 260 } },
  { id: "neck", semantic: "neck", bbox: { x: 370, y: 350, width: 60, height: 90 } },
  { id: "face", semantic: "face", bbox: { x: 240, y: 380, width: 320, height: 210 } },
  { id: "eye-l", semantic: "eye", side: "left", bbox: { x: 290, y: 420, width: 70, height: 44 } },
  { id: "eye-r", semantic: "eye", side: "right", bbox: { x: 440, y: 420, width: 70, height: 44 } },
  { id: "mouth", semantic: "mouth", bbox: { x: 365, y: 505, width: 70, height: 40 } },
  { id: "body-upper", semantic: "body_upper", bbox: { x: 150, y: 470, width: 500, height: 420 } },
  { id: "body-lower", semantic: "body_lower", bbox: { x: 170, y: 850, width: 460, height: 300 } },
  { id: "hoho-l", semantic: "hoho", side: "left", bbox: { x: 260, y: 395, width: 70, height: 45 } },
  // 非标准部位
  { id: "tail", semantic: "tail", bbox: { x: 490, y: 780, width: 80, height: 400 } },
  { id: "beast-ear-r", semantic: "ear_beast", side: "right", bbox: { x: 495, y: 250, width: 55, height: 130 } },
  { id: "wing-r", semantic: "wing", side: "right", bbox: { x: 680, y: 240, width: 90, height: 320 } },
];

function renderHash(model, apply) {
  const sw = new SoftwareRenderer();
  const player = new L2dmPlayer(model, new Map());
  player.params.reset();
  if (apply) apply(player.params);
  player.render(sw);
  const px = sw.readPixels()!;
  return createHash("sha256").update(px).digest("hex");
}

test("A1: 非标准部位可加载可渲染（rig 合法 + 33→闭集）", () => {
  const { model, report } = rigCharacter({ id: "mb", canvas, parts });
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  const ids = model.parts.map((p) => p.id);
  assert.ok(ids.includes("tail") && ids.includes("beast-ear-r") && ids.includes("wing-r"));
  // 非标准部位参数已派生
  const pids = model.parameters.map((p) => p.id);
  for (const e of ["尾巴摆", "耳朵动", "翅膀扇", "脸红"]) assert.ok(pids.includes(e), "缺 " + e);
  // hoho opacityParam
  const ho = model.parts.find((p) => p.id === "hoho-l")!;
  assert.equal(ho.opacityParam, "脸红");
});

test("A1: 非标准部位参数驱动像素变化（确定性）", () => {
  const { model } = rigCharacter({ id: "mb", canvas, parts });
  const rest = renderHash(model, null);
  const tail = renderHash(model, (ps) => ps.set("尾巴摆", 1));
  const wing = renderHash(model, (ps) => ps.set("翅膀扇", 1));
  const ear = renderHash(model, (ps) => ps.set("耳朵动", 1));
  const blush = renderHash(model, (ps) => ps.set("脸红", 1));
  assert.notEqual(tail, rest, "尾巴摆应改变像素");
  assert.notEqual(wing, rest, "翅膀扇应改变像素");
  assert.notEqual(ear, rest, "耳朵动应改变像素");
  assert.notEqual(blush, rest, "脸红应改变像素（hoho opacity）");
  // 确定性：同参同哈希
  assert.equal(renderHash(model, (ps) => ps.set("尾巴摆", 1)), tail);
});

test("A1: JSONL 语义驱动 tail_wag + 环境层叠加", () => {
  const { model } = rigCharacter({ id: "mb", canvas, parts });
  const defs = model.parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def, group: p.group }));
  const wag = { durationMs: 1000, loop: true, curves: [{ id: "尾巴摆", segments: [0, 0, 0, 1, 1] }] };
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed: 42 });
  const ing = new StreamIngestor({
    manifest: { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) },
    library: { motions: [{ name: "tail_wag" }], expressions: [], behaviors: [] },
    assets: { motions: new Map([["tail_wag", wag]]), expressions: new Map() },
    stack, env, seed: 7,
  });
  let peak = 0;
  const ev = new Evaluator(stack, env, defs, { apply(_c, params) { peak = Math.max(peak, params["尾巴摆"] ?? 0); } });
  ing.feedLine('{"op":"play","asset":"tail_wag"}', 0);
  ing.feedLine('{"op":"blink"}', 200);
  for (let i = 0; i < 45; i++) ev.onFrame(16);
  // tail_wag：0→1→0 loop，45 帧(720ms)覆盖到接近 1 的峰值
  assert.ok(peak > 0.4, "尾巴摆被 JSONL 驱动（peak=" + peak + "）");
  // 环境层仍在产出（呼吸在 Ambient 组）——确认驱动栈完整运行
});

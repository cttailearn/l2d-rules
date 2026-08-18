import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemoScene } from "../src/scene.ts";

const modelJson = readFileSync(new URL("../public/demo.l2dm", import.meta.url), "utf8");

// 基线帧：无指令，环境层纯驱动
function baseline(): Uint8Array {
  const s = createDemoScene(modelJson);
  s.onFrame(0);
  return s.renderer.readPixels()!.slice();
}

test("M6 demo: play → 微笑驱动 → 参数动 + 像素变", () => {
  const s = createDemoScene(modelJson);
  const base = baseline();
  const r = s.ingest('{"op":"play","asset":"微笑点头"}', 0);
  assert.equal(r.ok, true, r.reason);
  for (let i = 0; i < 40; i++) s.onFrame(16); // t=640ms → 微笑≈0.64
  assert.ok(s.params()["微笑"]! > 0.5, `微笑≈0.64，得 ${s.params()["微笑"]}`);
  assert.ok(s.pixelsChanged(base), "微笑形变应改变像素");
});

test("M6 demo: set override 最高——压过 play 曲线", () => {
  const s = createDemoScene(modelJson);
  s.ingest('{"op":"play","asset":"微笑点头"}', 0);
  s.ingest('{"op":"set","sem":"微笑","value":0.2}', 100);
  for (let i = 0; i < 40; i++) s.onFrame(16);
  assert.equal(s.params()["微笑"], 0.2, "override=0.2 压过曲线");
});

test("M6 demo: 坏行隔离——坏行 reason 返回，好行继续生效", () => {
  const s = createDemoScene(modelJson);
  const bad = s.ingest('{"op":"play","asset":"不存在的动作"}', 0);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "ASSET_NOT_FOUND");
  const good = s.ingest('{"op":"play","asset":"尾巴摇"}', 0);
  assert.equal(good.ok, true);
  for (let i = 0; i < 40; i++) s.onFrame(16);
  assert.ok(s.params()["尾巴摆"]! > 0, "好行照常生效");
});

test("M6 demo: 环境层恒动——无指令也持续变化（呼吸参数由 env 驱动）", () => {
  const s = createDemoScene(modelJson);
  const a = s.renderer.readPixels()!.slice();
  for (let i = 0; i < 30; i++) s.onFrame(16);
  assert.ok(s.pixelsChanged(a), "环境层应让画面恒动");
});

test("M6 demo: emote 调制不崩 + 确定性——同 seed 同轨迹", () => {
  const run = (): number[] => {
    const s = createDemoScene(modelJson, 7);
    s.ingest('{"op":"emote","emote":{"valence":-0.6,"arousal":0.8}}', 0);
    s.ingest('{"op":"play","asset":"微笑点头"}', 0);
    const vals: number[] = [];
    for (let i = 0; i < 50; i++) {
      s.onFrame(16);
      vals.push(s.params()["微笑"]!);
    }
    return vals;
  };
  assert.deepEqual(run(), run());
});

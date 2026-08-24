// demo-env（A2）自动化断言：环境层恒动 + emote 调制 + 确定性
import { test } from "node:test";
import assert from "node:assert/strict";
import { LayerStack, EnvironmentLayer, Evaluator } from "@l2dp/driver";

const defs = [
  { id: "呼吸", min: 0, max: 1, def: 0.5, group: "Ambient" },
  { id: "眨眼", min: 0, max: 1, def: 0, group: "EyeBlink" },
  { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
  { id: "身转", min: -10, max: 10, def: 0, group: "Body" },
  { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
];

function run(seed, emote, frames = 750) {
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed });
  if (emote) env.setEmote(emote);
  const stats = { 呼吸: {min:Infinity,max:-Infinity,sum:0,n:0}, 眨眼: {max:-Infinity,blinkHits:0}, 头转向: {min:Infinity,max:-Infinity,zero:0}, 身转: {min:Infinity,max:-Infinity} };
  const ev = new Evaluator(stack, env, defs, { apply(_c, params) {
    for (const k of Object.keys(stats)) {
      const s = stats[k]; const v = params[k] ?? 0;
      s.min = Math.min(s.min, v); s.max = Math.max(s.max, v);
      s.sum += v; s.n = (s.n ?? 0) + 1;
      if (k === "眨眼" && v > 0.25) s.blinkHits++;
      if (k === "头转向" && Math.abs(v) < 1e-6) s.zero++;
    }
  } });
  for (let i = 0; i < frames; i++) ev.onFrame(16);
  return stats;
}

test("A2: 环境层恒动——呼吸波动/眨眼触发/视线微动/重心漂移", () => {
  const s = run(7);
  assert.ok(s.呼吸.max > s.呼吸.min, "呼吸必须有波动（max>min）");
  assert.equal(s.头转向.zero, 0, "视线恒有微动，不允许静止帧（固视微动）");
  assert.ok(s.眨眼.blinkHits > 0, "随机眨眼发生（>0 帧）");
  assert.ok(s.呼吸.min > 0, "呼吸基值 > 0");
  // 环境层不写 Custom 组（微笑保持 0）
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed: 7 });
  let smilePeak = 0;
  const ev = new Evaluator(stack, env, defs, { apply(_c, p) { smilePeak = Math.max(smilePeak, p["微笑"] ?? 0); } });
  for (let i = 0; i < 100; i++) ev.onFrame(16);
  assert.equal(smilePeak, 0, "环境层不写 Custom 组参数（微笑恒 0）");
});

test("A2: emote 调制——arousal↑ 呼吸幅度↑、valence↓ 呼吸下探更深", () => {
  const calm = run(7, { valence: 0.7, arousal: 0.1 });
  const excited = run(7, { valence: 0.6, arousal: 0.9 });
  const sad = run(7, { valence: -0.8, arousal: 0.3 });
  assert.ok(excited.呼吸.max > calm.呼吸.max, "兴奋呼吸幅度>平静");
  assert.ok(sad.呼吸.min < calm.呼吸.min, "低落呼吸下探<平静");
});

test("A2: 确定性——同 (seed, emote) 同轨迹", () => {
  const a = run(42, null, 200);
  const b = run(42, null, 200);
  const ea = run(9, { valence: 0.5, arousal: 0.6 }, 300);
  const eb = run(9, { valence: 0.5, arousal: 0.6 }, 300);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "同 seed 同输出");
  assert.equal(JSON.stringify(ea), JSON.stringify(eb), "emote 下同 seed 同输出");
});
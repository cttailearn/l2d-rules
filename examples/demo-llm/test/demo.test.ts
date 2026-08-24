// demo-llm（A4）自动化断言：两跳 + hop 指标 + mock 确定性（无 key CI 可跑）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BehaviorIndex, DriverEngine, MockProvider,
  StreamIngestor, LayerStack, EnvironmentLayer,
} from "@l2dp/driver";

const defs = [
  { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "尾巴摆", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
];
const manifest = { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) };
const library = { motions: [{ name: "微笑点头" }, { name: "尾巴摇" }, { name: "害羞低头" }], expressions: [], behaviors: [] };
const assets = {
  motions: new Map([
    ["微笑点头", { durationMs: 1000, loop: true, curves: [{ id: "微笑", segments: [0, 0, 0, 1, 1] }] }],
    ["尾巴摇", { durationMs: 1000, loop: true, curves: [{ id: "尾巴摆", segments: [0, 0, 0, 1, 1] }] }],
    ["害羞低头", { durationMs: 800, loop: false, curves: [{ id: "头转向", segments: [0, 0, 0, 1, -20] }] }],
  ]),
  expressions: new Map(),
};

function makeEngine() {
  const index = new BehaviorIndex();
  index.register({ id: "greeting", events: ["user_text"], kinds: ["greeting"], priority: 10, lines: ['{"op":"play","asset":"微笑点头"}'], match: (e) => e.type === "user_text" && /你好|hello/i.test(e.text) });
  index.register({ id: "tailwag", events: ["user_text"], kinds: ["wag"], priority: 9, lines: ['{"op":"play","asset":"尾巴摇"}'], match: (e) => e.type === "user_text" && /尾巴|摇/.test(e.text) });
  const provider = new MockProvider();
  const ing = new StreamIngestor({ manifest, library, assets, stack: new LayerStack(defs), env: new EnvironmentLayer(defs, { seed: 7 }), seed: 7 });
  const engine = new DriverEngine({ index, provider, ing });
  return { engine, provider };
}

test("A4: 第一跳——本地规则命中不进 LLM（hop=1，llmCalls 不增）", async () => {
  const { engine, provider } = makeEngine();
  const r = await engine.dispatch({ type: "user_text", text: "你好呀！" }, {});
  assert.equal(r.hop, 1);
  assert.equal(r.behaviorId, "greeting");
  assert.equal(provider.calls, 0, "第一跳不进 LLM");
  assert.equal(engine.llmCalls, 0);
});

test("A4: 第二跳——无本地规则 → mock LLM 决策（hop=2，注入生效）", async () => {
  const { engine, provider } = makeEngine();
  const r = await engine.dispatch({ type: "user_text", text: "随便聊聊天气" }, {});
  assert.equal(r.hop, 2);
  assert.equal(r.lines.length, 2, "mock 决策产出 2 行");
  assert.equal(provider.calls, 1);
  assert.equal(engine.llmCalls, 1);
  // audit 记录第二跳行
  assert.ok(engine.audit.some((a) => a.line.includes("play")), "audit 记入");
});

test("A4: mock 确定性——同输入同输出两跳行为一致", async () => {
  const a = makeEngine();
  const b = makeEngine();
  const ra = await a.engine.dispatch({ type: "user_text", text: "聊聊天" }, {});
  const rb = await b.engine.dispatch({ type: "user_text", text: "聊聊天" }, {});
  assert.deepEqual(ra, rb, "mock 决策同输入同输出");
});
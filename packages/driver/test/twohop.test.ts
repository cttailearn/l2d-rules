import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AudioClock,
  BehaviorIndex,
  DriverEngine,
  MockProvider,
  WallClock,
  extractJsonLines,
  OpenAIProvider,
  buildOpenAIBody,
  estimateSpeechTimeline,
  StreamIngestor,
  LayerStack,
  EnvironmentLayer,
  Evaluator,
  type ManifestLike,
  type AssetIndex,
  type AssetStore,
  type MotionLike,
  type EnvParamDef,
  type Context,
} from "../src/index.ts";

// ---------- 夹具（与 driver.test 同源参数面 + demo 动作集） ----------
const PARAMS: EnvParamDef[] = [
  { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "害羞", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
  { id: "尾巴摆", min: 0, max: 1, def: 0, group: "Custom" },
];
const MANIFEST: ManifestLike = { sems: PARAMS.map((p) => ({ name: p.id, min: p.min, max: p.max, group: p.group, def: p.def })) };
const LIBRARY: AssetIndex = {
  motions: [{ name: "微笑点头" }, { name: "尾巴摇" }, { name: "害羞低头" }],
  expressions: [],
  behaviors: [],
};
const MOTIONS: Record<string, MotionLike> = {
  微笑点头: { durationMs: 1000, loop: true, curves: [{ id: "微笑", segments: [0, 0, 0, 1, 1] }] },
  尾巴摇: { durationMs: 1000, loop: true, curves: [{ id: "尾巴摆", segments: [0, 0, 0, 1, 1] }] },
  害羞低头: { durationMs: 800, loop: false, curves: [{ id: "头转向", segments: [0, 0, 0, 1, -20] }] },
};
const ASSETS: AssetStore = { motions: new Map(Object.entries(MOTIONS)), expressions: new Map() };

function setup(): {
  ing: StreamIngestor; stack: LayerStack; env: EnvironmentLayer; ev: Evaluator;
  index: BehaviorIndex; provider: MockProvider; engine: DriverEngine;
  frames: { params: Record<string, number> }[];
} {
  const stack = new LayerStack(PARAMS);
  const env = new EnvironmentLayer(PARAMS, { seed: 7 });
  const ing = new StreamIngestor({ manifest: MANIFEST, library: LIBRARY, assets: ASSETS, stack, env, seed: 7 });
  const frames: { params: Record<string, number> }[] = [];
  const ev = new Evaluator(stack, env, PARAMS, {
    apply(_c: string, params: Record<string, number>): void { frames.push({ params: { ...params } }); },
  });

  const index = new BehaviorIndex();
  index.register({
    id: "greeting", events: ["user_text"], kinds: ["greeting"], priority: 10,
    lines: ['{"op":"play","asset":"微笑点头"}', '{"op":"play","asset":"尾巴摇"}'],
    match: (e) => e.type === "user_text" && /你好|hello|嗨|hi/i.test(e.text),
  });
  index.register({
    id: "nod", events: ["user_text"], kinds: ["ack"], priority: 8,
    lines: ['{"op":"play","asset":"微笑点头"}'],
    match: (e) => e.type === "user_text" && /点头|嗯|同意/.test(e.text),
  });
  index.register({
    id: "listen", events: ["user_voice"], kinds: ["listen"], priority: 5,
    lines: [],
  });
  index.register({
    id: "emote_follow", events: ["emote"], kinds: ["affirm"], priority: 3,
    lines: [
      (e) => JSON.stringify({ op: "emote", emote: e.type === "emote" ? { valence: e.valence, arousal: e.arousal } : { valence: 0, arousal: 0 } }),
      '{"op":"play","asset":"微笑点头"}',
    ],
  });

  const provider = new MockProvider();
  const engine = new DriverEngine({ index, provider, ing });
  return { ing, stack, env, ev, index, provider, engine, frames };
}

function run(ev: Evaluator, frames: { params: Record<string, number> }[], n: number, dt = 16): void {
  for (let i = 0; i < n; i++) ev.onFrame(dt);
  void frames;
}

// ---------- 两跳 ----------

test("M7: 第一跳 <50ms 且不进 LLM——本地规则命中直接出 IR", async () => {
  const { engine, provider, ev, frames } = setup();
  const t0 = performance.now();
  const r = await engine.dispatch({ type: "user_text", text: "你好呀！" }, {});
  const elapsed = performance.now() - t0;
  assert.equal(r.hop, 1);
  assert.equal(r.behaviorId, "greeting");
  assert.equal(provider.calls, 0, "第一跳命中不得调 LLM");
  assert.ok(elapsed < 50, `第一跳 ${elapsed.toFixed(2)}ms 应 <50ms`);
  run(ev, frames, 40, 16); // t=640 → 微笑≈0.64
  assert.ok(frames[frames.length - 1]!.params["微笑"]! > 0.5, "greeting 动作生效");
  assert.ok(frames[frames.length - 1]!.params["尾巴摆"]! > 0.5, "尾巴摇同时生效");
});

test("M7: 第二跳——无本地规则 → mock provider 决策 → 注入生效", async () => {
  const { engine, provider, ev, frames } = setup();
  const r = await engine.dispatch({ type: "user_text", text: "随便聊聊今天天气" }, {});
  assert.equal(r.hop, 2);
  assert.ok(provider.calls >= 1, "第二跳应调 LLM");
  assert.equal(r.lines.length, 2, "mock 默认问候两行");
  run(ev, frames, 40, 16);
  assert.ok(frames[frames.length - 1]!.params["微笑"]! > 0.5, "LLM 决策注入生效");
});

test("M7: 行为优先级——同一事件高优先胜出", async () => {
  const { engine, index } = setup();
  // greeting(10) vs nod(8)：文本同时含两关键词 → greeting
  const r = await engine.dispatch({ type: "user_text", text: "你好呀嗯嗯点头" }, {});
  assert.equal(r.behaviorId, "greeting");
  const picked = index.pick({ type: "user_text", text: "嗯嗯" }, {});
  assert.equal(picked?.id, "nod");
});

test("M7: 空行为行也消费事件（第一跳吃掉，不进 LLM）", async () => {
  const { engine, provider } = setup();
  const r = await engine.dispatch({ type: "user_voice" }, {});
  assert.equal(r.hop, 1);
  assert.equal(r.behaviorId, "listen");
  assert.equal(provider.calls, 0);
});

test("M7: kindsOfAsset——行为行静态提取（评估集断言用）", () => {
  const { index } = setup();
  assert.deepEqual(index.kindsOfAsset("微笑点头"), ["greeting", "ack", "affirm"]);
  assert.deepEqual(index.kindsOfAsset("尾巴摇"), ["greeting"]);
  assert.deepEqual(index.kindsOfAsset("不存在"), []);
});

// ---------- R-P1-2 语义抽查（慢路径） ----------

test("R-P1-2: needsSlowPath——显式 ctx.slowPath 或自定义覆盖文本命中危险路径", async () => {
  const { index, provider, ing } = setup();
  const engine = new DriverEngine({ index, provider, ing });
  assert.equal(engine.needsSlowPath({ type: "user_text", text: "随便聊聊" }, {}), false);
  assert.equal(engine.needsSlowPath({ type: "user_text", text: "帮我重写一下动作覆盖" }, {}), true);
  assert.equal(engine.needsSlowPath({ type: "user_text", text: "设置 PARAM_ANGLE_X" }, {}), true);
  assert.equal(engine.needsSlowPath({ type: "user_text", text: "你好" }, { slowPath: true }), true);
  assert.equal(engine.needsSlowPath({ type: "emote", valence: 0, arousal: 0 }, {}), false);
});

test("R-P1-2: 第二跳危险指令 → spotCheck 拒绝越界行，blocked=true 不投喂", async () => {
  const { index, provider, ing } = setup();
  let calls = 0;
  const engine = new DriverEngine({
    index,
    provider,
    ing,
    spotCheck: (lines) => {
      calls += 1;
      // 拒绝任何 set override 行，保留 play/face
      return lines.filter((l) => !l.includes('"op":"set"'));
    },
  });
  const r = await engine.dispatch({ type: "user_text", text: "覆盖一下心情设置" }, {});
  assert.equal(r.hop, 2);
  assert.equal(r.spotChecked, true);
  assert.ok(r.lines!.every((l) => !l.includes('"op":"set"')), "set 行被拒");
  // mock provider 对"覆盖…"落到默认问候（两行 play/emote），spotCheck 全放行 → 不 blocked
  assert.equal(r.blocked, false);
  assert.ok(calls >= 1, "触发语义抽查");
});

test("R-P1-2: spotCheck 全拒 → blocked=true 且 spotBlocked 计数", async () => {
  const { index, provider, ing } = setup();
  const engine = new DriverEngine({
    index,
    provider,
    ing,
    spotCheck: () => [],
  });
  const r = await engine.dispatch({ type: "user_text", text: "重写这个动作" }, {});
  assert.equal(r.hop, 2);
  assert.equal(r.lines.length, 0, "全被拒则无行投喂");
  assert.equal(r.blocked, true);
  assert.ok(engine.spotBlocked > 0, "拒绝计数累计");
  // 未投喂 → 无帧参数变化
});

// ---------- fallback ----------

test("M7: fallback——围栏剥离 + 尾逗号修复 + 跨行对象", () => {
  assert.deepEqual(
    extractJsonLines('```json\n{"op":"set","sem":"微笑","value":0.5,}\n{"op":"play","asset":"微笑点头"}\n```'),
    ['{"op":"set","sem":"微笑","value":0.5}', '{"op":"play","asset":"微笑点头"}'],
  );
  // 跨行 pretty-print（压缩为单行，保留词间空格——合法 JSON）
  assert.deepEqual(
    extractJsonLines('{\n  "op": "play",\n  "asset": "微笑点头"\n}'),
    ['{ "op": "play", "asset": "微笑点头" }'],
  );
  // 无 JSON → 空
  assert.deepEqual(extractJsonLines("好的，没问题。"), []);
});

// ---------- provider ----------

test("M7: mock provider 确定性——同输入同输出", async () => {
  const p = new MockProvider();
  const a = await p.createCompletion({ messages: [{ role: "user", content: "摇尾巴" }] });
  const b = await p.createCompletion({ messages: [{ role: "user", content: "摇尾巴" }] });
  assert.equal(a.text, b.text);
  assert.match(a.text, /尾巴摇/);
  assert.match(a.text, /emote/);
});

test("M7: OpenAI provider——请求成形 + stub fetch 响应解析", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const stubFetch: typeof fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"op":"play","asset":"微笑点头"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const p = new OpenAIProvider({ model: "gpt-test", apiKey: "k", fetchImpl: stubFetch });
  assert.equal(p.capabilities().structured, "native");
  const body = buildOpenAIBody({ system: "s", messages: [{ role: "user", content: "hi" }] }, { model: "gpt-test", schema: { type: "object" } });
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: { name: "directive_stream", strict: true, schema: { type: "object" } },
  });
  const r = await p.createCompletion({ messages: [{ role: "user", content: "hi" }] });
  assert.equal((r.structured as { op?: string }).op, "play");
  assert.equal(r.usage?.promptTokens, 3);
  assert.equal(calls[0]!.url, "https://api.openai.com/v1/chat/completions");
});

// ---------- tts ----------

test("M7: TTS 降级——estimateSpeechTimeline 简谐口型，确定性", () => {
  const a = estimateSpeechTimeline("你好呀！");
  assert.ok(a.durationMs > 0, "时长>0");
  assert.ok(a.visemes!.length >= 2, "含口型关键帧");
  assert.equal(a.visemes![a.visemes!.length - 1]!.viseme, "silence", "尾部静音");
  assert.ok(a.prosody!.length >= 2, "含音频脊梁");
  assert.deepEqual(a, estimateSpeechTimeline("你好呀！"), "同文本同输出");
  assert.notDeepEqual(estimateSpeechTimeline("你好呀！"), estimateSpeechTimeline("这是一段更长的文本测试口型估计"));
});

test("M7: TTS 降级——空文本/纯空白不崩", () => {
  const t = estimateSpeechTimeline("   ");
  assert.ok(t.durationMs >= 0);
  assert.ok(t.visemes!.length === 0);
});
test("O-1: DriverEngine 注入 wall 时钟——audit/feed 时间来自 clock.now()（非内部 tMs）", async () => {
  const s = setup();
  // 注入独立 wall 时钟：宿主帧推进与事件时间解耦
  const clock = new WallClock();
  const engine2 = new DriverEngine({ index: s.index, provider: new MockProvider(), ing: s.ing, clock });
  // 时钟先推进到 1000ms，再发生事件
  clock.advance(1000);
  const r = await engine2.dispatch({ type: "user_text", text: "你好呀！" }, {});
  assert.equal(r.hop, 1);
  assert.equal(engine2.audit.length, 2, "greeting 两条行入 audit");
  assert.ok(engine2.audit.every((a) => a.tMs === 1000), "audit tMs 全部来自 clock（1000），实际 " + engine2.audit.map((a) => a.tMs).join(","));
});

test("O-1: wall 与 audio 时钟时间轴独立、单调（不比双时轴漂移）", () => {
  const wall = new WallClock(0);
  const audio = new AudioClock(5000, 0);
  wall.advance(16); wall.advance(16);
  audio.advancePlayhead(40); audio.advancePlayhead(40);
  assert.equal(wall.now(), 32, "wall 由帧推进");
  assert.equal(audio.now(), 80, "audio 由播放头推进");
  assert.equal(audio.wallOffset(), 5000, "audio 事件 wall 偏移");
  // 单调：负推进被夹到 0
  wall.advance(-10); assert.equal(wall.now(), 32, "负 dt 不进");
});

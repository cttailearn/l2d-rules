import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StreamIngestor,
  LayerStack,
  EnvironmentLayer,
  Evaluator,
  type ManifestLike,
  type AssetIndex,
  type AssetStore,
  type MotionLike,
  type EnvParamDef,
  type ParameterSink,
} from "../src/index.ts";

// ---------- 夹具：参数 / manifest / 资产 ----------
// 组设计：微笑/害羞=Custom（动作+表情+override），头转向=Head（env 视线）、
// 呼吸=Ambient（env 呼吸）、眨眼=EyeBlink（env 眨眼）、重心=Body（env 重心）
const PARAMS: EnvParamDef[] = [
  { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "害羞", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
  { id: "呼吸", min: 0, max: 1, def: 0.5, group: "Ambient" },
  { id: "眨眼", min: 0, max: 1, def: 0, group: "EyeBlink" },
  { id: "重心", min: -1, max: 1, def: 0, group: "Body" },
];

const MANIFEST: ManifestLike = {
  sems: PARAMS.map((p) => ({ name: p.id, min: p.min, max: p.max, group: p.group, def: p.def })),
};

const LIBRARY: AssetIndex = {
  motions: [{ name: "微笑点头" }, { name: "挥手" }, { name: "短动作" }, { name: "害羞短动作" }],
  expressions: [{ name: "开心" }],
  behaviors: [],
};

// 微笑 0→1 线性 1s，loop（t=500 → 0.5；t=1500 循环回 0.5）
const M_SMILE: MotionLike = {
  durationMs: 1000, loop: true,
  curves: [{ id: "微笑", segments: [0, 0, 0, 1, 1] }],
};
// 害羞 0→1 线性 1s，loop
const M_SHY: MotionLike = {
  durationMs: 1000, loop: true,
  curves: [{ id: "害羞", segments: [0, 0, 0, 1, 1] }],
};
// 微笑 0→1 线性 500ms，非 loop（结束自动释放）
const M_SHORT: MotionLike = {
  durationMs: 500, loop: false,
  curves: [{ id: "微笑", segments: [0, 0, 0, 1, 1] }],
};
// 害羞 0→1 线性 500ms，非 loop（supersede 测试的顶替动作：不碰 微笑）
const M_SHY_SHORT: MotionLike = {
  durationMs: 500, loop: false,
  curves: [{ id: "害羞", segments: [0, 0, 0, 1, 1] }],
};

const ASSETS: AssetStore = {
  motions: new Map([
    ["微笑点头", M_SMILE],
    ["挥手", M_SHY],
    ["短动作", M_SHORT],
    ["害羞短动作", M_SHY_SHORT],
  ]),
  expressions: new Map([
    ["开心", { parameters: [{ id: "害羞", value: 0.2, blend: "Add" }] }],
  ]),
};

interface Frame {
  t: number;
  params: Record<string, number>;
}

function setup(seed = 7): {
  stack: LayerStack; env: EnvironmentLayer; ing: StreamIngestor; ev: Evaluator; sink: { frames: Frame[] };
} {
  const stack = new LayerStack(PARAMS);
  const env = new EnvironmentLayer(PARAMS, { seed });
  const ing = new StreamIngestor({ manifest: MANIFEST, library: LIBRARY, assets: ASSETS, stack, env, seed });
  const sink: { frames: Frame[] } & ParameterSink = {
    frames: [],
    apply(_character: string, params: Record<string, number>, tMs: number): void {
      this.frames.push({ t: tMs, params: { ...params } });
    },
  };
  const ev = new Evaluator(stack, env, PARAMS, sink);
  return { stack, env, ing, ev, sink };
}

function runFrames(ev: Evaluator, sink: { frames: Frame[] }, n: number, dt = 16): void {
  for (let i = 0; i < n; i++) ev.onFrame(dt);
  void sink;
}

// ---------- M5 DoD 测试 ----------

test("M5: JSONL 逐行生效——play 驱动参数按时序采样", () => {
  const { ing, ev, sink } = setup();
  assert.equal(ing.feedLine('{"op":"play","asset":"微笑点头"}', 0).skipped.length, 0);
  runFrames(ev, sink, 32, 16); // t=512ms
  let p = sink.frames[sink.frames.length - 1]!.params["微笑"]!;
  assert.ok(Math.abs(p - 0.512) < 0.02, `t=512 微笑应≈0.512，得 ${p}`);
  runFrames(ev, sink, 62, 16); // t=1504ms（loop 环绕 504ms）
  p = sink.frames[sink.frames.length - 1]!.params["微笑"]!;
  assert.ok(Math.abs(p - 0.504) < 0.02, `loop 环绕后 t=504 微笑应≈0.504，得 ${p}`);
});

test("M5: 坏行隔离——各类坏行 skipped+reason，好行不受阻", () => {
  const { ing } = setup();
  const cases: [string, string][] = [
    ["{bad json", "JSON_PARSE"],
    ['{"op":"fly"}', "OP"],
    ['{"op":"play"}', "REQUIRED"],                       // 缺 asset
    ['{"op":"play","asset":"微笑点头","value":1}', "FORBIDDEN"], // play 禁 value
    ['{"op":"set","sem":"不存在","value":0.5}', "SEM_NOT_FOUND"],
    ['{"op":"set","sem":"微笑","value":5}', "RANGE"],    // 微笑范围 0..1
    ['{"op":"play","asset":"微笑点头","at":"+甲"}', "STREAM_DEP"], // 流式禁 +id
  ];
  for (const [line, reason] of cases) {
    const r = ing.feedLine(line, 0);
    assert.equal(r.applied.length, 0, line);
    assert.equal(r.skipped[0]?.reason, reason, line);
  }
  // 好行照常生效（坏行不阻塞流）
  const ok = ing.feedLine('{"op":"play","asset":"微笑点头"}', 0);
  assert.equal(ok.skipped.length, 0);
  assert.equal(ok.applied.length, 1);

});

test("M5: 分层合成分量正确——play+face+set 各层分量同时在场", () => {
  const { ing, ev, sink } = setup();
  ing.feedLine('{"op":"play","asset":"微笑点头"}', 0);   // 动作层：微笑
  ing.feedLine('{"op":"face","expression":"开心"}', 0);  // 表达层：害羞 Add 0.2
  ing.feedLine('{"op":"set","sem":"头转向","value":15}', 0); // override 层：头转向=15
  runFrames(ev, sink, 32, 16); // t=512ms
  const p = sink.frames[sink.frames.length - 1]!.params;
  assert.ok(Math.abs(p["微笑"]! - 0.512) < 0.02, `微笑来自动作层≈0.512，得 ${p["微笑"]}`);
  assert.ok(Math.abs(p["害羞"]! - 0.2) < 0.02, `害羞来自表达层≈0.2，得 ${p["害羞"]}`);
  assert.equal(p["头转向"], 15, "头转向来自 override 层=15");
});

test("M5: override 最高——set 压过 play 曲线与环境层", () => {
  const { ing, ev, sink } = setup();
  ing.feedLine('{"op":"set","sem":"微笑","value":0.8}', 0);
  ing.feedLine('{"op":"play","asset":"微笑点头"}', 0);   // 曲线驱动微笑
  ing.feedLine('{"op":"set","sem":"呼吸","value":0.9}', 0); // 压过 env 呼吸
  runFrames(ev, sink, 32, 16);
  const p = sink.frames[sink.frames.length - 1]!.params;
  assert.equal(p["微笑"], 0.8, "override 微笑=0.8（play 曲线失效）");
  assert.equal(p["呼吸"], 0.9, "override 呼吸=0.9（env 正弦失效）");
});

test("M5: 环境层恒动——呼吸/视线/重心持续变化，不写 Custom", () => {
  const { ev, sink } = setup();
  runFrames(ev, sink, 20, 16); // 无任何指令，纯环境层
  const frames = sink.frames;
  const breath = frames.map((f) => f.params["呼吸"]!);
  const gaze = frames.map((f) => f.params["头转向"]!);
  const weight = frames.map((f) => f.params["重心"]!);
  assert.ok(new Set(breath).size > 5, "呼吸应持续变化（恒动）");
  assert.ok(new Set(gaze).size > 5, "视线应持续微动（眼睛不许静止）");
  assert.ok(new Set(weight).size > 2, "重心应持续微移");
  // 环境层不写 Custom 组
  for (const f of frames) {
    assert.equal(f.params["微笑"], 0, "Custom 参数微笑应保持默认 0（env 不写）");
    assert.equal(f.params["害羞"], 0, "Custom 参数害羞应保持默认 0（env 不写）");
  }
  // 眨眼：默认 2-5s 种子间隔内必然出现
  runFrames(ev, sink, 300, 16); // 累计 ~5s
  assert.ok(sink.frames.some((f) => f.params["眨眼"]! > 0), "5s 内应出现眨眼");
});

test("M5: 确定性——同 (流, seed, dt 序列) → 逐帧轨迹一致", () => {
  const run = (): Frame[] => {
    const s = setup(42);
    s.ing.feedLine('{"op":"play","asset":"微笑点头"}', 0);
    s.ing.feedLine('{"op":"emote","emote":{"valence":-0.5,"arousal":0.6}}', 100);
    s.ing.feedLine('{"op":"set","sem":"头转向","value":-10}', 200);
    const frames: Frame[] = [];
    for (let i = 0; i < 60; i++) s.ev.onFrame(16);
    frames.push(...s.sink.frames);
    for (let i = 0; i < 40; i++) s.ev.onFrame(33);
    frames.push(...s.sink.frames);
    return frames;
  };
  const a = run();
  const b = run();
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(a[i], b[i], `第 ${i} 帧轨迹不一致`);
  }
});

// ---------- 环境层细节 ----------

test("M5: emote 调制——arousal↑/valence↓ 改变呼吸贡献", () => {
  const breath = (withEmote: boolean): number[] => {
    const s = setup(9);
    if (withEmote) s.env.setEmote({ valence: -0.8, arousal: 0.9 });
    const out: number[] = [];
    for (let i = 0; i < 30; i++) out.push(s.env.tick(i * 16)["呼吸"] ?? 0);
    return out;
  };
  const a = breath(false);
  const b = breath(true);
  assert.notDeepEqual(a, b, "emote 应改变呼吸轨迹");
  // arousal 高 → 频率高：过零更多（粗略断言）
  const crossings = (xs: number[]): number =>
    xs.filter((_, i) => i > 0 && xs[i - 1]! < 0 !== xs[i]! < 0).length;
  assert.ok(crossings(b) >= crossings(a), `高频呼吸应有更多过零（A=${crossings(a)} B=${crossings(b)}）`);
});

test("M5: blink 指令——interval 覆盖触发眨眼", () => {
  const { ing, ev, sink } = setup(11);
  // 默认间隔 2-5s：600ms 内不应有眨眼
  runFrames(ev, sink, 37, 16); // ~592ms
  assert.ok(!sink.frames.some((f) => f.params["眨眼"]! > 0), "默认间隔内不应眨眼");
  // blink interval=300 → 300ms 内应眨眼
  ing.feedLine('{"op":"blink","interval":300}', sink.frames[sink.frames.length - 1]!.t);
  runFrames(ev, sink, 20, 16); // +320ms
  assert.ok(sink.frames.some((f) => f.params["眨眼"]! > 0), "blink 覆盖间隔后应出现眨眼");
});

test("M5: drift 指令——对 Custom sem 施加持续漂移", () => {
  const { ing, ev, sink } = setup(13);
  ing.feedLine('{"op":"drift","sem":"害羞","amplitude":0.5,"period":1000}', 0);
  runFrames(ev, sink, 40, 16);
  const vals = sink.frames.map((f) => f.params["害羞"]!);
  assert.ok(new Set(vals).size > 3, "drift 应让害羞持续变化（Custom 组显式例外）");
  assert.ok(vals.every((v) => v >= 0), "drift 输出应被钳制到参数范围");
});

// ---------- 播放生命周期 ----------

test("M5: queue——非 loop 播完队首继续，播完参数释放", () => {
  const { ing, ev, sink } = setup();
  ing.feedLine('{"op":"play","asset":"短动作"}', 0);         // 微笑 0→1 500ms 非 loop
  ing.feedLine('{"op":"play","asset":"挥手","interrupt":"queue"}', 0); // 害羞 排队
  runFrames(ev, sink, 30, 16); // t=480ms：短动作未结束，挥手未开始
  assert.equal(sink.frames[sink.frames.length - 1]!.params["害羞"], 0, "排队中害羞应=0");
  runFrames(ev, sink, 10, 16); // t=640ms：短动作已结束（500ms），挥手开始
  const p = sink.frames[sink.frames.length - 1]!.params;
  assert.ok(p["害羞"]! > 0, `队首已开始，害羞>0，得 ${p["害羞"]}`);
  // 层模型：动作播完 → 层移除 → 参数释放回默认（与 engine Player 的"停在末帧"不同，见 §6.3）
  assert.equal(p["微笑"], 0, "播完的层参数应释放回默认（微笑=0）");
});

test("M5: supersede——替换并记录现场，被换者从现场恢复", () => {
  const { ing, ev, sink } = setup();
  ing.feedLine('{"op":"play","asset":"微笑点头","speed":2}', 0); // 微笑 0→1 线性 1s，speed 2 → 500ms 走完
  runFrames(ev, sink, 16, 16); // t=256ms → elapsed=128ms → 微笑=0.128
  const frozen = sink.frames[sink.frames.length - 1]!.params["微笑"]!;
  assert.ok(Math.abs(frozen - 0.128) < 0.01, `t=256 微笑应≈0.128，得 ${frozen}`);
  ing.feedLine('{"op":"play","asset":"害羞短动作","interrupt":"supersede"}', 256); // 顶替（驱动害羞，不碰微笑）
  runFrames(ev, sink, 16, 16); // t=512ms：害羞短动作进行中
  const during = sink.frames[sink.frames.length - 1]!.params;
  // supersede = 替换并记录现场：被换者输出释放（回默认），恢复时才回现场
  assert.equal(during["微笑"], 0, "被换者输出释放（微笑回默认 0）");
  assert.ok(during["害羞"]! > 0, `顶替者驱动害羞（得 ${during["害羞"]}）`);
  runFrames(ev, sink, 20, 16); // t=832ms：害羞短动作已结束（~768ms 处检测到），微笑点头从现场恢复
  const p = sink.frames[sink.frames.length - 1]!.params;
  assert.ok(p["微笑"]! > frozen + 0.02, `被换者应从现场（128ms）恢复继续推进（${frozen} → ${p["微笑"]}）`);
  assert.ok(p["微笑"]! <= 1, "不越界");
});

// ---------- 离线批量 ----------

test("M5: feedBatch 整批原子——任一坏行 → 全部拒绝", () => {
  const { ing, ev, sink } = setup();
  const r = ing.feedBatch({
    v: 2,
    directives: [
      { op: "play", asset: "微笑点头" },
      { op: "set", sem: "微笑", value: 9 }, // 越界 → 整批拒绝
      { op: "set", sem: "头转向", value: 10 },
    ],
  }, 0);
  assert.equal(r.applied.length, 0, "整批应被拒绝");
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0]!.reason, "RANGE");
  runFrames(ev, sink, 20, 16);
  const p = sink.frames[sink.frames.length - 1]!.params;
  assert.equal(p["微笑"], 0, "play 未生效（微笑=0）");
  // 头转向被 env 视线微动写（非 0），但绝不可能到指令值 10（env 贡献上限 0.15×60×0.3=2.7）
  assert.ok(Math.abs(p["头转向"]!) < 3, `set=10 未生效（env 视线微动仅 ±2.7），得 ${p["头转向"]}`);
});

test("M5: feedBatch +id 跨行依赖与 at 排程", () => {
  const { ing, ev, sink } = setup();
  const r = ing.feedBatch({
    v: 2,
    directives: [
      { id: "a", op: "play", asset: "短动作" },               // 0ms 开始
      { id: "b", op: "play", asset: "微笑点头", at: "+200" }, // 相对 a +200ms → 顶替
    ],
  }, 0);
  assert.equal(r.skipped.length, 0, JSON.stringify(r.skipped));
  runFrames(ev, sink, 30, 16); // t=480ms：b 在 200ms 已顶替 a
  const p = sink.frames[sink.frames.length - 1]!.params;
  // b=微笑点头（1s loop 0→1 线性）：t=480-200=280ms → 0.28
  assert.ok(Math.abs(p["微笑"]! - 0.28) < 0.03, `at 排程后 b 生效（得 ${p["微笑"]}）`);
});

test("M5: undo 占位——M5 无慢校验行，恒 false", () => {
  const { ing } = setup();
  assert.equal(ing.undo(), false);
});

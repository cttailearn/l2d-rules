import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inlineValidate,
  batchValidate,
  opShapeIssues,
  resolveSchedule,
  namingIssues,
  semanticIssues,
  refIssues,
  curveIssues,
  depIssues,
  parseJsonLine,
  StreamIngestor,
  LayerStack,
  EnvironmentLayer,
  Evaluator,
  type ManifestLike,
  type AssetIndex,
  type AssetStore,
  type MotionLike,
  type EnvParamDef,
  type RuleCtx,
  type DirectiveStream,
} from "../src/index.ts";

// ---------- 夹具（与 driver.test 同源参数面） ----------
const PARAMS: EnvParamDef[] = [
  { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "害羞", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
  { id: "呼吸", min: 0, max: 1, def: 0.5, group: "Ambient" },
];
const MANIFEST: ManifestLike = {
  sems: PARAMS.map((p) => ({ name: p.id, min: p.min, max: p.max, group: p.group, def: p.def })),
};
const LIBRARY: AssetIndex = {
  motions: [{ name: "微笑点头" }, { name: "坏曲线" }],
  expressions: [{ name: "开心" }],
  behaviors: [],
};
const M_OK: MotionLike = { durationMs: 1000, loop: true, curves: [{ id: "微笑", segments: [0, 0, 0, 1, 1] }] };
const M_BAD_CURVE: MotionLike = { durationMs: 1000, loop: true, curves: [{ id: "微笑", segments: [0, 0, 0, 0.5, 1, 0, 0.2, 1] }] }; // 时间回退 0.5→0.2
const M_BAD_SEM: MotionLike = { durationMs: 1000, loop: true, curves: [{ id: "不存在的sem", segments: [0, 0, 0, 1, 1] }] };
const ASSETS: AssetStore = {
  motions: new Map([
    ["微笑点头", M_OK],
    ["坏曲线", M_BAD_CURVE],
  ]),
  expressions: new Map([["开心", { parameters: [{ id: "害羞", value: 0.2, blend: "Add" }] }]]),
};
const CTX: RuleCtx = { manifest: MANIFEST, library: LIBRARY, assets: ASSETS };
const BATCH_CTX = { ...CTX, params: PARAMS, seed: 7 };

// ---------- 7 类规则 ----------

test("M6: 语法——坏 JSON → JSON_PARSE", () => {
  const p = parseJsonLine("{bad", 3);
  assert.equal(p.ok, false);
  if (!p.ok) {
    assert.equal(p.issues[0]!.rule, "JSON_PARSE");
    assert.equal(p.issues[0]!.line, 3);
  }
  assert.equal(parseJsonLine("{}", 0).ok, true);
});

test("M6: 语义——未知 op / 缺 required / 表外字段", () => {
  const op = opShapeIssues({ op: "fly" }, 1, false);
  assert.equal(op.ok, false);
  if (!op.ok) assert.equal(op.issues[0]!.rule, "OP");

  const req = opShapeIssues({ op: "play" }, 1, false);
  assert.equal(req.ok, false);
  if (!req.ok) assert.equal(req.issues[0]!.rule, "REQUIRED");

  const forb = opShapeIssues({ op: "play", asset: "微笑点头", value: 1 }, 1, false);
  assert.equal(forb.ok, false);
  if (!forb.ok) assert.equal(forb.issues[0]!.rule, "FORBIDDEN");
});

test("P0-2: camera——zoom/pan 载荷可表达（不再静默丢弃）", () => {
  const ok = opShapeIssues({ op: "camera", zoom: 1.5, pan: [10, 20] }, 0, false);
  assert.equal(ok.ok, true, "camera 允许 zoom+pan");
  const noLoad = opShapeIssues({ op: "camera" }, 0, false);
  assert.equal(noLoad.ok, true, "空 camera 仍合法");
  const badZoom = opShapeIssues({ op: "camera", zoom: 0 }, 0, false);
  assert.equal(badZoom.ok, false);
  if (!badZoom.ok) assert.equal(badZoom.issues[0]!.rule, "RANGE", "zoom≤0 越界");
  const badPan = opShapeIssues({ op: "camera", pan: [1] }, 0, false);
  assert.equal(badPan.ok, false, "pan 必须 [x,y]");
});

test("M6: 命名——语义名禁裸官方 PARAM/PARTS id", () => {
  const d = { op: "set", sem: "PARAM_ANGLE_X", value: 0.5 } as const;
  const issues = namingIssues(d as never, 0);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.rule, "NAMING");
  assert.equal(namingIssues({ op: "set", sem: "微笑", value: 0.5 } as never, 0).length, 0);
});

test("M6: 语义+范围——sem 不存在 / value 越界", () => {
  const d1 = { op: "set", sem: "不存在的", value: 0.5 };
  assert.equal(semanticIssues(d1 as never, CTX, 0)[0]!.rule, "SEM_NOT_FOUND");
  const d2 = { op: "set", sem: "微笑", value: 2 };
  assert.equal(semanticIssues(d2 as never, CTX, 0)[0]!.rule, "RANGE");
  const d3 = { op: "set", sem: "微笑", value: 0.5 };
  assert.equal(semanticIssues(d3 as never, CTX, 0).length, 0);
});

test("M6: 引用——play 不在库 / 无曲线表", () => {
  const d1 = { op: "play", asset: "不存在挥手" };
  assert.equal(refIssues(d1 as never, CTX, 0)[0]!.rule, "ASSET_NOT_FOUND");
  const d2 = { op: "play", asset: "微笑点头" };
  assert.equal(refIssues(d2 as never, CTX, 0).length, 0);
  const noAssets: RuleCtx = { manifest: MANIFEST, library: LIBRARY };
  assert.equal(refIssues(d2 as never, noAssets, 0)[0]!.rule, "ASSET_UNRESOLVED");
});

test("M6: 曲线——时间回退 / 段过短 / 段结构非法", () => {
  const issues = curveIssues(M_BAD_CURVE, 2);
  assert.ok(issues.length >= 1, "时间回退应报 CURVE");
  assert.equal(issues[0]!.rule, "CURVE");
  const short = curveIssues({ durationMs: 1000, loop: true, curves: [{ id: "微笑", segments: [0, 0] }] }, 0);
  assert.equal(short[0]!.rule, "CURVE");
  assert.equal(curveIssues(M_OK, 0).length, 0);
});

test("M6: IR 专属——id 重复 / 依赖缺失 / 前向引用", () => {
  const stream: DirectiveStream = {
    v: 2,
    directives: [
      { id: "a", op: "play", asset: "微笑点头" },
      { id: "a", op: "play", asset: "微笑点头" },
      { id: "c", op: "play", asset: "微笑点头", at: "+甲" },
      { id: "d", op: "play", asset: "微笑点头", at: "+x" }, // x 在后面（前向引用）
      { id: "x", op: "play", asset: "微笑点头" },
    ],
  };
  const issues = depIssues(stream, 0);
  const rules = issues.map((i) => i.rule);
  assert.ok(rules.includes("ID_DUP"), JSON.stringify(rules));
  assert.ok(rules.includes("AT_DEP_MISSING"), JSON.stringify(rules)); // 甲 不存在
  assert.ok(rules.includes("DEP_CYCLE"), JSON.stringify(rules)); // x 前向
});

test("P1-5: resolveSchedule——+id 依赖 play 结束（dur 指定用真实 durationMs）", () => {
  // M_OK durationMs = 1000
  const stream: DirectiveStream = {
    v: 2,
    directives: [
      { id: "motion", op: "play", asset: "微笑点头" },
      { id: "after", op: "set", sem: "微笑", value: 1, at: "+motion", dur: 1 }, // dur 指定 → 依赖 motion 结束
    ],
  };
  const s = resolveSchedule(stream, 100, ASSETS.motions);
  assert.equal(s.ok, true);
  if (s.ok) {
    assert.equal(s.schedule[0]!.startMs, 100, "首条 = 流起点");
    assert.equal(s.schedule[1]!.startMs, 1100, "dur 指定 → 依赖 play 结束（100+1000）");
  }
  // 无 dur → 依赖开始
  const s2 = resolveSchedule({
    v: 2,
    directives: [
      { id: "motion", op: "play", asset: "微笑点头" },
      { op: "set", sem: "微笑", value: 1, at: "+motion" },
    ],
  }, 100, ASSETS.motions);
  assert.equal(s2.ok && (s2 as { schedule: { startMs: number }[] }).schedule[1]!.startMs, 100, "无 dur → 依赖开始");
});

// ---------- 双模式策略 ----------

test("M6: inline 快校验——坏行隔离，好行通过", () => {
  const bad = inlineValidate('{"op":"set","sem":"微笑","value":9}', CTX, 5);
  assert.equal(bad.ok, false);
  assert.equal(bad.issues[0]!.rule, "RANGE");
  assert.equal(bad.issues[0]!.line, 5, "行号透传");

  const good = inlineValidate('{"op":"play","asset":"微笑点头"}', CTX, 6);
  assert.equal(good.ok, true);
  assert.equal(good.directive?.op, "play");
});

test("M6: batch 整批原子——曲线坏行拒绝整批（含 line 定位）", () => {
  const stream: DirectiveStream = {
    v: 2,
    directives: [
      { op: "play", asset: "微笑点头" },
      { op: "play", asset: "坏曲线" }, // 曲线时间回退 → 整批拒绝
      { op: "set", sem: "微笑", value: 0.3 },
    ],
  };
  const v = batchValidate(stream, BATCH_CTX);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.rule === "CURVE" && i.line === 1), JSON.stringify(v.issues));
});

test("M6: batch 干跑——曲线 sem 不存在 → SEM_NOT_FOUND 拒绝", () => {
  const stream: DirectiveStream = {
    v: 2,
    directives: [{ op: "play", asset: "微笑点头" }, { op: "play", asset: "坏曲线" }],
  };
  // 替换资产为引用不存在 sem 的曲线
  const ctx = { ...BATCH_CTX, assets: { ...ASSETS, motions: new Map([...ASSETS.motions, ["坏曲线", M_BAD_SEM]]) } };
  const v = batchValidate(stream, ctx);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.rule === "SEM_NOT_FOUND"), JSON.stringify(v.issues));
});

test("M6: batch 干跑——合法整批通过并逐帧无 NaN", () => {
  const stream: DirectiveStream = {
    v: 2,
    directives: [
      { id: "a", op: "play", asset: "微笑点头" },
      { id: "b", op: "set", sem: "头转向", value: 15, at: "+200" },
      { op: "emote", emote: { valence: -0.5, arousal: 0.7 } },
    ],
  };
  const v = batchValidate(stream, BATCH_CTX);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
});

test("M6: feedBatch 走 batch 校验——曲线坏批原子拒绝、好批生效", () => {
  const stack = new LayerStack(PARAMS);
  const env = new EnvironmentLayer(PARAMS, { seed: 7 });
  const ing = new StreamIngestor({ manifest: MANIFEST, library: LIBRARY, assets: ASSETS, stack, env, seed: 7 });
  const frames: { params: Record<string, number> }[] = [];
  const ev = new Evaluator(stack, env, PARAMS, {
    apply(_c: string, params: Record<string, number>): void { frames.push({ params: { ...params } }); },
  });

  // 坏批：曲线坏行 → 原子拒绝
  const bad = ing.feedBatch({ v: 2, directives: [
    { op: "play", asset: "微笑点头" },
    { op: "play", asset: "坏曲线" },
  ] }, 0);
  assert.equal(bad.applied.length, 0);
  assert.ok(bad.skipped.some((s) => s.reason === "CURVE"), JSON.stringify(bad.skipped));

  // 好批：生效
  const ok = ing.feedBatch({ v: 2, directives: [
    { op: "play", asset: "微笑点头" },
    { op: "set", sem: "头转向", value: 15 },
  ] }, 0);
  assert.equal(ok.skipped.length, 0, JSON.stringify(ok.skipped));
  for (let i = 0; i < 32; i++) ev.onFrame(16);
  const p = frames[frames.length - 1]!.params;
  assert.ok(Math.abs(p["微笑"]! - 0.512) < 0.02, `play 生效（得 ${p["微笑"]}）`);
  assert.equal(p["头转向"], 15, "set 生效");
});

// packages/dsl 解析器 + 编译器测试：BNF 合法/错误用例（含行列号）+ character/manifest/motion3 编译
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DSL_SYNTAX_VERSION, parseDsl, buildSegments, compileDoc, countSegmentsPoints, expandCurve } from "../src/index.ts";
import type { CharacterBlock, DslError, Doc, ExpressionBlock, MotionBlock, SceneBlock } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
// Haru 官方示例 fixture（gitignore，仅限非公开测试用途）：缺失时相关对照测试自动跳过
const HARU_MOTION3 = join(here, "../../../haru_ja/runtime/motion/haru_idle_01.motion3.json");
const HARU_AVAILABLE = existsSync(HARU_MOTION3);
const haruSkip = HARU_AVAILABLE ? false : "需 haru_ja 官方示例 fixture（gitignore，未提供）";

function okDoc(src: string): Doc {
  const r = parseDsl(src, "test.ldsl");
  assert.equal(r.ok, true, r.ok ? "" : `unexpected err ${r.error.code}@${r.error.line}:${r.error.col}: ${r.error.message}`);
  return (r as { ok: true; doc: Doc }).doc;
}

function err(src: string): { code: string; line: number; col: number; message: string } {
  const r = parseDsl(src, "test.ldsl");
  assert.equal(r.ok, false, "应解析失败");
  const e = (r as { ok: false; error: DslError }).error;
  return { code: e.code, line: e.line, col: e.col, message: e.message };
}

test("motion 块：属性/多 track/关键帧/单位/easing", () => {
  const doc = okDoc(`
motion 挥手 {
  group: Idle
  duration: 1800
  loop: false

  track 头转向 { 0: 0deg; 300: 20deg; 900: 8deg; 1500: 0deg; easing: easeOut }
  track 眼开合 { 0: 1; 120: 0.2; 260: 1 }
}
`);
  assert.equal(doc.blocks.length, 1);
  const m = doc.blocks[0] as MotionBlock;
  assert.equal(m.kind, "motion");
  assert.equal(m.name, "挥手");
  assert.equal(m.group, "Idle");
  assert.equal(m.durationMs, 1800);
  assert.equal(m.loop, false);
  assert.equal(m.tracks.length, 2);
  const t0 = m.tracks[0];
  assert.equal(t0.sem, "头转向");
  assert.equal(t0.frames.length, 4);
  assert.equal(t0.frames[0].timeMs, 0);
  assert.equal(t0.frames[0].value.num, 0);
  assert.equal(t0.frames[0].value.unit, "deg");
  assert.equal(t0.frames[1].timeMs, 300);
  assert.equal(t0.frames[1].value.num, 20);
  assert.equal(t0.frames[3].timeMs, 1500);
  assert.equal(t0.easing, "easeOut");
  const t1 = m.tracks[1];
  assert.equal(t1.sem, "眼开合");
  assert.equal(t1.frames.length, 3);
  assert.equal(t1.easing, undefined);
  assert.equal(t1.frames[1].value.unit, undefined);
});

test("duration 支持秒单位（归一化毫秒）", () => {
  const doc = okDoc(`motion a { duration: 1.8s; loop: true; track x { 0: 0; 100: 1 } }`);
  const m = doc.blocks[0] as MotionBlock;
  assert.equal(m.durationMs, 1800);
  assert.equal(m.loop, true);
});

test("track 支持 curve 函数曲线（与关键帧互斥）", () => {
  const doc = okDoc(`motion 待机 { loop: true; duration: 4000; track 嘴开合 { curve: breath } }`);
  const m = doc.blocks[0] as MotionBlock;
  assert.equal(m.tracks[0].curve, "breath");
  assert.equal(m.tracks[0].frames.length, 0);
});

test("expression 块：blend + set 列表", () => {
  const doc = okDoc(`
expression 开心 {
  blend: Add
  set 微笑   = 1.0
  set 眼开合 = 0.9
  set 嘴开合 = 0.3
}
`);
  const e = doc.blocks[0] as ExpressionBlock;
  assert.equal(e.kind, "expression");
  assert.equal(e.name, "开心");
  assert.equal(e.blend, "Add");
  assert.equal(e.sets.length, 3);
  assert.equal(e.sets[0].sem, "微笑");
  assert.equal(e.sets[0].value.num, 1.0);
  assert.equal(e.sets[1].sem, "眼开合");
  assert.equal(e.sets[2].value.num, 0.3);
});

test("同一文档可含多个块（motion + expression）", () => {
  const doc = okDoc(`
motion m1 { duration: 500; track 头转向 { 0: 0deg; 100: 10deg; easing: easeOut } }
expression e1 { blend: Multiply; set 微笑 = 0.5 }
`);
  assert.equal(doc.blocks.length, 2);
  assert.equal((doc.blocks[0] as MotionBlock).name, "m1");
  assert.equal((doc.blocks[1] as ExpressionBlock).name, "e1");
});

test("注释、空行、句内分号被正确忽略/接受", () => {
  const doc = okDoc(`
// 这是注释
motion m {              // 行尾注释
  group: Idle;
  duration: 300;        // 分号可作条目分隔
  track 眼开合 { 0: 1; 60: 0.2; 120: 1; }
}
`);
  const m = doc.blocks[0] as MotionBlock;
  assert.equal(m.group, "Idle");
  assert.equal(m.tracks[0].frames.length, 3);
});

test("Doc 写入语法版本号与 sourceId", () => {
  const doc = okDoc(`motion m { duration: 100; track x { 0: 0; 50: 1 } }`);
  assert.equal(doc.version, DSL_SYNTAX_VERSION);
  assert.equal(doc.sourceId, "test.ldsl");
});

test("motion 块未闭合：报错行号指向末尾", () => {
  const e = err(`motion m {
  duration: 500
  track 头转向 { 0: 0deg; 100: 10deg }
`);
  assert.equal(e.code, "SYNTAX");
  assert.equal(e.line, 4); // 顶层块缺 '}'，文件末尾
  assert.equal(e.col, 1);
  assert.match(e.message, /未闭合/);
});

test("track 块未闭合：报错行号指向末尾", () => {
  const e = err(`motion m {
  track 头转向 { 0: 0deg; 100: 10deg
}`);
  assert.equal(e.code, "SYNTAX");
  assert.equal(e.line, 3);
  assert.match(e.message, /未闭合/);
});

test("scene 块：camera/cast/bg/physics 完整解析", () => {
  const doc = okDoc(`
scene 书房 {
  camera { zoom: 1.2; anchor: [0.5 0.6] }
  cast 小夏 { source: "characters/小夏/character.ldsl"; anchor: [300 400]; scale: 1 }
  cast 阿明 { source: "characters/阿明/character.ldsl"; anchor: [700 400]; scale: 1.1 }
  bg: "textures/study.png"
  physics: on
}
`);
  const s = doc.blocks[0] as SceneBlock;
  assert.equal(s.kind, "scene");
  assert.equal(s.name, "书房");
  assert.deepEqual(s.camera, { zoom: 1.2, anchor: { x: 0.5, y: 0.6 } });
  assert.equal(s.casts.length, 2);
  assert.equal(s.casts[0].name, "小夏");
  assert.deepEqual(s.casts[0].anchor, { x: 300, y: 400 });
  assert.equal(s.casts[1].scale, 1.1);
  assert.equal(s.bg, "textures/study.png");
  assert.equal(s.physics, true);
});

test("scene cast 缺失 source/anchor：CONSTRAINT；编译出布局", () => {
  const e = err(`scene s { cast x { scale: 2 } }`);
  assert.equal(e.code, "CONSTRAINT");
  const doc = okDoc(`scene 书房 { camera { zoom: 2 } cast 小夏 { source: "c.ldsl"; anchor: [0 0] } }`);
  const r = compileDoc(doc);
  assert.equal(r.ok, true);
  const scenes = (r as { ok: true; output: { scenes: { camera?: { zoom?: number }; casts: { name: string }[] }[] } }).output.scenes;
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].camera?.zoom, 2);
  assert.equal(scenes[0].casts[0].name, "小夏");
});

test("未知块类型：SYNTAX", () => {
  const e = err(`nonsense x { }`);
  assert.equal(e.code, "SYNTAX");
});

test("motion 内未知属性：UNKNOWN_KEY，带行列号", () => {
  const e = err(`motion m {
  banana: 1
  track x { 0: 0; 50: 1 }
}`);
  assert.equal(e.code, "UNKNOWN_KEY");
  assert.equal(e.line, 2);
  assert.match(e.message, /banana/);
});

test("motion 至少一条 track：CONSTRAINT", () => {
  const e = err(`motion m { duration: 500 }`);
  assert.equal(e.code, "CONSTRAINT");
  assert.match(e.message, /track/);
});

test("expression 缺 blend：CONSTRAINT", () => {
  const e = err(`expression x { set 微笑 = 1 }`);
  assert.equal(e.code, "CONSTRAINT");
  assert.match(e.message, /blend/);
});

test("expression 至少一条 set：CONSTRAINT", () => {
  const e = err(`expression x { blend: Add }`);
  assert.equal(e.code, "CONSTRAINT");
  assert.match(e.message, /set/);
});

test("非法单位：BAD_UNIT", () => {
  const e = err(`motion m { duration: 5x; track x { 0: 0; 50: 1 } }`);
  assert.equal(e.code, "BAD_UNIT");
  assert.match(e.message, /x/);
});

test("关键帧时间须严格递增：CONSTRAINT", () => {
  const e = err(`motion m { duration: 500; track 头转向 { 300: 20deg; 150: 0deg } }`);
  assert.equal(e.code, "CONSTRAINT");
  assert.match(e.message, /递增/);
});

test("easing 之后不得再有关键帧：CONSTRAINT", () => {
  const e = err(`motion m { duration: 500; track x { 0: 0; easing: linear; 100: 0.5 } }`);
  assert.equal(e.code, "CONSTRAINT");
  assert.match(e.message, /easing/);
});

test("curve 与关键帧互斥（双向）：CONSTRAINT", () => {
  const e1 = err(`motion m { duration: 500; track x { 0: 0; curve: breath } }`);
  assert.equal(e1.code, "CONSTRAINT");
  const e2 = err(`motion m { duration: 500; track x { curve: breath; 0: 0 } }`);
  assert.equal(e2.code, "CONSTRAINT");
});

test("track 空块（无帧无曲线）：CONSTRAINT", () => {
  const e = err(`motion m { duration: 500; track x { } }`);
  assert.equal(e.code, "CONSTRAINT");
});

test("非法字符：LEX 错误带行列号", () => {
  const e = err(`motion m {\n  duration: 500\n  track x { 0: 0 }\n  @\n}`);
  assert.equal(e.code, "LEX");
  assert.equal(e.line, 4);
  assert.match(e.message, /@/);
});

test("字符串与标识符均可作 group 值；缺失块名报错", () => {
  const doc = okDoc(`motion m { group: "IdleA"; duration: 100; track x { 0: 0; 10: 1 } }`);
  assert.equal((doc.blocks[0] as MotionBlock).group, "IdleA");
  const e = err(`motion { duration: 100 }`);
  assert.equal(e.code, "SYNTAX");
  assert.match(e.message, /块名/);
});

// ============================================================ character 语法（P0 扩展）

test("character 块：source/slot/layer/bone/outfit/sem 完整解析", () => {
  const doc = okDoc(`
character 小夏 {
  source: "projects/xiaoxia.l2dp"
  slot: main

  layer 脸面 { parts: [face hoho ear nose eye eyeball brow mouth neck]; z: 30 }
  layer 前发 { parts: hair_front; z: 10; physics: hair }
  layer 胸   { parts: adult_breast; z: 25; physics: bust }

  bone 头   { layer: 脸面; pivot: [0.5 0.9]; limit: ±30deg }
  bone 躯干 { layer: 躯干; pivot: [0.5 0.5] }

  outfit 连衣裙组 { group: 001 }
  outfit 制服组   { group: 002 }

  sem 眼开合 [0 1] -> { PARAM_EYE_L_OPEN PARAM_EYE_R_OPEN }
  sem 头转向 [-30deg 30deg] -> { PARAM_ANGLE_X }
}
`);
  const c = doc.blocks[0] as CharacterBlock;
  assert.equal(c.kind, "character");
  assert.equal(c.name, "小夏");
  assert.equal(c.source, "projects/xiaoxia.l2dp");
  assert.equal(c.slot, "main");

  assert.equal(c.layers.length, 3);
  assert.equal(c.layers[0].name, "脸面");
  assert.equal(c.layers[0].parts.length, 9);
  assert.equal(c.layers[0].z, 30);
  assert.equal(c.layers[1].physics, "hair");
  assert.equal(c.layers[2].physics, "bust");

  assert.equal(c.bones.length, 2);
  assert.equal(c.bones[0].layer, "脸面");
  assert.deepEqual(c.bones[0].pivot, { x: 0.5, y: 0.9 });
  assert.equal(c.bones[0].limit?.sign, "±");
  assert.equal(c.bones[0].limit?.value, 30);
  assert.equal(c.bones[0].limit?.unit, "deg");

  assert.equal(c.outfits.length, 2);
  assert.equal(c.outfits[1].name, "制服组");
  assert.equal(c.outfits[1].group, 2);

  assert.equal(c.sems.length, 2);
  assert.deepEqual(c.sems[0].params, ["PARAM_EYE_L_OPEN", "PARAM_EYE_R_OPEN"]);
  assert.equal(c.sems[1].min, -30);
  assert.equal(c.sems[1].max, 30);
  assert.equal(c.sems[1].unit, "deg");
});

test("layer parts 支持单个部件名；层名重复报错", () => {
  const doc = okDoc(`character c { layer 前发 { parts: hair_front } }`);
  assert.deepEqual((doc.blocks[0] as CharacterBlock).layers[0].parts, ["hair_front"]);
  const e = err(`character c { layer 前发 { parts: hair_front } layer 前发 { parts: hair_back } }`);
  assert.equal(e.code, "CONSTRAINT");
  assert.match(e.message, /重复/);
});

test("sem 范围单位不一致：BAD_UNIT", () => {
  const e = err(`character c { sem 头转向 [-30deg 1] -> { PARAM_ANGLE_X } }`);
  assert.equal(e.code, "BAD_UNIT");
});

test("sem 范围 min<max 非法：CONSTRAINT", () => {
  const e = err(`character c { sem x [1 0] -> { PARAM_ANGLE_X } }`);
  assert.equal(e.code, "CONSTRAINT");
});

test("sem 映射区为空：CONSTRAINT", () => {
  const e = err(`character c { sem x [0 1] -> { } }`);
  assert.equal(e.code, "CONSTRAINT");
});

test("character 空块：CONSTRAINT", () => {
  const e = err(`character c { }`);
  assert.equal(e.code, "CONSTRAINT");
});

// ============================================================ P1 编译器

test("buildSegments：linear 多点折线与单点", () => {
  assert.deepEqual(buildSegments([{ t: 0, v: 0 }, { t: 0.3, v: 10 }, { t: 0.9, v: 8 }]),
    [0, 0, 0, 0.3, 10, 0.9, 8]);
  assert.deepEqual(buildSegments([{ t: 0.5, v: 1 }]), [0, 0.5, 1]);
});

test("buildSegments：easeOut 首段 Linear 后续 Bezier（控制点换算）", () => {
  const pts = [{ t: 0, v: 0 }, { t: 0.3, v: 10 }, { t: 0.9, v: 8 }];
  // [0, p0, p1], 然后 Bezier: 隐式起点(0.3,10)，easeOut bezier=[0,0,0.58,1]
  assert.deepEqual(buildSegments(pts, "easeOut"), [0, 0, 0, 0.3, 10, 1, 0.3, 10, 0.648, 8, 0.9, 8]);
});

test("compileDoc：character + motion + expression 全链路", () => {
  const doc = okDoc(`
character 小夏 {
  sem 头转向 [-30deg 30deg] -> { PARAM_ANGLE_X }
  sem 眼开合 [0 1] -> { PARAM_EYE_L_OPEN PARAM_EYE_R_OPEN }
}
motion 挥手 {
  group: Idle
  duration: 1800
  loop: false
  track 头转向 { 0: 0deg; 300: 20deg; 900: 8deg; 1500: 0deg; easing: easeOut }
  track 眼开合 { 0: 1; 120: 0.2; 260: 1 }
}
expression 开心 { blend: Add; set 眼开合 = 0.9 }
`);
  const r = compileDoc(doc);
  assert.equal(r.ok, true, r.ok ? "" : `${r.error.code}@${r.error.line}:${r.error.col}`);
  const out = (r as { ok: true; output: { manifests: unknown[]; motions: unknown[]; expressions: unknown[] } }).output;
  assert.equal(out.manifests.length, 1);
  const mf = out.manifests[0] as { syntaxVersion: string; sems: { name: string; params: string[] }[]; assetIndex: { motions: { name: string }[]; expressions: { name: string }[] } };
  assert.equal(mf.syntaxVersion, DSL_SYNTAX_VERSION);
  assert.equal(mf.sems.length, 2);
  assert.deepEqual(mf.sems[1].params, ["PARAM_EYE_L_OPEN", "PARAM_EYE_R_OPEN"]);

  const motions = out.motions as { meta: { duration: number; loop: boolean; curveCount: number }; curves: { target: string; id: string; segments: number[] }[] }[];
  assert.equal(motions.length, 1);
  const m = motions[0];
  assert.equal(m.meta.duration, 1.8); // 毫秒→秒
  assert.equal(m.meta.loop, false);
  assert.equal(m.meta.curveCount, 3); // 头转向 1 + 眼开合 2 条官方参数曲线
  assert.equal(m.curves[0].id, "PARAM_ANGLE_X");
  assert.equal(m.curves[0].target, "Parameter");
  assert.equal(m.curves[0].segments.length, 19); // 4 帧 easeOut：线性段 + 2 Bezier 段
  assert.equal(m.curves[1].id, "PARAM_EYE_L_OPEN");
  assert.equal(m.curves[2].id, "PARAM_EYE_R_OPEN");
  assert.deepEqual(m.curves[1].segments, [0, 0, 1, 0.12, 0.2, 0.26, 1]); // 眼开合 linear

  const expressions = out.expressions as { type: string; parameters: { id: string; value: number; blend: string }[] }[];
  assert.equal(expressions.length, 1);
  assert.equal(expressions[0].type, "Live2D Expression");
  assert.equal(expressions[0].parameters.length, 2);
  assert.deepEqual(expressions[0].parameters[0], { id: "PARAM_EYE_L_OPEN", value: 0.9, blend: "Add" });

  assert.equal(mf.assetIndex.motions.length, 1);
  assert.equal(mf.assetIndex.motions[0].name, "挥手");
  assert.equal(mf.assetIndex.expressions[0].name, "开心");
});

test("compileDoc：motion 引用不存在的 sem：REF", () => {
  const doc = okDoc(`character c { sem 头转向 [0 1] -> { PARAM_ANGLE_X } } motion m { duration: 100; track 尾巴 { 0: 0; 10: 1 } }`);
  const r = compileDoc(doc);
  assert.equal(r.ok, false);
  assert.equal((r as { error: DslError }).error.code, "REF");
  assert.match((r as { error: DslError }).error.message, /尾巴/);
});

test("compileDoc：缺少 character 块但含 motion：REF", () => {
  const doc = okDoc(`motion m { duration: 100; track 头转向 { 0: 0deg; 10: 20deg } }`);
  const r = compileDoc(doc);
  assert.equal(r.ok, false);
  assert.equal((r as { error: DslError }).error.code, "REF");
});

test("compileDoc：sem 映射非白名单官方参数：BAD_PARAM", () => {
  const doc = okDoc(`character c { sem x [0 1] -> { PARAM_FAKE } }`);
  const r = compileDoc(doc);
  assert.equal(r.ok, false);
  assert.equal((r as { error: DslError }).error.code, "BAD_PARAM");
  assert.match((r as { error: DslError }).error.message, /PARAM_FAKE/);
});

test("Haru 官方 motion3 Segments 布局与编译器输出同构", { skip: haruSkip }, () => {
  const haru = JSON.parse(readFileSync(HARU_MOTION3, "utf8"));
  const first = haru.Curves[0];
  assert.equal(first.Id, "PARAM_ANGLE_X");
  assert.equal(first.Segments[0], 0); // 官方惯例：首元素 Linear 类型
  // 官方 ARM 曲线 = buildSegments 两帧 linear 的完全同构
  const arm = haru.Curves.find((c: { Id: string }) => c.Id === "PARAM_ARM_L_A");
  assert.deepEqual(arm.Segments, [0, 0.5, 0, 10, 0.5]);
  assert.deepEqual(buildSegments([{ t: 0.5, v: 0 }, { t: 10, v: 0.5 }]), [0, 0.5, 0, 10, 0.5]);
});

test("motion 显式 duration 缺省时由最大关键帧时间推导", () => {
  const doc = okDoc(`character c { sem 头转向 [0 1] -> { PARAM_ANGLE_X } } motion m { track 头转向 { 0: 0deg; 500: 20deg; 1200: 0deg } }`);
  const r = compileDoc(doc);
  assert.equal(r.ok, true);
  const motions = (r as { ok: true; output: { motions: { meta: { duration: number } }[] } }).output.motions;
  assert.equal(motions[0].meta.duration, 1.2);
});

// ============================================================ P1 补强：统计 / curve 参数化 / scene

test("countSegmentsPoints：linear 单段多点 / mixed 段计数口径", () => {
  assert.deepEqual(countSegmentsPoints([0, 0, 0, 0.3, 10, 0.9, 8]), { segments: 1, points: 3 });
  assert.deepEqual(countSegmentsPoints([0, 0, 1, 0.3, 10, 1, 0.3, 10, 0.648, 8, 0.9, 8]), { segments: 2, points: 5 });
  assert.deepEqual(countSegmentsPoints([0, 0.5, 1]), { segments: 1, points: 1 });
});

test("motion3 meta 统计 totalSegmentCount/totalPointCount 累加", () => {
  const doc = okDoc(`
character c { sem 眼开合 [0 1] -> { PARAM_EYE_L_OPEN PARAM_EYE_R_OPEN } }
motion m { duration: 300; track 眼开合 { 0: 1; 120: 0.2; 260: 1 } }
`);
  const r = compileDoc(doc);
  assert.equal(r.ok, true);
  const m = (r as { ok: true; output: { motions: { meta: { curveCount: number; totalSegmentCount: number; totalPointCount: number } }[] } }).output.motions[0];
  assert.equal(m.meta.curveCount, 2); // 眼开合→2 官方参数
  assert.equal(m.meta.totalSegmentCount, 2); // 每曲线 1 段线性
  assert.equal(m.meta.totalPointCount, 6); // 每曲线 3 点
});

test("countSegmentsPoints 对 Haru 官方全文件统计 ≈ Editor 元数据", { skip: haruSkip }, () => {
  const haru = JSON.parse(readFileSync(HARU_MOTION3, "utf8"));
  let seg = 0;
  let pts = 0;
  for (const c of haru.Curves) {
    const s = countSegmentsPoints(c.Segments);
    seg += s.segments;
    pts += s.points;
  }
  assert.ok(Math.abs(seg - haru.Meta.TotalSegmentCount) <= 8, `segment 差过大: ${seg} vs ${haru.Meta.TotalSegmentCount}`);
  assert.ok(Math.abs(pts - haru.Meta.TotalPointCount) <= 8, `point 差过大: ${pts} vs ${haru.Meta.TotalPointCount}`);
});

test("curve 参数化：curve: breath { period/amplitude/bias }", () => {
  const doc = okDoc(`motion m { duration: 2000; track 嘴开合 { curve: breath { period: 2s; amplitude: 0.4; bias: 0.8 } } }`);
  const m = (doc.blocks[0] as MotionBlock).tracks[0];
  assert.equal(m.curve, "breath");
  assert.deepEqual(m.curveOpts, { periodMs: 2000, amplitude: 0.4, bias: 0.8 });
  // 编译冒烟：首帧值 = bias（sin 相位 0 处）；linear 多点段
  const cd = okDoc(`character c { sem 嘴开合 [0 1] -> { PARAM_MOUTH_OPEN_Y } } motion m { duration: 2000; track 嘴开合 { curve: breath { period: 2s; amplitude: 0.4; bias: 0.8 } } }`);
  const r = compileDoc(cd);
  assert.equal(r.ok, true);
  if (r.ok) {
    const seg = r.output.motions[0].curves[0].segments;
    assert.equal(seg[0], 0);
    assert.equal(seg[1], 0);
    assert.equal(seg[2], 0.8); // t=0 → bias
  }
});

test("expandCurve 参数化直接调用的周期/幅度生效", () => {
  const pos = { line: 0, col: 0 };
  const breath = expandCurve("breath", 2000, 30, pos, { periodMs: 1000, amplitude: 0.5, bias: 0.5 });
  // 1s 周期 → 2s 内 2 个完整周期；首帧 = bias；峰值≈1/谷值≈0
  assert.equal(breath[0].value.num, 0.5);
  const vals = breath.map((f) => f.value.num);
  assert.ok(Math.max(...vals) > 0.99, `应达到峰值≈1，实际 ${Math.max(...vals)}`);
  assert.ok(Math.min(...vals) < 0.01, `应达到谷值≈0，实际 ${Math.min(...vals)}`);
});

test("curve 参数块未知键报错", () => {
  const e = err(`motion m { duration: 1000; track x { curve: breath { foo: 1 } } }`);
  assert.equal(e.code, "UNKNOWN_KEY");
});

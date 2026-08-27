// @l2dp/create P4b 测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { ColorKeySegmenter, ColorMapLabeler, type RgbaImage, type Labeler } from "@l2dp/cutout";
import { validateCreation } from "../src/validate.ts";
import { executeCreation } from "../src/execute.ts";
import { generateStarterMotions, keysToSegments } from "../src/motions.ts";
import { RuleRepairer, createWithSelfRepair } from "../src/loop.ts";
import { RuleReviewer, ChainedReviewer, type VisualReviewResult } from "../src/review.ts";
import { creationDirectiveSchema } from "../src/schema.ts";
import type { CreationDirective } from "../src/ir.ts";

function solid(w: number, h: number, r: number, g: number, b: number, a = 255): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i*4]=r; data[i*4+1]=g; data[i*4+2]=b; data[i*4+3]=a; }
  return { width: w, height: h, data };
}
function rectIn(img: RgbaImage, x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
  for (let yy = y; yy < Math.min(y + h, img.height); yy++) {
    for (let xx = x; xx < Math.min(x + w, img.width); xx++) {
      const o = (yy * img.width + xx) * 4;
      img.data[o]=r; img.data[o+1]=g; img.data[o+2]=b; img.data[o+3]=255;
    }
  }
}
function charScene(): { img: RgbaImage; mapping: { color: [number,number,number]; semantic: string; side?: "left"|"right" }[] } {
  const img = solid(320, 400, 0, 0, 0, 0);
  const mapping: { color: [number,number,number]; semantic: string; side?: "left"|"right" }[] = [];
  const R = (x: number, y: number, w: number, h: number, c: number[], sem: string, side: string) => {
    rectIn(img, x, y, w, h, c[0], c[1], c[2]);
    mapping.push({ color: [c[0],c[1],c[2]] as [number,number,number], semantic: sem, side: (side === "right" ? "right" : "left") as "left"|"right" });
  };
  R(20, 20, 280, 110, [60,55,90], "hair_back", "left" as any);
  R(50, 70, 110, 160, [210,185,160], "face", "left" as any);
  R(150, 90, 110, 36, [70,60,95], "hair_front", "left" as any);
  R(78, 116, 26, 20, [250,250,255], "eyeball", "left" as any);
  R(140, 116, 26, 55, [150,180,220], "eyeball", "right" as any);
  R(72, 110, 40, 28, [235,200,180], "eye", "left" as any);
  R(136, 140, 10, 10, [235,200,230], "eye", "right" as any);
  R(66, 92, 40, 12, [70,65,90], "brow", "left" as any);
  R(132, 162, 44, 30, [80,75,100], "brow", "right" as any);
  R(118, 178, 30, 10, [190,60,70], "mouth", "left" as any);
  R(92, 160, 120, 100, [130,160,210], "body_upper", "left" as any);
  return { img, mapping };
}

test("P4b: validateCreation——合法指令零问题，非法各归其类", () => {
  const base: CreationDirective = {
    v: 1,
    character: "tmp",
    canvas: { width: 320, height: 400 },
    parts: [{ id: "face", semantic: "face", bbox: { x: 10, y: 10, width: 40, height: 50 }, color: [1, 1, 1, 1] }],
  };
  assert.equal(validateCreation(base).length, 0);
  const badPart = { id: "x", semantic: "galaxy", bbox: { x: 0, y: 0, width: 5, height: 5 } } as never;
  assert.ok(validateCreation({ ...base, parts: [badPart] }).some((i) => i.rule === "SEM_NOT_IN_VOCAB"));
  assert.ok(validateCreation({ ...base, parts: [base.parts[0], base.parts[0]] }).some((i) => i.rule === "PART_ID_DUP"));
  const out: CreationDirective["parts"][number] = { id: "x", semantic: "face", bbox: { x: -5, y: 0, width: 924, height: 925 }, color: [1,1,1,1] };
  assert.ok(validateCreation({ ...base, parts: [out] }).some((i) => i.rule === "BBOX_OUT"));
  assert.ok(validateCreation({ ...base, parts: [{ id: "x", semantic: "face", bbox: { x: 0, y: 0, width: 10, height: 10 } }] }).some((i) => i.rule === "PART_NO_VIS"));
  const badMotion: CreationDirective = { ...base, motions: [{ name: "m", kind: "idle", durationMs: 1000, curves: [{ param: "y", keys: [[0.1, 1], [0.05, 0], [0.2, 0.5]] }] }] };
  assert.ok(validateCreation(badMotion).some((i) => i.rule === "CURVE_KEY_ORDER"));
  const badDur: CreationDirective = { ...base, motions: [{ name: "m", kind: "idle", durationMs: 0, curves: [] }] };
  assert.ok(validateCreation(badDur).some((i) => i.rule === "MOTION_DUR"));
});

async function directiveFromScene(): Promise<{ d: CreationDirective; cutoutParts: number }> {
  const { img, mapping } = charScene();
  const seg = new ColorKeySegmenter({ tol: 8, minArea: 40 });
  const labeler = new ColorMapLabeler(mapping);
  const cands = await seg.segment(img);
  const parts = await labeler.label(cands, img);
  const d: CreationDirective = {
    v: 1,
    character: "scene-chan",
    canvas: { width: img.width, height: img.height },
    parts: parts.map((p) => ({ id: p.id, semantic: p.semantic as any, side: p.side, bbox: p.bbox, image: { dataUri: p.image.dataUri } })),
  };
  return { d, cutoutParts: parts.length };
}

test("P4b: 切图→指令 → execute → rig 合法 + 基础动作集", async () => {
  const { d, cutoutParts } = await directiveFromScene();
  assert.ok(cutoutParts >= 6, "应有 6+ 部件，实际 " + cutoutParts);
  assert.equal(validateCreation(d).length, 0);
  const result = executeCreation(d);
  assert.equal(result.rig.report.ok, true, JSON.stringify(result.rig.report.checks));
  const names = result.motions.map((m) => m.name);
  for (const n of ["idle", "blink", "talk", "surprise"]) assert.ok(names.includes(n), "应有 " + n);
  for (const nm of result.motions) {
    assert.ok(nm.motion.durationMs > 0);
    for (const c of nm.motion.curves) assert.ok(c.segments.length >= 4);
  }
});

test("P4b: generateStarterMotions 参数容错 + keysToSegments 递增", () => {
  const params = [{ id: "呼吸", min: 0, max: 1, def: 0 }, { id: "头转向", min: -30, max: 30, def: 0 }];
  const set = generateStarterMotions(params, ["idle", "blink", "talk"]);
  const ids = set.flatMap((nm) => nm.motion.curves.map((c) => c.id));
  assert.ok(!ids.includes("嘴开"), "未知参数不应出现");
  assert.deepEqual(keysToSegments([[0, 0], [0.5, 1], [0.2, 0.5]]), [0, 0, 0, 0.2, 0.5, 0, 0.5, 1]);
});

test("P4b: walk（行走）动作生成——步态只引用存在的参数，默认集含 walk", () => {
  const params = [
    { id: "腿摆", min: -1, max: 1, def: 0 },
    { id: "臂摆", min: -1, max: 1, def: 0 },
    { id: "身摆", min: -1, max: 1, def: 0 },
    { id: "身转", min: -10, max: 10, def: 0 },
    { id: "头转向", min: -30, max: 30, def: 0 },
    { id: "头点头", min: -30, max: 30, def: 0 },
  ];
  // 默认集自动含 walk
  const def = generateStarterMotions(params);
  assert.ok(def.some((m) => m.name === "walk"), "默认动作集含 walk");
  const walk = def.find((m) => m.name === "walk")!;
  assert.equal(walk.kind, "walk");
  assert.equal(walk.motion.loop, true);
  const driven = walk.motion.curves.map((c) => c.id);
  for (const id of ["腿摆", "臂摆", "身摆", "身转", "头转向", "头点头"]) {
    assert.ok(driven.includes(id), "walk 驱动 " + id);
  }
  // 容错：缺手臂/腿参数时不引用不存在的参数
  const minimal = generateStarterMotions([{ id: "头转向", min: -30, max: 30, def: 0 }], ["walk"]);
  assert.ok(minimal.length === 1, "局部参数面仍产出 walk");
  const ids = minimal[0]!.motion.curves.map((c) => c.id);
  assert.ok(ids.every((id) => id === "头转向"), "只引用存在的参数（" + ids.join(",") + "）");
});

test("P4b: RuleRepairer——越界/重复 id/微部件 修复后通过校验", () => {
  const repairer = new RuleRepairer();
  const bad: CreationDirective = {
    v: 1,
    character: "r",
    canvas: { width: 100, height: 100 },
    parts: [
      { id: "a", semantic: "face", bbox: { x: 950, y: 10, width: 50, height: 40 }, color: [1, 1, 1, 1] },
      { id: "a", semantic: "brow", bbox: { x: 10, y: 10, width: 5, height: 4 }, color: [0.3, 0.3, 0.3, 1] },
      { id: "tiny", semantic: "eye", bbox: { x: 30, y: 14, width: 62, height: 61 }, color: [1, 1, 1, 1] },
    ],
  };
  const r = repairer.repair(bad, []);
  const issues = validateCreation(r.directive);
  assert.equal(issues.length, 0, JSON.stringify(issues));
  assert.ok(r.fixes.length > 0);
});

test("P4b: createWithSelfRepair 全链（切图→标注→校验→执行→规则审核）", async () => {
  const { img, mapping } = charScene();
  const labeler: Labeler = new ColorMapLabeler(mapping);
  const outcome = await createWithSelfRepair({
    character: "scene-chan",
    image: img,
    segmenter: new ColorKeySegmenter({ tol: 8, minArea: 40 }),
    labeler,
    reviewer: new RuleReviewer(),
    maxRounds: 3,
  });
  assert.equal(outcome.ok, true, "日志:\n" + outcome.log.join("\n") + "\n问题:" + outcome.issues.join(";"));
  assert.ok(outcome.result !== undefined);
  assert.ok(outcome.result.rig.report.ok);
  assert.ok(outcome.directive.parts.length >= 5);
});

test("P4b: RuleReviewer——合法模型通过，空白模型拒绝", async () => {
  const reviewer = new RuleReviewer();
  const { d } = await directiveFromScene();
  const ok = executeCreation(d);
  const verdict = await reviewer.review(ok.model);
  assert.equal(verdict.ok, true, verdict.issues.join(";"));
  const empty = await reviewer.review({ formatVersion: 1 as 1, id: "e", canvas: { width: 64, height: 64 }, parameters: [], parts: [] } as never);
  assert.equal(empty.ok, false);
});

test("P1-1: RuleReviewer 三态——blink 态把部件拖出画布可检出；threeStates:false 不检", async () => {
  // 三色方块，均带 眼闭(EyeBlink) warp：value=1 时整体右移 40px 出画布
  const verts = [0, 0, 10, 0, 10, 10, 0, 10];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  const indices = [0, 1, 2, 0, 2, 3];
  const warp = {
    parameter: "眼闭",
    keyforms: [
      { value: 0, offsets: [0, 0, 0, 0, 0, 0, 0, 0] },
      { value: 1, offsets: [40, 0, 40, 0, 40, 0, 40, 0] },
    ],
  };
  const part = (id: string, color: [number, number, number, number]) => ({
    id, order: 0, color, mesh: { vertices: verts, uvs, indices, warps: [warp] } as never,
  });
  const model = {
    formatVersion: 1, id: "t", canvas: { width: 20, height: 20 },
    parameters: [{ id: "眼闭", min: 0, max: 1, def: 0, group: "EyeBlink" }],
    parts: [part("r", [1, 0, 0, 1]), part("g", [0, 1, 0, 1]), part("b", [0, 0, 1, 1])],
  } as never;

  const three = new RuleReviewer({ minColors: 1 });
  const v = await three.review(model);
  assert.equal(v.ok, false, "blink 态三部件整体出画布（覆盖率≈0）应被检出: " + v.issues.join(";"));
  assert.ok(v.issues.some((i) => i.includes("blink")), "问题应标注 blink 态");

  const single = new RuleReviewer({ threeStates: false, minColors: 1 });
  const v2 = await single.review(model);
  assert.equal(v2.ok, true, "rest 单态三色块覆盖正常应通过");
});

test("P4b: creationDirectiveSchema 基本形状", () => {
  const s = creationDirectiveSchema() as { required: string[]; properties: Record<string, unknown> };
  assert.ok(s.required.includes("parts"));
  assert.ok(s.properties.parts !== undefined);
});
// ---------------- R-P2-2：分级审核链 ChainedReviewer ----------------

test("R-P2-2: 无 visual 时 ChainedReviewer 等价纯规则（不触发复审）", async () => {
  const chain = new ChainedReviewer();
  const { d } = await directiveFromScene();
  const ok = executeCreation(d);
  const v = await chain.review(ok.model);
  assert.equal(v.ok, true, v.issues.join(";"));
  assert.equal(chain.visualCalls, 0);
});

test("R-P2-2: 规则初审不过 → 回注，不进视觉（避免无谓成本）", async () => {
  let visualCalls = 0;
  const chain = new ChainedReviewer({
    primary: new RuleReviewer(),
    visual: {
      name: "vision-mock",
      async review() { visualCalls += 1; return { ok: true, confidence: 1, issues: [], suggestions: [] }; },
    },
  });
  const empty = await chain.review({ formatVersion: 1 as 1, id: "e", canvas: { width: 32, height: 32 }, parameters: [], parts: [] } as never);
  assert.equal(empty.ok, false, "空白模型规则初审失败");
  assert.equal(visualCalls, 0, "规则已不过，无谓视觉复审不发生");
});

test("R-P2-2: 规则过但低置信 + 视觉发现差异 → 合并回注、visualCalls=1", async () => {
  const chain = new ChainedReviewer({
    primary: { name: "lowconf", async review() { return { ok: true, confidence: 0.3, issues: [], suggestions: [] }; } },
    visual: {
      name: "vision",
      async review(): Promise<VisualReviewResult> {
        return { ok: false, confidence: 0.4, issues: ["视觉:肢体缺失"], suggestions: ["补臂部件"], diffs: [{ kind: "missing-part", message: "肢体缺失(左臂)" }] };
      },
    },
    confidenceThreshold: 0.6,
  });
  const { d } = await directiveFromScene();
  const ok = executeCreation(d);
  const v = await chain.review(ok.model);
  assert.equal(v.ok, false, "视觉差异 → 回注");
  assert.ok(v.issues.some((i) => i.includes("左臂")), "差异回注进 issues: " + v.issues.join(";"));
  assert.ok(v.suggestions.some((s) => s.includes("补臂")), "建议回注");
  assert.equal(chain.visualCalls, 1);
});

test("R-P2-2: 低置信但视觉通过 → 合并通过", async () => {
  const chain = new ChainedReviewer({
    primary: { name: "low", async review() { return { ok: true, confidence: 0.3, issues: [], suggestions: [] }; } },
    visual: { name: "vision", async review() { return { ok: true, confidence: 0.9, issues: [], suggestions: [] }; } },
    confidenceThreshold: 0.6,
  });
  const { d } = await directiveFromScene();
  const ok = executeCreation(d);
  const v = await chain.review(ok.model);
  assert.equal(v.ok, true);
  assert.equal(chain.visualCalls, 1);
});
test("B-7: validateCreation 接受服装语义（LLM 创作路径可产 outfit_dress 等）", () => {
  const d: CreationDirective = {
    v: 1, character: "c", canvas: { width: 320, height: 480 },
    parts: [
      { id: "body", semantic: "body_upper", side: "left", bbox: { x: 20, y: 100, width: 200, height: 260 }, color: [0.5, 0.6, 0.9, 1] },
      { id: "dress", semantic: "outfit_dress", side: "left", bbox: { x: 20, y: 110, width: 200, height: 240 }, color: [0.9, 0.4, 0.6, 1] },
      { id: "shoes", semantic: "outfit_shoes", side: "left", bbox: { x: 40, y: 430, width: 160, height: 30 }, color: [0.3, 0.3, 0.4, 1] },
    ],
    motions: [],
  };
  const issues = validateCreation(d);
  assert.equal(issues.length, 0, "服装语义应被词表接受（实际 " + JSON.stringify(issues) + "）");
  // 对照：未注册语义仍报 SEM_NOT_IN_VOCAB
  const bad: CreationDirective = { ...d, parts: [{ id: "zzz", semantic: "zzz", side: "left", bbox: { x: 0, y: 0, width: 10, height: 10 }, color: [0.5, 0.5, 0.5, 1] }] };
  const badIssues = validateCreation(bad);
  assert.ok(badIssues.some((i) => i.rule === "SEM_NOT_IN_VOCAB"), "未注册语义仍拒绝");
});
test("B-7: LLM 创作路径产出全新自定义语义——CreationDirective.customTemplates 经 execute 全链可绑定", () => {
  const customTemplates: Record<string, import("@l2dp/rig").RigTemplateLike> = {
    cape: { zh: "披风", order: 22, headCluster: false, color: [0.6, 0.3, 0.7, 1], grid: [3, 6] },
  };
  const d: CreationDirective = {
    v: 1, character: "cape-chan", canvas: { width: 320, height: 480 },
    parts: [
      { id: "body", semantic: "body_upper", side: "left", bbox: { x: 60, y: 180, width: 200, height: 220 }, color: [0.5, 0.6, 0.9, 1] },
      { id: "cape", semantic: "cape", side: "left", bbox: { x: 260, y: 200, width: 40, height: 220 }, color: [0.6, 0.3, 0.7, 1] },
    ],
    customTemplates,
    motions: [],
  };
  const issues = validateCreation(d);
  assert.equal(issues.length, 0, "自定义语义过校验: " + JSON.stringify(issues));
  const r = executeCreation(d);
  assert.ok(r.model.parts.some((p) => p.id === "cape"), "自定义语义部件入模");
  assert.ok(r.rig.report.ok, "rig 校验通过");
  assert.ok(r.rig.spec.parameters.length > 0, "参数面生成");
});

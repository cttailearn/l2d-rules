// demo-custom（B-7）自动化断言：运行时自定义语义注入 + 创作路径服装/自定义语义
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { rigCharacter, type RigTemplateLike } from "@l2dp/rig";
import { executeCreation } from "@l2dp/create";

const customTemplates: Record<string, RigTemplateLike> = {
  cape: { zh: "披风", order: 21, headCluster: false, color: [0.65, 0.38, 0.78, 1], grid: [3, 6], drive: { id: "披风飘" } },
  halo: { zh: "光环", order: 23, headCluster: true, color: [0.98, 0.85, 0.4, 1], grid: [4, 2] },
};
const canvas = { width: 400, height: 600 };

test("B-7 demo: customTemplates 注入的语义入模、可渲染、drive 可驱动", () => {
  const rig = rigCharacter({
    id: "c", canvas,
    parts: [
      { id: "face", semantic: "face", bbox: { x: 120, y: 150, width: 160, height: 130 } },
      { id: "cape", semantic: "cape", bbox: { x: 20, y: 260, width: 50, height: 260 }, customParams: { 披风飘: { min: -1, max: 1, def: 0, group: "Custom" } } },
      { id: "halo", semantic: "halo", bbox: { x: 160, y: 100, width: 70, height: 30 } },
    ],
    customTemplates,
  });
  assert.equal(rig.report.ok, true);
  assert.ok(rig.model.parts.some((p) => p.id === "cape"), "cape 入模");
  assert.ok(rig.model.parameters.some((p) => p.id === "披风飘"), "drive 参数派生");
  // 渲染非空 + drive 可见
  const sw = new SoftwareRenderer();
  const h = (set: Record<string, number>) => {
    const pl = new L2dmPlayer(rig.model, new Map());
    pl.params.reset(); for (const [k, v] of Object.entries(set)) pl.params.set(k, v);
    pl.render(sw);
    return createHash("sha256").update(sw.readPixels()!).digest("hex");
  };
  assert.notEqual(h({}), h({ 披风飘: 1 }), "自定义语义 drive 可见变化");
});

test("B-7 demo: 创作路径——自定义语义 + 服装语义经 executeCreation 全链", () => {
  const r = executeCreation({
    v: 1, character: "c2", canvas,
    parts: [
      { id: "body", semantic: "body_upper", side: "left", bbox: { x: 60, y: 260, width: 280, height: 240 }, color: [0.5, 0.6, 0.9, 1] },
      { id: "cape", semantic: "cape", side: "left", bbox: { x: 20, y: 270, width: 50, height: 240 }, color: [0.65, 0.38, 0.78, 1], customParams: { 披风飘: { min: -1, max: 1, def: 0, group: "Custom" } } },
      { id: "dress", semantic: "outfit_dress", side: "left", bbox: { x: 60, y: 270, width: 280, height: 220 }, color: [0.9, 0.4, 0.6, 1] },
    ],
    customTemplates,
    motions: [],
  });
  assert.ok(r.model.parts.some((p) => p.id === "cape"), "创作路径自定义语义入模");
  assert.ok(r.model.parts.some((p) => p.id === "dress"), "创作路径服装语义入模");
  assert.equal(r.model.parts.find((p) => p.id === "dress")!.opacityParam, "衣装组1", "服装部件随服饰组显隐");
  assert.ok(r.rig.report.ok, "rig 校验通过");
});

// ---------- ④ 驱动全链：JSONL 流式 + 环境层 → 动画帧序列 + 确定性 ----------
const fullTemplates: Record<string, RigTemplateLike> = {
  cape: { zh: "披风", order: 21, headCluster: false, color: [0.65, 0.38, 0.78, 1], grid: [3, 6], drive: { id: "披风飘" } },
  wing: { zh: "翅膀", order: 22, headCluster: false, color: [0.85, 0.8, 0.95, 1], grid: [3, 4], drive: { id: "翅膀扇" } },
  halo: { zh: "光环", order: 23, headCluster: true, color: [0.98, 0.85, 0.4, 1], grid: [4, 2] },
};

function buildDrivenModel() {
  return rigCharacter({
    id: "driven", canvas,
    parts: [
      { id: "face", semantic: "face", bbox: { x: 120, y: 150, width: 160, height: 130 } },
      { id: "cape", semantic: "cape", bbox: { x: 20, y: 260, width: 50, height: 260 }, customParams: { 披风飘: { min: -1, max: 1, def: 0, group: "Custom" } } },
      { id: "wing", semantic: "wing", side: "left", bbox: { x: 300, y: 220, width: 70, height: 140 }, customParams: { 翅膀扇: { min: -1, max: 1, def: 0, group: "Custom" } } },
      { id: "halo", semantic: "halo", bbox: { x: 160, y: 100, width: 70, height: 30 } },
    ],
    customTemplates: fullTemplates,
  }).model;
}

test("B-7 demo: 驱动全链——JSONL 流式驱动自定义语义参数 + 环境层，帧序列确定性 + 动画有效", async () => {
  const { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator } = await import("@l2dp/driver");
  const model = buildDrivenModel();
  const defs = model.parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def ?? 0, group: p.group }));
  const manifest = { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) };
  const library = { motions: [{ name: "灵动" }], expressions: [], behaviors: [] };
  const assets = {
    motions: new Map([["灵动", { durationMs: 1000, loop: true, curves: [{ id: "披风飘", segments: [0, 0, 0, 1, 1] }, { id: "翅膀扇", segments: [0, 0, 0, 1, 1] }] }]]),
    expressions: new Map(),
  };
  const JSONL = [
    JSON.stringify({ op: "play", asset: "灵动" }),
    JSON.stringify({ op: "set", sem: "披风飘", value: 0.85 }),
    JSON.stringify({ op: "set", sem: "翅膀扇", value: 0.7 }),
    JSON.stringify({ op: "blink" }),
  ];
  const runPipes = async (seed: number) => {
    const stack = new LayerStack(defs);
    const env = new EnvironmentLayer(defs, { seed });
    const ing = new StreamIngestor({ manifest, library, assets, stack, env, seed });
    let applied = 0, skipped = 0;
    for (const line of JSONL) { const rr = ing.feedLine(line, 0); applied += rr.applied.length; skipped += rr.skipped.length; }
    const player = new L2dmPlayer(model, new Map());
    const sw = new SoftwareRenderer();
    const hashes: string[] = [];
    const ev = new Evaluator(stack, env, defs, {
      apply(_ch, params: Record<string, number>) {
        player.params.reset();
        for (const k of Object.keys(params)) player.params.set(k, params[k]!);
        player.render(sw);
        hashes.push(createHash("sha256").update(sw.readPixels()!).digest("hex"));
      },
    });
    for (let i = 0; i < 24; i++) ev.onFrame(32);
    return { applied, skipped, hashes };
  };
  const a = await runPipes(7);
  const b = await runPipes(7);
  assert.equal(a.applied, 4, "4 条 JSONL 全应用");
  assert.equal(a.skipped, 0, "无坏行");
  assert.equal(a.hashes.length, 24, "24 动画帧");
  assert.deepEqual(a.hashes, b.hashes, "同 seed 同轨迹（确定性）");
  assert.ok(new Set(a.hashes).size > 1, "帧间像素有变化（动画有效）");
});
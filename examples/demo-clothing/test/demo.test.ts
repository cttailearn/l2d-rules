// demo-clothing（B-3）自动化断言：双服装组换装
import { test } from "node:test";
import assert from "node:assert/strict";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator, outfitLines } from "@l2dp/driver";
import { rigCharacter } from "@l2dp/rig";

const canvas = { width: 640, height: 960 };
const base = [
  { id: "face", semantic: "face", bbox: { x: 180, y: 240, width: 280, height: 200 } },
  { id: "body-upper", semantic: "body_upper", bbox: { x: 120, y: 480, width: 400, height: 320 } },
  { id: "body-lower", semantic: "body_lower", bbox: { x: 140, y: 780, width: 360, height: 160 } },
];
const clothing = [
  { id: "dress-1", semantic: "outfit_dress", costumeGroup: 1, bbox: { x: 120, y: 490, width: 400, height: 420 } },
  { id: "top-2", semantic: "outfit_top", costumeGroup: 2, bbox: { x: 120, y: 480, width: 400, height: 220 } },
  { id: "hat-2", semantic: "hairstyle", costumeGroup: 2, bbox: { x: 220, y: 170, width: 200, height: 90 } },
];

function render(model, params) {
  const player = new L2dmPlayer(model, new Map());
  player.params.reset();
  for (const [k, v] of Object.entries(params)) player.params.set(k, v);
  const sw = new SoftwareRenderer();
  player.render(sw);
  return Buffer.from(sw.readPixels()!).toString("hex");
}

test("B-3 demo: 双服装组换装改变渲染像素（组1连衣裙 vs 组2校服）", () => {
  const { model, spec, report } = rigCharacter({ id: "c", canvas, parts: [...base, ...clothing] });
  assert.equal(report.ok, true);
  // 服装组审计只含服装部件
  const g1 = spec.costumes.find((c) => c.group === 1)!;
  assert.ok(g1.partIds.includes("dress-1"));
  assert.ok(!g1.partIds.includes("face"), "身体部件不参与服装组");
  // 组参数默认 def：组1 可见、组2 隐藏
  const p2 = model.parameters.find((p) => p.id === "衣装组2")!;
  assert.equal(p2.def, 0);
  // 换装像素变化
  const a = render(model, { 衣装组1: 1, 衣装组2: 0 });
  const b = render(model, { 衣装组1: 0, 衣装组2: 1 });
  assert.notEqual(a, b, "换装应改变像素");
});

test("B-3 demo: outfitLines 经 ingestor 换装至组2（override 层生效）", () => {
  const { model, spec } = rigCharacter({ id: "c", canvas, parts: [...base, ...clothing] });
  const defs = model.parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def, group: p.group }));
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed: 7 });
  const ing = new StreamIngestor({
    manifest: { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) },
    library: { motions: [], expressions: [], behaviors: [] },
    assets: { motions: new Map(), expressions: new Map() },
    stack, env, seed: 7,
  });
  let f;
  const ev = new Evaluator(stack, env, defs, { apply(_c, params) { f = { ...params }; } });
  const lines = outfitLines(spec.costumes.map((c) => ({ group: c.group, param: c.param, partIds: c.partIds })), 2);
  for (const l of lines) ing.feedLine(l, 0);
  ev.onFrame(16);
  assert.equal(f["衣装组1"], 0);
  assert.equal(f["衣装组2"], 1);
});
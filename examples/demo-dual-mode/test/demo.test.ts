// demo-dual-mode（A3）自动化断言：在线流式坏行隔离 vs 离线整批原子拒绝
import { test } from "node:test";
import assert from "node:assert/strict";
import { StreamIngestor, LayerStack, EnvironmentLayer, batchValidate } from "@l2dp/driver";

const defs = [
  { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
  { id: "呼吸", min: 0, max: 1, def: 0.5, group: "Ambient" },
];
const manifest = { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) };
const library = { motions: [{ name: "微笑点头" }], expressions: [], behaviors: [] };
const assets = {
  motions: new Map([["微笑点头", { durationMs: 1000, loop: true, curves: [{ id: "微笑", segments: [0, 0, 0, 1, 1] }] }]]),
  expressions: new Map(),
};

const LINES = [
  '{"op":"play","asset":"微笑点头"}',
  '{"op":"set","sem":"头转向","value":999}',
  '{"op":"set","sem":"微笑","value":0.7}',
];
const STREAM = { v: 2, directives: LINES.map((l) => JSON.parse(l)) };

test("A3: 在线流式——坏行隔离，好行继续生效", () => {
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed: 7 });
  const ing = new StreamIngestor({ manifest, library, assets, stack, env, seed: 7 });
  const applied: string[] = [];
  const skipped: string[] = [];
  LINES.forEach((line, i) => {
    const r = ing.feedLine(line, i * 16);
    for (const a of r.applied) applied.push(a.op);
    for (const s of r.skipped) skipped.push("line" + i + ":" + s.reason);
  });
  assert.deepEqual(applied, ["play", "set"], "2 条好行生效");
  assert.deepEqual(skipped, ["line1:RANGE"], "坏行(越界 999)被隔离并报 RANGE");
});

test("A3: 离线整批——任一坏行整批原子拒绝", () => {
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed: 7 });
  const ing = new StreamIngestor({ manifest, library, assets, stack, env, seed: 7 });
  const r = ing.feedBatch(STREAM, 0);
  assert.equal(r.applied.length, 0, "整批被拒（原子）");
  assert.ok(r.skipped.some((s) => s.reason === "RANGE"), "含 RANGE 坏行");
});

test("A3: 批内合法子集可独立通过——规则库共享验证", () => {
  const goodOnly = { v: 2, directives: [STREAM.directives[0], STREAM.directives[2]] };
  const v = batchValidate(goodOnly, { manifest, library, assets, params: defs, seed: 7 });
  assert.equal(v.ok, true, "合法子集整批通过（坏行剔除后）");
});
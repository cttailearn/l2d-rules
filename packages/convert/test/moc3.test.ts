// moc3.test.ts —— 语料级 moc3 解析回归（41 个真实模型 + Haru）。
// 地面真值：Haru cdi3 = 42 参数 / 20 部件。参考：py-moc3 / moc3-struct.txt。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bandKeys, CountIdx, moc3ToL2dm, parseMoc3Header, readMoc3, resolveDeformerParameter } from "@l2dp/convert";
import { loadL2dmObject } from "@l2dp/engine";

const LIVE2D = join(import.meta.dirname, "..", "..", "..", "examples", "live2d");
const HARU_DIR = join(import.meta.dirname, "..", "..", "..", "examples", "demo-real", "assets-src", "haru");
const HARU = join(HARU_DIR, "Haru.moc3");

function collectMoc3(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".moc3")) out.push(p);
    }
  };
  walk(root);
  return out;
}

const CORPUS = [...collectMoc3(LIVE2D), HARU];

const haruCdi = JSON.parse(
  readFileSync(join(HARU_DIR, "Haru.cdi3.json"), "utf8"),
) as { Parameters: { Id: string }[]; Parts: { Id: string }[] };

test(`容器头：${CORPUS.length} 个模型（魔字 MOC3 / 版本 / SOT 前项 house style）`, () => {
  for (const f of CORPUS) {
    const r = parseMoc3Header(new Uint8Array(readFileSync(f)));
    assert.equal(r.ok, true, `${f}: ${r.ok ? "" : r.error}`);
    if (!r.ok) continue;
    const h = r.header;
    assert.equal(h.magic, "MOC3");
    assert.ok(h.version === 1 || h.version === 2, `${f} version=${h.version}`);
    assert.equal(h.sot[0], 0x7c0, `${f} sot[0](countInfo)`);
    assert.equal(h.sot[1], 0x840, `${f} sot[1](canvas)`);
    assert.equal(h.sot[2], 0x880, `${f} sot[2](parts)`);
  }
});

test(`readMoc3：${CORPUS.length} 个模型全量解析（counts 自洽：ids 长度 == counts）`, () => {
  for (const f of CORPUS) {
    const r = readMoc3(new Uint8Array(readFileSync(f)));
    assert.equal(r.ok, true, `${f}: ${r.ok ? "" : r.error}`);
    if (!r.ok) continue;
    const moc = r.moc;
    assert.ok(moc.counts[CountIdx.PARTS]! > 0, `${f} parts>0`);
    assert.ok(moc.counts[CountIdx.PARAMETERS]! > 0, `${f} params>0`);
    assert.equal((moc.sections["part.ids"] ?? []).length, moc.counts[CountIdx.PARTS], `${f} part.ids`);
    assert.equal((moc.sections["art_mesh.ids"] ?? []).length, moc.counts[CountIdx.ART_MESHES], `${f} art_mesh.ids`);
    assert.ok(moc.canvas.width > 0 && moc.canvas.height > 0, `${f} canvas`);
  }
});

test("Haru：counts/参数/部件与 cdi3 地面真值一致（42 参数 / 20 部件）", () => {
  const r = readMoc3(new Uint8Array(readFileSync(HARU)));
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) return;
  const moc = r.moc;
  // moc3 运行时部件 19（cdi3 的 20 项含「コアパーツ」引导部件，不入 moc3）
  assert.equal(moc.counts[CountIdx.PARTS], 19);
  assert.equal(moc.counts[CountIdx.PARAMETERS], 42);
  const paramIds = (moc.sections["parameter.ids"] as string[]).map((s) => s.trim());
  assert.deepEqual([...paramIds].sort(), [...(haruCdi.Parameters ?? []).map((p) => p.Id)].sort());
  // 画布合理（Haru 模型坐标系尺度）
  assert.ok(moc.canvas.width >= 100 && moc.canvas.height >= 100);
});

test("moc3ToL2dm：真实几何 .l2dm 通过 engine 校验", () => {
  const r = readMoc3(new Uint8Array(readFileSync(HARU)));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const model = moc3ToL2dm(r.moc, { id: "Haru", groups: [], canvas: null });
  const v = loadL2dmObject(model as unknown as Record<string, unknown>);
  assert.equal(v.ok, true, v.ok ? "" : v.error);
  if (v.ok) {
    assert.equal(v.model.parts.length, r.moc.counts[CountIdx.ART_MESHES]);
    assert.equal(v.model.parameters.length, r.moc.counts[CountIdx.PARAMETERS]);
    // 每个部件网格必为合法三角形（顶点/UV/索引齐备）
    for (const p of v.model.parts) {
      if (!p.mesh) continue;
      assert.ok(p.mesh.vertices.length > 0);
      assert.equal(p.mesh.uvs.length, p.mesh.vertices.length);
      assert.equal(p.mesh.indices.length % 3, 0);
    }
  }
});

test("M4：deformer 树 + 部件父级接线（真实 Haru）", () => {
  const r = readMoc3(new Uint8Array(readFileSync(HARU)));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const model = moc3ToL2dm(r.moc, { id: "Haru", groups: [], canvas: null });
  const defs = model.deformers ?? [];
  assert.ok(defs.length > 0, "应有 deformer 树");
  const ids = new Set(defs.map((d) => d.id));
  for (const d of defs) {
    if (d.parent !== undefined) assert.ok(ids.has(d.parent), `deformer ${d.id} 的父 ${d.parent} 存在`);
  }
  const parented = model.parts.filter((p) => p.parent !== undefined);
  assert.ok(parented.length > 0, "有部件挂在 deformer 下");
  // 缺省不输出旋转 bindings（origin 坐标系未验证 → 避免虚假旋转）
  for (const d of defs) assert.equal(d.bindings, undefined, `${d.id} 默认无实验性 binding`);
  const v = loadL2dmObject(model as unknown as Record<string, unknown>);
  assert.equal(v.ok, true, v.ok ? "" : v.error);
});

test("M4：resolveDeformerParameter / bandKeys 工具（真实 Haru）", () => {
  const r = readMoc3(new Uint8Array(readFileSync(HARU)));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const S = r.moc.sections;
  const band7 = resolveDeformerParameter(S, 7);
  const band22 = resolveDeformerParameter(S, 22);
  assert.ok(band7 !== undefined && band7.startsWith("Param"), `band 7 应解析到参数（得 ${band7}）`);
  assert.equal(band22, "ParamBustY", "band 22 解析到 ParamBustY（实测）");
  assert.equal(resolveDeformerParameter(S, 0), undefined, "band 0 为空（count 0）");
  const keys = bandKeys(S, 22);
  assert.ok(keys.length > 0, "band 22 应有 key 值");
  assert.deepEqual([...keys].sort((a, b) => a - b), [-10, 0, 10], "Haru 头/身 key -10/0/10");
});

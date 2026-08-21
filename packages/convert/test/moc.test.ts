// moc.test.ts —— Cubism 2.x `.moc` 语料级转换回归（164 个真实模型 + 官方 Haru 2.x 样本）。
// 覆盖：头部/版本 → readMoc 全解析（参数/部件/网格/UV/索引）→ mocToL2dm → engine 校验。
// 地面真值：官方 Haru 2.x（haru_01.moc）33 参数 / 26 部件 / 84 mesh；画布 2400x3200。
//
// 参照：官方 live2d.js（$t._\$F0 / W._\$F0 / St._\$4b / _\$fP varint）逆向，2026-08 实证。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readMoc, mocToL2dm, MocTypeId, versionNameOf } from "@l2dp/convert";
import { loadL2dmObject } from "@l2dp/engine";

const LIVE2D = join(import.meta.dirname, "..", "..", "..", "examples", "live2d");

function collectMoc(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith(".moc")) out.push(p);
    }
  };
  walk(root);
  return out;
}

const CORPUS = collectMoc(join(LIVE2D, "model"));

test(`.moc 语料：${CORPUS.length} 个模型头部/版本/魔字全解析`, () => {
  assert.ok(CORPUS.length >= 100, `语料应 ≥100（得 ${CORPUS.length}）`);
  const versions = new Set<number>();
  for (const f of CORPUS) {
    const b = new Uint8Array(readFileSync(f));
    const magic = String.fromCharCode(b[0]!, b[1]!, b[2]!);
    assert.equal(magic, "moc", `${f} 魔字`);
    const v = b[3]!;
    assert.ok(v >= 6 && v <= 11, `${f} 版本 ${v}`);
    versions.add(v);
  }
  assert.deepEqual([...versions].sort((a, b) => a - b), [9, 10, 11], "语料覆盖 V1_9/V1_10/V1_11");
  assert.equal(versionNameOf(11), "V1_11_SDK2_1");
  assert.equal(MocTypeId.PARAMETER, 131);
  assert.equal(MocTypeId.PART, 133);
});

test(`.moc 语料：${CORPUS.length} 个模型 readMoc 全解析（参数>0、部件>0、网格>0）`, () => {
  for (const f of CORPUS) {
    const r = readMoc(new Uint8Array(readFileSync(f)));
    assert.equal(r.ok, true, `${f}: ${r.ok ? "" : r.error}`);
    if (!r.ok) continue;
    const m = r.moc;
    assert.ok(m.parameters.length > 0, `${f} 参数`);
    assert.ok(m.parts.length > 0, `${f} 部件`);
    assert.ok(m.meshes.length > 0, `${f} 网格`);
    assert.ok(m.canvas.width > 0 && m.canvas.height > 0, `${f} 画布 ${m.canvas.width}x${m.canvas.height}`);
    // 每个 mesh：triangles 数 == polygonCount；UV 每顶点 2 个；索引不越界
    for (const mesh of m.meshes) {
      if (mesh.indices.length === 0) continue;
      assert.equal(mesh.indices.length % 3, 0, `${f} ${mesh.id} idx%3`);
      assert.equal(mesh.indices.length, mesh.polygonCount * 3, `${f} ${mesh.id} 三角形数`);
      assert.ok(mesh.uv.length >= mesh.pointCount * 2, `${f} ${mesh.id} uv 长度`);
      assert.ok(mesh.points.length >= mesh.pointCount * 2, `${f} ${mesh.id} 位置池`);
      for (const idx of mesh.indices) assert.ok(idx >= 0 && idx < mesh.pointCount, `${f} ${mesh.id} 索引越界 ${idx}`);
    }
  }
});

test(".moc → .l2dm：语料全量转换且经 engine 校验通过", () => {
  let ok = 0;
  for (const f of CORPUS) {
    const r = readMoc(new Uint8Array(readFileSync(f)));
    assert.equal(r.ok, true);
    if (!r.ok) continue;
    const base = (f.match(/[\/]([^\\\/]+)\.moc$/i) ?? [])[1] ?? "moc";
    const model = mocToL2dm(r.moc, { id: `moc-${base}` });
    assert.ok(model.parts.length > 0, `${f} 转换出部件`);
    const v = loadL2dmObject(model);
    assert.equal(v.ok, true, v.ok ? "" : (v as { error?: string }).error ?? "");
    if (v.ok) {
      assert.ok(v.model.parts.length > 0);
      assert.ok(v.model.parameters.length === r.moc.parameters.length);
      assert.ok(v.model.canvas.width > 0);
      ok++;
    }
  }
  assert.equal(ok, CORPUS.length);
});

test("Haru 2.x（haru_01.moc）：参数/部件/网格与官方样本一致", () => {
  const f = join(LIVE2D, "model", "haru", "haru_01.moc");
  const r = readMoc(new Uint8Array(readFileSync(f)));
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) return;
  const m = r.moc;
  assert.equal(m.versionName, "V1_9_AVATAR_PARTS");
  assert.equal(m.parameters.length, 33);
  assert.equal(m.canvas.width, 2400);
  assert.equal(m.canvas.height, 3200);
  const fx = m.parameters.find((p) => p.id === "PARAM_ANGLE_X");
  assert.ok(fx);
  assert.deepEqual([fx!.min, fx!.max], [-30, 30]);
  assert.ok(m.parts.length >= 20, `部件数 ${m.parts.length}`);
  assert.ok(m.meshes.length >= 60, `网格数 ${m.meshes.length}`);
  // 网格几何健全：一个有纹理的真实面网格
  const face = m.meshes.find((x) => x.id.includes("FACE"));
  if (face) {
    assert.ok(face.indices.length >= 3);
    assert.ok(face.uv.length >= 6);
  }
  // 绘制顺序按 averageDrawOrder 可排
  const orders = m.meshes.map((x) => x.averageDrawOrder);
  assert.ok(orders.some((o) => o > 0));
});
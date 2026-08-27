// convert.test.ts —— 真实官方 Haru 模型 转换全链路（Phase 1）
// 覆盖：model3/cdi3/physics3/pose3/userdata3 解析 → ConvertedBundle 结构
//      → .l2dm 骨架发射 → engine validateL2dmModel 通过 → 参数组映射正确。
// 素材：examples/demo-app/public/official-haru（官方 Haru sample，只读消费）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { loadL2dmObject } from "@l2dp/engine";
import { convertLive2dModel, parseModel3, parseCdi3, toL2dmSkeleton } from "@l2dp/convert";

const here = dirname(fileURLToPath(import.meta.url));
const HARU = join(here, "..", "..", "..", "examples", "demo-app", "public", "official-haru") + sep;

async function fsLoader(rel: string): Promise<{ text?: string; bytes?: Uint8Array }> {
  const buf = await readFile(join(HARU, rel));
  return /\.json$/i.test(rel) ? { text: buf.toString("utf8") } : { bytes: new Uint8Array(buf) };
}

async function loadHaruModel3(): Promise<unknown> {
  return JSON.parse(await readFile(join(HARU, "Haru.model3.json"), "utf8"));
}

test("parseModel3 读取真实 Haru 结构", async () => {
  const p = parseModel3(await loadHaruModel3());
  assert.equal(p.ok, true);
  if (!p.ok) return;
  const m = p.value;
  assert.equal(m.Version, 3);
  assert.equal(m.FileReferences.Moc, "Haru.moc3");
  assert.equal(m.FileReferences.Textures.length, 2);
  assert.equal(m.FileReferences.Expressions?.length, 8);
  assert.ok(m.FileReferences.Motions);
  assert.equal(m.FileReferences.Motions!["Idle"]!.length, 2);
  assert.equal(m.FileReferences.Motions!["TapBody"]!.length, 4);
  const eye = m.Groups?.find((g) => g.Name === "EyeBlink");
  assert.deepEqual(eye?.Ids, ["ParamEyeLOpen", "ParamEyeROpen"]);
});

test("parseCdi3 读取参数/部件目录", async () => {
  const raw = JSON.parse(await readFile(join(HARU, "Haru.cdi3.json"), "utf8"));
  const c = parseCdi3(raw);
  assert.equal(c.ok, true);
  if (!c.ok) return;
  assert.equal(c.value.Parameters?.length, 42);
  assert.equal(c.value.ParameterGroups?.length, 7);
  assert.equal(c.value.Parts?.length, 20);
});

test("convertLive2dModel 产出完整 bundle", async () => {
  const r = await convertLive2dModel(await loadHaruModel3(), fsLoader, { name: "Haru" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const b = r.bundle!;
  assert.equal(b.source, "Haru");
  assert.equal(b.fileRefs.moc, "Haru.moc3");
  assert.ok(b.fileRefs.mocSize !== null && b.fileRefs.mocSize > 0, "记录 moc3 尺寸");
  assert.equal(b.fileRefs.textures.length, 2);
  assert.ok(b.params.length >= 41, `参数数 ${b.params.length}`);
  assert.equal(b.parts.length, 20);
  assert.equal(b.motions.length, 6, "model3 引用 6 个 motion（Idle2+TapBody4）");
  assert.equal(b.expressions.length, 8);
  assert.equal(b.physics?.settings.length, 4);
  assert.equal(b.pose?.groups.length, 2);
  assert.equal(b.groups.length, 2);
  assert.equal(r.warnings.length, 0, `无警告: ${r.warnings.join("; ")}`);
});

test("参数组映射：EyeBlink/LipSync/Ambient/Head", async () => {
  const r = await convertLive2dModel(await loadHaruModel3(), fsLoader, { name: "Haru" });
  assert.equal(r.ok, true);
  const b = r.bundle!;
  const g = (id: string) => b.params.find((p) => p.id === id)?.engineGroup;
  assert.equal(g("ParamEyeLOpen"), "EyeBlink");
  assert.equal(g("ParamEyeROpen"), "EyeBlink");
  assert.equal(g("ParamMouthOpenY"), "LipSync");
  assert.equal(g("ParamBreath"), "Ambient");
  assert.equal(g("ParamAngleX"), "Head");
});

test("toL2dmSkeleton 骨架通过 engine validateL2dmModel", async () => {
  const r = await convertLive2dModel(await loadHaruModel3(), fsLoader, { name: "Haru" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const skeleton = toL2dmSkeleton(r.bundle!);
  const v = loadL2dmObject(skeleton as unknown as Record<string, unknown>);
  assert.equal(v.ok, true, v.ok ? "" : v.error);
  if (v.ok) {
    assert.equal(v.model.id, "Haru");
    assert.equal(v.model.parameters.length, r.bundle!.params.length);
    assert.equal(v.model.parts.length, 20);
    assert.ok((v.model.physics?.pendulums.length ?? 0) >= 3);
  }
});

test("motion3 曲线采样：官方 markered Segments 可直接被 engine 解析", async () => {
  const r = await convertLive2dModel(await loadHaruModel3(), fsLoader, { name: "Haru" });
  assert.equal(r.ok, true);
  const idle = r.bundle!.motions.find((m) => m.name === "haru_g_idle");
  assert.ok(idle, "能找到 idle");
  // 每个 motion 曲线非空且时长 > 0（driver curveIssues 硬要求）
  for (const mo of r.bundle!.motions) {
    assert.ok(mo.motion.durationMs > 0, `${mo.name} duration>0`);
    assert.ok(mo.motion.curves.length > 0);
  }
  // 官方 id（camelCase）当作语义名保留
  assert.ok(idle!.motion.curves.some((c) => c.id === "ParamAngleX"));
});

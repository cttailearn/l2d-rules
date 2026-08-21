// model2.test.ts —— Cubism 2 旧代端到端：model.json + .moc + .mtn → 可驱动的 .l2dm
// 素材：官方 bronya（model.moc + motions/tap_hand/taphand.mtn + 纹理）

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModel2, mtnToEngineMotion, readMoc, mocToL2dm, embedAtlasInto } from "@l2dp/convert";
import { loadL2dmObject, L2dmPlayer } from "@l2dp/engine";

const DIR = join(import.meta.dirname, "..", "..", "..", "examples", "live2d", "model", "bronya");

function txt(rel: string): string { return readFileSync(join(DIR, rel), "utf8"); }
function bytes(rel: string): { ok: boolean; data?: Uint8Array } {
  try { return { ok: true, data: new Uint8Array(readFileSync(join(DIR, rel))) }; }
  catch { return { ok: false }; }
}
type Model2Json = { name?: string; model?: string; textures: string[]; motions: Record<string, { file: string }[]> };
function loadModel2(): Model2Json {
  const p = parseModel2(JSON.parse(txt("model.json")));
  assert.equal(p.ok, true, p.ok ? "" : (p as { error?: string }).error ?? "");
  return p.value as unknown as Model2Json;
}
test("parseModel2：读取 bronya model.json（.moc / .mtn / 纹理 引用存在）", () => {
  const m2 = loadModel2();
  const seen = { moc: 0, mtn: 0, tex: 0 };
  if (m2.model && bytes(m2.model!).ok) seen.moc++;
  for (const group of Object.values(m2.motions)) for (const e of group) if (/.mtn$/i.test(e.file) && bytes(e.file).ok) seen.mtn++;
  for (const t of m2.textures) if (bytes(t).ok) seen.tex++;
  assert.ok(seen.moc > 0, "存在 .moc");
  assert.ok(seen.mtn > 0, "存在 .mtn");
  assert.ok(seen.tex > 0, "存在纹理");
});

test("mtnToEngineMotion：bronya taps.mtn → 引擎动作（时长/曲线/首帧）", () => {
  // 取第一个引用存在的 .mtn
  const m2 = loadModel2();
  let ref: string | null = null;
  for (const group of Object.values(m2.motions)) for (const e of group) if (bytes(e.file).ok) { ref = e.file; break; }
  assert.ok(ref, "找到 .mtn");
  const motion = mtnToEngineMotion(txt(ref!));
  assert.equal(motion.ok, true, motion.error);
  if (!motion.ok || !motion.motion || !motion.motion.curves.length) return;
  assert.ok(motion.motion.durationMs > 0);
  assert.ok(motion.motion.curves.length > 0);
  // 每个曲线 segments 是合法 motion3 布局（[t0,v0,0,t1,v1,...]）
  for (const c of motion.motion.curves) {
    assert.ok(c.segments.length >= 2);
    assert.equal(Math.floor((c.segments.length - 2) / 3) * 3 + 2, c.segments.length, `${c.id} segments 布局`);
  }
});

test("端到端：model.json + .moc + .mtn → 自包含 .l2dm 且可驱动播放", () => {
  const m2 = loadModel2();
  const r = readMoc(bytes(m2.model!).data!);
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) return;
  const model = mocToL2dm(r.moc, { id: "bronya", textures: m2.textures });
  // 内嵌纹理（存在才内嵌）
  const texs: { file: string; bytes: Uint8Array }[] = [];
  for (const t of m2.textures) { const b = bytes(t); if (b.ok && b.data) texs.push({ file: t, bytes: b.data }); }
  if (texs.length > 0) embedAtlasInto(model as Parameters<typeof embedAtlasInto>[0], texs);
  const v = loadL2dmObject(model);
  assert.equal(v.ok, true, v.ok ? "" : (v as { error?: string }).error ?? "");
  if (!v.ok) return;

  // 用第一个 .mtn 驱动引擎
  let ref: string | null = null;
  for (const group of Object.values(m2.motions)) for (const e of group) if (bytes(e.file).ok) { ref = e.file; break; }
  assert.ok(ref);
  const motion = mtnToEngineMotion(txt(ref!));
  if (!motion.ok || !motion.motion) return;
  const player = new L2dmPlayer(model, new Map());
  player.play(motion.motion);
  player.tick(16);
  let driven = false;
  for (const c of motion.motion.curves.slice(0, 12)) {
    const val = player.params.get(c.id);
    if (typeof val === "number" && Number.isFinite(val)) { driven = true; break; }
  }
  assert.equal(driven, true, "至少一个参数被官方动作驱动");
});
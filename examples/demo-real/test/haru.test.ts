// haru.test.ts —— 真实官方 Haru 模型 端到端断言（转换 → 骨架 → driver 驱动，确定性）
// 链路与 src/run.ts 一致；本测试额外验证确定性（同 seed 同轨迹）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { L2dmPlayer, SoftwareRenderer, loadL2dmObject } from "@l2dp/engine";
import { decodeModelAtlas } from "@l2dp/host";
import { addPart, convertLive2dModel, createL2dm, moc3ToL2dm, readMoc3, setParamRange, toL2dmArtifact, toL2dmSkeleton, validate } from "@l2dp/convert";
import { EnvironmentLayer, Evaluator, LayerStack, StreamIngestor } from "@l2dp/driver";
import type { EnvParamDef } from "@l2dp/driver";
import type { ConvertedBundle } from "@l2dp/convert";

const here = dirname(fileURLToPath(import.meta.url));
const HARU = join(here, "..", "assets-src", "haru") + sep;

async function fsLoader(rel: string): Promise<{ text?: string; bytes?: Uint8Array }> {
  const buf = await readFile(join(HARU, rel));
  return /\.json$/i.test(rel) ? { text: buf.toString("utf8") } : { bytes: new Uint8Array(buf) };
}

async function build(): Promise<ConvertedBundle> {
  const model3Raw = JSON.parse(await readFile(join(HARU, "Haru.model3.json"), "utf8"));
  const r = await convertLive2dModel(model3Raw, fsLoader, { name: "Haru" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.warnings.length, 0, r.warnings.join("; "));
  return r.bundle!;
}

const JSONL = [
  '{"op":"play","asset":"haru_g_idle"}',
  '{"op":"face","expression":"F01"}',
  '{"op":"blink"}',
];

function drive(bundle: ConvertedBundle, seed: number): { trail: Record<string, number>[]; applied: number; skipped: number } {
  const defs: EnvParamDef[] = bundle.params.map((p) => ({ id: p.id, min: p.min, max: p.max, group: p.engineGroup, def: p.def }));
  const manifest = { sems: bundle.params.map((p) => ({ name: p.id, min: p.min, max: p.max, group: p.engineGroup, def: p.def })) };
  const library: { motions: { name: string; group?: string }[]; expressions: { name: string }[]; behaviors: never[] } = {
    motions: bundle.motions.map((m) => ({ name: m.name, group: m.group })),
    expressions: bundle.expressions.map((e) => ({ name: e.name })),
    behaviors: [],
  };
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed });
  const ing = new StreamIngestor({
    manifest,
    library,
    assets: {
      motions: new Map(bundle.motions.map((m) => [m.name, m.motion])),
      expressions: new Map(bundle.expressions.map((e) => [e.name, e.expression])),
    },
    stack,
    env,
    seed,
  });

  let applied = 0;
  let skipped = 0;
  for (const line of JSONL) {
    const res = ing.feedLine(line, 0);
    applied += res.applied.length;
    skipped += res.skipped.length;
  }
  const trail: Record<string, number>[] = [];
  const ev = new Evaluator(stack, env, defs, {
    apply(_ch, params) { trail.push({ ...params }); },
  });
  for (let i = 0; i < 120; i++) ev.onFrame(16);
  return { trail, applied, skipped };
}

function pick(trail: Record<string, number>[], id: string): number[] {
  return trail.map((t) => t[id] ?? 0);
}

test("转换：结构完整、无警告", async () => {
  const b = await build();
  assert.ok(b.params.length >= 41);
  assert.equal(b.parts.length, 20);
  assert.equal(b.motions.length, 6);
  assert.equal(b.expressions.length, 8);
  assert.equal(b.physics?.settings.length, 4);
  assert.equal(b.pose?.groups.length, 2);
});

test("骨架：engine 校验通过，id/参数/部件一致", async () => {
  const b = await build();
  const skeleton = toL2dmSkeleton(b);
  const v = loadL2dmObject(skeleton as unknown as Record<string, unknown>);
  assert.equal(v.ok, true, v.ok ? "" : v.error);
  if (v.ok) {
    assert.equal(v.model.id, "Haru");
    assert.equal(v.model.parameters.length, b.params.length);
    assert.equal(v.model.parts.length, 20);
  }
});

test("驱动：JSONL 全应用、真实运动有输出、blink 强制眨眼", async () => {
  const b = await build();
  const { trail, applied, skipped } = drive(b, 42);
  assert.equal(applied, 3);
  assert.equal(skipped, 0);
  const angleY = pick(trail, "ParamAngleY");
  assert.ok(angleY.some((v) => v !== 0), "ParamAngleY 被真实 motion 驱动");
  const eyes = pick(trail, "ParamEyeLOpen");
  assert.ok(Math.max(...eyes) >= 0.99, `ParamEyeLOpen 峰值 ${Math.max(...eyes)}`);
});

test("确定性：同 seed 同轨迹", async () => {
  const b = await build();
  const a = drive(b, 42).trail;
  const c = drive(b, 42).trail;
  assert.equal(a.length, c.length);
  for (let i = 0; i < a.length; i++) {
    for (const k of Object.keys(a[i]!)) assert.equal(a[i]![k], c[i]![k], `帧 ${i} ${k}`);
  }
});

test("自包含 .l2dm：真实 Haru 纹理内嵌 + engine 校验通过", async () => {
  const b = await build();
  const textures = [];
  for (const t of b.fileRefs.textures) {
    const buf = await readFile(join(HARU, t.file));
    textures.push({ file: t.file, bytes: new Uint8Array(buf) });
  }
  const art = toL2dmArtifact(b, { textures });
  const v = loadL2dmObject(art);
  assert.equal(v.ok, true, v.ok ? "" : v.error);
  assert.equal(Object.keys(art.atlas!).length, 2, "两张 Haru 纹理均内嵌");
  assert.ok(art.atlas!["Haru.2048/texture_00.png"]!.startsWith("data:image/png;base64,"));
  if (v.ok) assert.equal(v.model.parts.length, 20);
});

test("二次修改：转换产物可编辑（改范围/加部件/引用纹理），编辑后校验通过", async () => {
  const b = await build();
  const art = toL2dmArtifact(b, { textures: [] });
  setParamRange(art, "ParamMouthOpenY", 0, 1, 0);
  addPart(art, {
    id: "custom-badge", order: 999, color: [1, 0.84, 0.3, 1],
    mesh: { vertices: [0, 0, 6, 0, 6, 6, 0, 6], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] },
  });
  const v = validate(art);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.ok(art.parts.some((p) => p.id === "custom-badge"));
});

test("从零构建：createL2dm + 编辑 API 产出合法模型", async () => {
  const m = createL2dm({
    id: "mascot",
    canvas: { width: 64, height: 64 },
    parameters: [
      { id: "开心", min: 0, max: 1 },
      { id: "眨眼", min: 0, max: 1, group: "EyeBlink" },
    ],
  });
  addPart(m, {
    id: "body", color: [0.2, 0.7, 1, 1],
    mesh: { vertices: [0, 0, 24, 0, 24, 24, 0, 24], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] },
  });
  const v = validate(m);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.equal(m.id, "mascot");
});
test("A6 回环：官方 .moc3 真实几何→.l2dm→引擎软件渲染（真实网格 + 确定性 + 驱动可见）", async () => {
  // 1) 真实几何路径（Phase 2）：readMoc3 解析二进制 → moc3ToL2dm 产真实 ArtMesh 几何 + 烘焙 warp
  const mocBytes = new Uint8Array(await readFile(join(HARU, "Haru.moc3")));
  const rm = readMoc3(mocBytes);
  assert.equal(rm.ok, true, rm.ok ? "" : rm.error);
  const texNames = ["Haru.2048/texture_00.png", "Haru.2048/texture_01.png"];
  const geoModel = moc3ToL2dm(rm.moc, { id: "Haru-geo", textures: texNames, targetHeight: 800 });
  assert.ok(geoModel.parts.length >= 50, "真实几何部件数 ≥50（实际 " + geoModel.parts.length + "）");
  const warpParams = new Set<string>();
  for (const p of geoModel.parts) {
    for (const w of p.mesh?.warps ?? []) warpParams.add(w.parameter);
    for (const w2 of p.mesh?.warp2d ?? []) for (const pp of w2.parameters) warpParams.add(pp);
  }
  assert.ok(warpParams.size >= 10, "真实 warp 绑定参数 ≥10（实际 " + warpParams.size + "）");

  // 2) 校验装载 + 真实纹理 atlas
  const lr = loadL2dmObject(geoModel);
  if (!lr.ok) throw new Error(lr.error);
  const uriAtlas: Record<string, string> = {};
  for (const t of texNames) {
    const b = await readFile(join(HARU, t));
    uriAtlas[t] = "data:image/png;base64," + Buffer.from(b).toString("base64");
  }
  const atlas = decodeModelAtlas(uriAtlas);
  assert.equal(atlas.size, 2, "真实 Haru 两纹理解码（实际 " + atlas.size + "）");

  // 3) 渲染回环：非空 + 确定性 + 参数驱动可见
  const sw0 = new SoftwareRenderer();
  const player0 = new L2dmPlayer(lr.model, atlas);
  player0.params.reset(); player0.render(sw0);
  const px = sw0.readPixels()!;
  let opaque = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]! >= 128) opaque++;
  assert.ok(opaque > 1000, "真实几何渲染非空（不透明 " + opaque + " 像素）");

  const renderHash = (drive: (p: { set(id: string, v: number): boolean }) => void): string => {
    const sw = new SoftwareRenderer();
    const pl = new L2dmPlayer(lr.model, atlas);
    pl.params.reset();
    drive(pl.params);
    pl.render(sw);
    return createHash("sha256").update(sw.readPixels()!).digest("hex");
  };
  const rest = renderHash(() => {});
  assert.equal(renderHash(() => {}), rest, "确定性：同 rest 同哈希");
  const drivable: string[] = [];
  for (const p of lr.model.parameters) {
    if (Math.abs(p.max - p.min) < 1e-6) continue;
    const drv = renderHash((pp) => { pp.set(p.id, p.max); });
    if (drv !== rest) drivable.push(p.id);
  }
  assert.ok(drivable.length >= 2, "真实几何回环可驱动可见变化 ≥2 参数（实际 " + drivable.length + ": " + drivable.slice(0, 8).join(",") + "）");
});

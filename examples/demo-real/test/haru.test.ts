// haru.test.ts —— 真实官方 Haru 模型 端到端断言（转换 → 骨架 → driver 驱动，确定性）
// 链路与 src/run.ts 一致；本测试额外验证确定性（同 seed 同轨迹）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { loadL2dmObject } from "@l2dp/engine";
import { addPart, convertLive2dModel, createL2dm, setParamRange, toL2dmArtifact, toL2dmSkeleton, validate } from "@l2dp/convert";
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

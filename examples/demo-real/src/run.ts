// run.ts —— 真实官方 Live2D 模型（Haru sample）端到端运行器
// 链路：assets-src/haru → @l2dp/convert（转换 + 自包含 .l2dm 产物）
//      → @l2dp/driver（JSONL 流式驱动：play/face/blink → 每帧参数）
// 产物（out/）：haru-converted.l2dm（骨架）、haru-full.l2dm（自包含：骨架+内嵌纹理）、
//              haru-edited.l2dm（二次修改示例）、my-mascot.l2dm（从零构建示例）、
//              haru-bundle.json（转换包）、report.txt
//
// 运行：node src/run.ts（or npm start）。Node ≥ 23.6 原生跑 TS。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { loadL2dmObject } from "@l2dp/engine";
import {
  addPart, attachTexture, convertLive2dModel, createL2dm, embedTexture,
  setParamRange, toL2dmArtifact, toL2dmSkeleton,
} from "@l2dp/convert";
import { EnvironmentLayer, Evaluator, LayerStack, StreamIngestor } from "@l2dp/driver";
import type { EnvParamDef } from "@l2dp/driver";

const here = dirname(fileURLToPath(import.meta.url));
const HARU = join(here, "..", "assets-src", "haru") + sep;
const OUT = join(here, "..", "out");

/** 文件加载器：相对模型目录路径 → text（JSON）/ bytes（moc3/png） */
async function fsLoader(rel: string): Promise<{ text?: string; bytes?: Uint8Array }> {
  const buf = await readFile(join(HARU, rel));
  return /\.json$/i.test(rel) ? { text: buf.toString("utf8") } : { bytes: new Uint8Array(buf) };
}

async function readTextures(bundle: { fileRefs: { textures: { file: string }[] } }): Promise<{ file: string; bytes: Uint8Array }[]> {
  const out: { file: string; bytes: Uint8Array }[] = [];
  for (const t of bundle.fileRefs.textures) out.push({ file: t.file, bytes: new Uint8Array(await readFile(join(HARU, t.file))) });
  return out;
}

async function main(): Promise<void> {
  const model3Raw = JSON.parse(await readFile(join(HARU, "Haru.model3.json"), "utf8"));

  // 1) 转换官方 model3 包 → SDK 语义资产
  const r = await convertLive2dModel(model3Raw, fsLoader, { name: "Haru" });
  if (!r.ok) { console.error("❌ 转换失败:", r.error); process.exit(1); }
  const bundle = r.bundle!;
  for (const w of r.warnings) console.warn("⚠", w);

  // 2) 三种 .l2dm 产物
  const skeleton = toL2dmSkeleton(bundle); // 纯骨架
  const fullArt = toL2dmArtifact(bundle, { textures: await readTextures(bundle) }); // 自包含（内嵌纹理）
  const edited = structuredClone(fullArt); // 二次修改（官方转换产物直接编辑）
  attachTexture(edited, edited.parts[0]!.id, "Haru.2048/texture_00.png");
  setParamRange(edited, "ParamMouthOpenY", 0, 1, 0);
  addPart(edited, {
    id: "emblem", order: 100, color: [1, 0.88, 0.3, 1],
    mesh: { vertices: [30, 30, 40, 30, 40, 40, 30, 40], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] },
  });
  const mascot = createL2dm({ id: "my-mascot", parameters: [{ id: "开心", min: 0, max: 1 }] }); // 从零
  addPart(mascot, {
    id: "body", color: [1, 0.5, 0.2, 1],
    mesh: { vertices: [0, 0, 16, 0, 16, 16, 0, 16], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] },
  });
  embedTexture(mascot, "tex_00.png", (await readTextures(bundle))[0]!.bytes);

  for (const [name, m] of [["skeleton", skeleton], ["fullArt", fullArt], ["edited", edited], ["mascot", mascot]] as const) {
    const v = loadL2dmObject(m);
    if (!v.ok) { console.error(`❌ ${name} 校验失败:`, v.error); process.exit(1); }
  }

  // 3) driver 接线 + JSONL 驱动
  const defs: EnvParamDef[] = bundle.params.map((p) => ({ id: p.id, min: p.min, max: p.max, group: p.engineGroup, def: p.def }));
  const manifest = { sems: bundle.params.map((p) => ({ name: p.id, min: p.min, max: p.max, group: p.engineGroup, def: p.def })) };
  const library: { motions: { name: string; group?: string }[]; expressions: { name: string }[]; behaviors: never[] } = {
    motions: bundle.motions.map((m) => ({ name: m.name, group: m.group })),
    expressions: bundle.expressions.map((e) => ({ name: e.name })),
    behaviors: [],
  };
  const assets = {
    motions: new Map(bundle.motions.map((m) => [m.name, m.motion])),
    expressions: new Map(bundle.expressions.map((e) => [e.name, e.expression])),
  };
  const seed = 42;
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed });
  const ing = new StreamIngestor({ manifest, library, assets, stack, env, seed });
  let last: Record<string, number> = {};
  const ev = new Evaluator(stack, env, defs, { apply(_ch, params) { last = params; } });

  const jsonl = [
    { op: "play", asset: "haru_g_idle" },
    { op: "face", expression: "F01" },
    { op: "blink" },
  ];
  let applied = 0, skipped = 0;
  for (const d of jsonl) {
    const res = ing.feedLine(JSON.stringify(d), 0);
    applied += res.applied.length; skipped += res.skipped.length;
  }
  for (let i = 0; i < 120; i++) ev.onFrame(16);

  // 4) 报告 + 写入产物
  const line = `转换 OK · 参数 ${bundle.params.length} · 部件 ${bundle.parts.length} · 运动 ${bundle.motions.length} · ` +
    `表情 ${bundle.expressions.length} · 物理 ${bundle.physics?.settings.length} · pose组 ${bundle.pose?.groups.length} · ` +
    `纹理 ${bundle.fileRefs.textures.length}(已内嵌)`;
  console.log(`✅ ${line}`);
  console.log(`✅ JSONL 逐行驱动: applied=${applied} skipped=${skipped}`);
  console.log("帧末参数采样:");
  for (const id of ["ParamAngleX", "ParamAngleY", "ParamEyeLOpen", "ParamMouthOpenY", "ParamBreath"]) {
    const val = last[id];
    if (val !== undefined) console.log(`   ${id} = ${val.toFixed(3)}`);
  }
  console.log(`📦 .l2dm 产物（自包含，含内嵌纹理）: haru-full / haru-edited（二次修改）/ my-mascot（从零构建）`);

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "haru-converted.l2dm"), JSON.stringify(skeleton, null, 2));
  await writeFile(join(OUT, "haru-full.l2dm"), JSON.stringify(fullArt));
  await writeFile(join(OUT, "haru-edited.l2dm"), JSON.stringify(edited));
  await writeFile(join(OUT, "my-mascot.l2dm"), JSON.stringify(mascot, null, 2));
  await writeFile(join(OUT, "haru-bundle.json"), JSON.stringify(bundle, null, 2));
  await writeFile(join(OUT, "report.txt"), [line, `applied=${applied} skipped=${skipped}`].join("\n"));
  console.log(`📦 全部产物已写入 ${OUT}`);
}

main().catch((e) => { console.error("运行失败:", e); process.exit(1); });

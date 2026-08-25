// demo-custom（B-7）完整全链示例：一张带自定义部位的图 → 可动角色 → 驱动动画
// 覆盖完整能力栈：cutout(切图/标注) → create(创作 IR + 自定义语义) → rig(customTemplates 注入) → driver(JSONL 流式+环境层) → engine(软件渲染帧序列)
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { rigCharacter } from "@l2dp/rig";
import { executeCreation } from "@l2dp/create";
import { ColorKeySegmenter, ColorMapLabeler, encodePng } from "@l2dp/cutout";
import { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator } from "@l2dp/driver";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
await mkdir(join(OUT, "anim"), { recursive: true });
const report = [];
const log = (s) => report.push(s);

// ---------- 0. 自定义语义模板（运行时注入，无需改 SDK 源码） ----------
const customTemplates = {
  cape: { zh: "披风", order: 21, headCluster: false, color: [0.65, 0.38, 0.78, 1], grid: [3, 6], drive: { id: "披风飘" } },
  wing: { zh: "翅膀", order: 22, headCluster: false, color: [0.85, 0.8, 0.95, 1], grid: [3, 4], drive: { id: "翅膀扇" } },
  halo: { zh: "光环", order: 23, headCluster: true, color: [0.98, 0.85, 0.4, 1], grid: [4, 2] },
};
const canvas = { width: 500, height: 900 };
log("[0] 自定义语义模板注册: " + Object.keys(customTemplates).join("/") + "（运行时注入）");

// ---------- ① 从图：切图 + 标注（含自定义语义 + 服装语义） ----------
const W = canvas.width, H = canvas.height;
const img = { width: W, height: H, data: new Uint8Array(W * H * 4) };
const fill = (x, y, w, h, c) => {
  for (let yy = y; yy < Math.min(y + h, H); yy++) for (let xx = x; xx < Math.min(x + w, W); xx++) {
    const o = (yy * W + xx) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
};
fill(150, 200, 200, 160, [255, 214, 188]);      // face（肤色）
fill(90, 340, 320, 300, [128, 153, 230]);       // body 上躯（蓝）
fill(30, 360, 60, 330, [166, 97, 199]);         // cape 披风（紫，自定义语义）
fill(210, 150, 80, 36, [250, 217, 102]);        // halo 光环（金，自定义 headCluster）
fill(90, 350, 320, 280, [230, 102, 153]);       // dress 连衣裙（粉，服装语义，与 body 部分重叠）
const seg = new ColorKeySegmenter({ tol: 8, minArea: 300 });
const candidates = await seg.segment(img);
const labeler = new ColorMapLabeler([
  { color: [255, 214, 188], semantic: "face" },
  { color: [128, 153, 230], semantic: "body_upper" },
  { color: [166, 97, 199], semantic: "cape" },
  { color: [250, 217, 102], semantic: "halo" },
  { color: [230, 102, 153], semantic: "outfit_dress" },
]);
const cutoutParts = await labeler.label(candidates, img);
log("[① 切图标注] 候选 " + candidates.length + " → 标注部件 " + cutoutParts.length + "（语义: " + cutoutParts.map((p) => p.semantic).join("/") + "）");

// ---------- ② 创作：CutoutPart → CreationDirective（自定义语义经校验/执行全链） ----------
const directive = {
  v: 1, character: "custom-from-image", canvas: { width: W, height: H },
  parts: cutoutParts.map((p) => ({ id: p.id, semantic: p.semantic, side: p.side, bbox: p.bbox, image: p.image })),
  customTemplates,
};
const created = executeCreation(directive);
await writeFile(join(OUT, "20-from-image.l2dm"), JSON.stringify(created.model), "utf8");
log("[② 创作全链] 部件 " + created.model.parts.length + "（自定义 cape/halo + 服装 outfit_dress 入模）/ 参数 " + created.model.parameters.length);
log("   dress." + (created.model.parts.find((p) => p.id.includes("dress") || p.semantic === "outfit_dress")?.opacityParam ?? "?") + "（服装组显隐）");

// ---------- ③ 绑定：rig 层注入（同一 templates 直连 rig，供驱动演示） ----------
const model = rigCharacter({
  id: "custom-girl", canvas,
  parts: [
    { id: "face", semantic: "face", bbox: { x: 150, y: 200, width: 200, height: 160 } },
    { id: "body", semantic: "body_upper", bbox: { x: 90, y: 340, width: 320, height: 300 } },
    { id: "cape", semantic: "cape", bbox: { x: 30, y: 360, width: 60, height: 330 }, customParams: { 披风飘: { min: -1, max: 1, def: 0, group: "Custom" } } },
    { id: "wing", semantic: "wing", side: "left", bbox: { x: 350, y: 300, width: 90, height: 180 }, customParams: { 翅膀扇: { min: -1, max: 1, def: 0, group: "Custom" } } },
    { id: "halo", semantic: "halo", bbox: { x: 210, y: 150, width: 80, height: 36 } },
  ],
  customTemplates,
}).model;
log("[③ rig 注入] 部件 " + model.parts.length + " / 参数 " + model.parameters.length + "（含 披风飘/翅膀扇）");

// ---------- ④ 驱动：JSONL 流式 + 环境层 → 动画帧序列 ----------
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
async function runPipes(seed) {
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed });
  const ing = new StreamIngestor({ manifest, library, assets, stack, env, seed });
  let applied = 0, skipped = 0;
  for (const line of JSONL) { const r = ing.feedLine(line, 0); applied += r.applied.length; skipped += r.skipped.length; }
  const player = new L2dmPlayer(model, new Map());
  const sw = new SoftwareRenderer();
  const hashes = [];
  const frames = [];
  const ev = new Evaluator(stack, env, defs, {
    apply(_ch, params) {
      player.params.reset();
      for (const k of Object.keys(params)) player.params.set(k, params[k]);
      player.render(sw);
      const px = sw.readPixels();
      hashes.push(createHash("sha256").update(px).digest("hex"));
      frames.push(px.slice());
    },
  });
  const N = 24;
  for (let i = 0; i < N; i++) ev.onFrame(32);
  return { applied, skipped, hashes, frames };
}
const runA = await runPipes(7);
// 写出动画帧（前 12 帧）
for (let i = 0; i < Math.min(12, runA.frames.length); i++) {
  await writeFile(join(OUT, "anim", "frame_" + String(i).padStart(2, "0") + ".png"), Buffer.from(encodePng(W, H, runA.frames[i])));
}
log("[④ 驱动] JSONL applied=" + runA.applied + " skipped=" + runA.skipped + " · 动画帧 " + runA.frames.length + "（已写 out/anim/frame_00..11.png）");
log("   帧哈希轨迹（前 3 + 末 3）: " + runA.hashes.slice(0, 3).map((h) => h.slice(0, 8)).join(" ") + " ... " + runA.hashes.slice(-3).map((h) => h.slice(0, 8)).join(" "));
// 确定性：同 seed 重跑轨迹一致
const runB = await runPipes(7);
const deterministic = JSON.stringify(runA.hashes) === JSON.stringify(runB.hashes);
log("   确定性（同 seed 同轨迹）: " + (deterministic ? "OK" : "FAIL"));
// 自定义语义真实被驱动（帧间变化）
const animated = new Set(runA.hashes).size > 1;
log("   动画有效性（帧间像素有变化）: " + (animated ? "OK" : "警告：静止"));

await writeFile(join(OUT, "report.txt"), report.join("\n") + "\n", "utf8");
console.log(report.join("\n"));
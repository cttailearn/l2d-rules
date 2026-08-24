// P4b 全链路 demo：原图 → 拆解 → 标注 → 绑定(自修复) → 动作/驱动 → 预览出图
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { ColorKeySegmenter, ColorMapLabeler, encodePng } from "@l2dp/cutout";
import { createWithSelfRepair, RuleReviewer } from "@l2dp/create";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator } from "@l2dp/driver";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
await mkdir(OUT, { recursive: true });
const report = [];
const log = (s) => { report.push(s); };

// ---------- 1. 原图（内存绘制"半身立绘"，透明底 + 平坦色；模拟已抠图上传统一局） ----------
const W = 480, H = 640;
const img = { width: W, height: H, data: new Uint8Array(W * H * 4) };
const SHAPES = [
  ["hair_back",  "left", 120,  60, 240, 320, [70,  60, 105]],
  ["neck",       "left", 224, 320,  32,  44, [245, 205, 180]],
  ["body_upper", "left", 170, 360, 140, 200, [120, 150, 205]],
  ["hair_side",  "left", 136, 140,  40, 180, [110,  95, 150]],
  ["hair_side",  "right",304, 140,  40, 180, [150, 125, 185]],
  ["face",       "left", 185, 150, 110, 165, [250, 215, 190]],
  ["nose",       "left", 236, 232,   8,  12, [235, 195, 170]],
  ["mouth",      "left", 222, 252,  36,  20, [200,  70,  80]],
  ["eyeball",    "left", 210, 198,  22,  18, [255, 255, 255]],
  ["eyeball",    "right",248, 198,  22,  18, [230, 230, 255]],
  ["eye",        "left", 204, 194,  34,  22, [246, 206, 186]],
  ["eye",        "right",244, 194,  34,  22, [236, 196, 206]],
  ["brow",       "left", 204, 180,  36,   9, [85,  75, 110]],
  ["brow",       "right",244, 180,  36,   9, [105, 90, 130]],
  ["hair_front", "left", 178, 136, 124,  84, [120, 105, 165]],
];
for (const [sem, side, x, y, w, h, c] of SHAPES) {
  for (let yy = y; yy < Math.min(y + h, H); yy++) {
    for (let xx = x; xx < Math.min(x + w, W); xx++) {
      const o = (yy * W + xx) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
}
const srcPng = encodePng(W, H, img.data);
await writeFile(join(OUT, "01-source.png"), srcPng);
log("[1] 原图 out/01-source.png (" + W + "x" + H + ")");

// ---------- 2+3+4. 拆解 → 标注 → 自修复绑定 → 动作/审核（createWithSelfRepair） ----------
const mapping = SHAPES.map(([sem, side, , , , , c]) => ({ color: c, semantic: sem, side }));
const labeler = new ColorMapLabeler(mapping);
const outcome = await createWithSelfRepair({
  character: "demo-p4b-chan",
  image: img,
  canvas: { width: W, height: H },
  segmenter: new ColorKeySegmenter({ tol: 8, minArea: 80 }),
  labeler,
  reviewer: new RuleReviewer(),
  maxRounds: 3,
});
log("[2] 候选 → 标注 → 自修复：rounds=" + outcome.rounds + " ok=" + outcome.ok);
log("    部件 " + outcome.directive.parts.length + " 件；切图覆盖率 " + outcome.cutout.coveragePct + "% / 重叠 " + outcome.cutout.overlapPct + "%");
for (const l of outcome.log) log("    · " + l);
if (!outcome.ok || !outcome.result) throw new Error("创作链路未通过：\n" + outcome.log.join("\n"));

const { model, rig, motions } = outcome.result;
await writeFile(join(OUT, "02-created.l2dm"), JSON.stringify(model), "utf8");
await writeFile(join(OUT, "03-rigspec.json"), JSON.stringify(rig.spec, null, 1), "utf8");
log("[3] 绑定产物 out/02-created.l2dm (参数 " + model.parameters.length + "，部件 " + model.parts.length + ") + out/03-rigspec.json");
log("    动作资产: " + motions.map((m) => m.name).join("/"));

// ---------- 5. 驱动（两条路径都演示） ----------
// A. 引擎直接播动作
const player = new L2dmPlayer(model, new Map());
const sw = new SoftwareRenderer();
const hashFrame = () => { player.render(sw); return createHash("sha256").update(sw.readPixels()).digest("hex").slice(0, 16); };
const saveFrame = (name) => { player.render(sw); const u8 = sw.readPixels(); return [name, Buffer.from(encodePng(W, H, u8))]; };

const frames = [];
player.params.reset(); player.render(sw); frames.push([ "20-rest.png", Buffer.from(encodePng(W, H, sw.readPixels())) ]);
const idle = motions.find((m) => m.name === "idle").motion;
player.play(idle); for (let i = 0; i < 70; i++) player.tick(16); player.render(sw);
frames.push(["21-idle.png", Buffer.from(encodePng(W, H, sw.readPixels()))]);
const blink = motions.find((m) => m.name === "blink").motion;
player.play(blink); for (let i = 0; i < 1; i++) player.tick(16); for (let i = 0; i < 9; i++) player.tick(16); player.render(sw);
frames.push(["22-blink.png", Buffer.from(encodePng(W, H, sw.readPixels()))]);
const talk = motions.find((m) => m.name === "talk").motion;
player.play(talk); for (let i = 0; i < 30; i++) player.tick(16); player.render(sw);
frames.push(["23-talk.png", Buffer.from(encodePng(W, H, sw.readPixels()))]);
for (const [name, buf] of frames) await writeFile(join(OUT, name), buf);

// B. JSONL 驱动栈（StreamIngestor → LayerStack + EnvironmentLayer → Evaluator → 写回 player）
const defs = model.parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def, group: p.group }));
const stack = new LayerStack(defs);
const env = new EnvironmentLayer(defs, { seed: 42 });
const ing = new StreamIngestor({
  manifest: { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) },
  library: { motions: motions.map((m) => ({ name: m.name })), expressions: [], behaviors: [] },
  assets: { motions: new Map(motions.map((m) => [m.name, m.motion])), expressions: new Map() },
  stack, env, seed: 7,
});
const player2 = new L2dmPlayer(model, new Map());
const ev = new Evaluator(stack, env, defs, {
  apply(_ch, params, _t) { for (const [k, v] of Object.entries(params)) player2.params.set(k, v); },
});
const feed = ing.feedLine('{"op":"play","asset":"idle"}', 0);
ing.feedLine('{"op":"blink"}', 500);
let driveFrame = null;
for (let i = 0; i < 80; i++) {
  ev.onFrame(16);
  if (i === 55) { player2.render(sw); driveFrame = Buffer.from(encodePng(W, H, sw.readPixels())); }
}
await writeFile(join(OUT, "24-jsonl-drive.png"), driveFrame);
log("[4] JSONL 驱动（feedLine play/blink + 环境层 80 帧）→ out/24-jsonl-drive.png；首行 applied=" + feed.applied.length + " skipped=" + feed.skipped.length);
log("    预览帧哈希: " + frames.map(([n]) => n.replace(".png", "")).join("=") + " 已写出");

// the hashFrame var unused — compute rest hash for report
player.params.reset(); player.render(sw);
log("    确定性参考：rest 帧 sha256=" + createHash("sha256").update(sw.readPixels()).digest("hex").slice(0, 24));

await writeFile(join(OUT, "report.txt"), report.join("\n") + "\n", "utf8");
console.log(report.join("\n"));

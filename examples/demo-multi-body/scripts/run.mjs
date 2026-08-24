// demo-multi-body（A1）：更多部位 + 非标准部位演示——rigCharacter 全身体层 20 语义 + 尾巴/兽耳/翅膀
// → JSONL 语义驱动（play 尾巴摆/翅膀扇/耳朵动 + 环境层）→ 软件光栅出图（确定性）
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { encodePng } from "@l2dp/cutout";
import { rigCharacter } from "@l2dp/rig";
import { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator } from "@l2dp/driver";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
await mkdir(OUT, { recursive: true });
const report = [];
const log = (s) => report.push(s);

// ---------- 1. 完整身体层 20 语义 + 非标准部位（33 件） ----------
const canvas = { width: 800, height: 1200 };
const parts = [
  { id: "hr-back", semantic: "hair_back", bbox: { x: 200, y: 40, width: 400, height: 260 } },
  { id: "hr-side-l", semantic: "hair_side", side: "left", bbox: { x: 140, y: 60, width: 120, height: 300 } },
  { id: "hr-side-r", semantic: "hair_side", side: "right", bbox: { x: 540, y: 60, width: 120, height: 300 } },
  { id: "hr-front", semantic: "hair_front", bbox: { x: 220, y: 50, width: 360, height: 240 } },
  { id: "neck", semantic: "neck", bbox: { x: 370, y: 350, width: 60, height: 90 } },
  { id: "ear-l", semantic: "ear", side: "left", bbox: { x: 240, y: 300, width: 40, height: 90 } },
  { id: "ear-r", semantic: "ear", side: "right", bbox: { x: 520, y: 300, width: 40, height: 90 } },
  { id: "hoho-l", semantic: "hoho", side: "left", bbox: { x: 260, y: 395, width: 70, height: 45 } },
  { id: "hoho-r", semantic: "hoho", side: "right", bbox: { x: 470, y: 395, width: 70, height: 45 } },
  { id: "face", semantic: "face", bbox: { x: 240, y: 380, width: 320, height: 210 } },
  { id: "nose", semantic: "nose", bbox: { x: 386, y: 455, width: 28, height: 40 } },
  { id: "eye-l", semantic: "eye", side: "left", bbox: { x: 290, y: 420, width: 70, height: 44 } },
  { id: "eye-r", semantic: "eye", side: "right", bbox: { x: 440, y: 420, width: 70, height: 44 } },
  { id: "eyeball-l", semantic: "eyeball", side: "left", bbox: { x: 306, y: 428, width: 24, height: 24 } },
  { id: "eyeball-r", semantic: "eyeball", side: "right", bbox: { x: 470, y: 428, width: 24, height: 24 } },
  { id: "brow-l", semantic: "brow", side: "left", bbox: { x: 288, y: 400, width: 78, height: 20 } },
  { id: "brow-r", semantic: "brow", side: "right", bbox: { x: 434, y: 400, width: 78, height: 20 } },
  { id: "mouth", semantic: "mouth", bbox: { x: 365, y: 505, width: 70, height: 40 } },
  { id: "body-upper", semantic: "body_upper", bbox: { x: 150, y: 470, width: 500, height: 420 } },
  { id: "body-lower", semantic: "body_lower", bbox: { x: 170, y: 850, width: 460, height: 300 } },
  { id: "breast", semantic: "adult_breast", bbox: { x: 260, y: 520, width: 280, height: 120 } },
  { id: "arm-l", semantic: "arm_a", side: "left", bbox: { x: 90, y: 500, width: 60, height: 360 } },
  { id: "arm-r", semantic: "arm_b", side: "right", bbox: { x: 650, y: 500, width: 60, height: 360 } },
  { id: "leg-l", semantic: "leg", side: "left", bbox: { x: 240, y: 900, width: 90, height: 280 } },
  { id: "leg-r", semantic: "leg", side: "right", bbox: { x: 470, y: 900, width: 90, height: 280 } },
  { id: "feet-l", semantic: "feet", side: "left", bbox: { x: 250, y: 1160, width: 80, height: 30 } },
  { id: "feet-r", semantic: "feet", side: "right", bbox: { x: 470, y: 1160, width: 80, height: 30 } },
  { id: "adult-g", semantic: "adult_genital", bbox: { x: 380, y: 880, width: 40, height: 26 } },
  { id: "tail", semantic: "tail", bbox: { x: 490, y: 780, width: 80, height: 400 } },
  { id: "beast-ear-l", semantic: "ear_beast", side: "left", bbox: { x: 250, y: 250, width: 55, height: 130 } },
  { id: "beast-ear-r", semantic: "ear_beast", side: "right", bbox: { x: 495, y: 250, width: 55, height: 130 } },
  { id: "wing-l", semantic: "wing", side: "left", bbox: { x: 30, y: 240, width: 90, height: 320 } },
  { id: "wing-r", semantic: "wing", side: "right", bbox: { x: 680, y: 240, width: 90, height: 320 } },
];

const { model, spec, report: rigReport } = rigCharacter({ id: "multi-body-chan", canvas, parts });
if (!rigReport.ok) throw new Error("rig 校验未通过: " + JSON.stringify(rigReport.checks));
await writeFile(join(OUT, "01-multi-body.l2dm"), JSON.stringify(model), "utf8");
log("[1] rig:" + model.parts.length + " 部件 / " + model.parameters.length + " 参数，合法=" + rigReport.ok);

// ---------- 2. 引擎直驱帧（rest / 尾巴摆 / 翅膀扇 / 耳朵动 / 脸红） ----------
const player = new L2dmPlayer(model, new Map());
const sw = new SoftwareRenderer();
const save = async (name, render) => { render(sw); const u8 = sw.readPixels(); await writeFile(join(OUT, name), Buffer.from(encodePng(canvas.width, canvas.height, u8))); return createHash("sha256").update(u8).digest("hex").slice(0, 16); };
player.params.reset();
const hRest = await save("10-rest.png", (r) => player.render(r));
player.params.reset(); player.params.set("尾巴摆", 1);
const hTail = await save("11-tail.png", (r) => player.render(r));
player.params.reset(); player.params.set("翅膀扇", 1);
const hWing = await save("12-wing.png", (r) => player.render(r));
player.params.reset(); player.params.set("耳朵动", 1);
const hEar = await save("13-ear.png", (r) => player.render(r));
player.params.reset(); player.params.set("脸红", 1);
const hBlush = await save("14-blush.png", (r) => player.render(r));
log("[2] 非标准部位驱动帧：rest=" + hRest + " tail=" + hTail + " wing=" + hWing + " ear=" + hEar + " blush=" + hBlush);

// ---------- 3. JSONL 语义驱动（play/尾巴摆 + 环境层） ----------
const defs = model.parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def, group: p.group }));
const motions = { tail_wag: { durationMs: 1000, loop: true, curves: [{ id: "尾巴摆", segments: [0, 0, 0, 1, 1] }] } };
const stack = new LayerStack(defs);
const env = new EnvironmentLayer(defs, { seed: 42 });
const ing = new StreamIngestor({
  manifest: { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) },
  library: { motions: [{ name: "tail_wag" }], expressions: [], behaviors: [] },
  assets: { motions: new Map([["tail_wag", motions.tail_wag]]), expressions: new Map() },
  stack, env, seed: 7,
});
const player2 = new L2dmPlayer(model, new Map());
const ev = new Evaluator(stack, env, defs, { apply(_c, params) { for (const [k, v] of Object.entries(params)) player2.params.set(k, v); } });
const r1 = ing.feedLine("{\"op\":\"play\",\"asset\":\"tail_wag\"}", 0);
ing.feedLine("{\"op\":\"blink\"}", 500);
let jsonlFrame = null;
for (let i = 0; i < 60; i++) { ev.onFrame(16); if (i === 59) { player2.render(sw); jsonlFrame = Buffer.from(encodePng(canvas.width, canvas.height, sw.readPixels())); } }
await writeFile(join(OUT, "20-jsonl-drive.png"), jsonlFrame);
log("[3] JSONL 驱动（tail_wag + blink + 环境层 60 帧）applied=" + r1.applied.length + " skipped=" + r1.skipped.length);

// ---------- 4. 确定性参考 ----------
player.params.reset(); player.render(sw);
log("确定性参考：rest 帧 sha256=" + createHash("sha256").update(sw.readPixels()).digest("hex").slice(0, 24));
log("非标准部位参数面: " + ["尾巴摆", "耳朵动", "翅膀扇", "脸红"].filter((id) => model.parameters.some((p) => p.id === id)).join(","));
log("RigSpec 参数数: " + spec.parameters.length + " / 物理摆锤: " + (spec.physics?.length ?? 0));

await writeFile(join(OUT, "report.txt"), report.join("\n") + "\n", "utf8");
console.log(report.join("\n"));

// demo-clothing（B-3）：服装层双服装组换装演示
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { encodePng } from "@l2dp/cutout";
import { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator, outfitLines } from "@l2dp/driver";
import { rigCharacter } from "@l2dp/rig";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
await mkdir(OUT, { recursive: true });
const report = [];
const log = (s) => report.push(s);

// 画布 + 身体基础（脸/上躯/下躯/颈）+ 双服装组（连衣裙组1 / 制服组2）
const canvas = { width: 640, height: 960 };
const base = [
  { id: "face", semantic: "face", bbox: { x: 180, y: 240, width: 280, height: 200 } },
  { id: "neck", semantic: "neck", bbox: { x: 292, y: 440, width: 56, height: 70 } },
  { id: "body-upper", semantic: "body_upper", bbox: { x: 120, y: 480, width: 400, height: 320 } },
  { id: "body-lower", semantic: "body_lower", bbox: { x: 140, y: 780, width: 360, height: 160 } },
];
const clothing = [
  // 组1：连衣裙 + 鞋
  { id: "dress-1", semantic: "outfit_dress", costumeGroup: 1, bbox: { x: 120, y: 490, width: 400, height: 420 } },
  { id: "shoes-1", semantic: "outfit_shoes", costumeGroup: 1, bbox: { x: 200, y: 915, width: 240, height: 30 } },
  // 组2：上衣 + 下身 + 发型配件（校服风）
  { id: "top-2", semantic: "outfit_top", costumeGroup: 2, bbox: { x: 120, y: 480, width: 400, height: 220 } },
  { id: "bottom-2", semantic: "outfit_bottom", costumeGroup: 2, bbox: { x: 140, y: 700, width: 360, height: 240 } },
  { id: "shoes-2", semantic: "outfit_shoes", costumeGroup: 2, bbox: { x: 200, y: 915, width: 240, height: 30 } },
  { id: "hat-2", semantic: "hairstyle", costumeGroup: 2, bbox: { x: 220, y: 170, width: 200, height: 90 } },
];

const { model, spec, report: rigReport } = rigCharacter({ id: "cloth-chan", canvas, parts: [...base, ...clothing] });
if (!rigReport.ok) throw new Error("rig 校验未通过: " + JSON.stringify(rigReport.checks));
await writeFile(join(OUT, "01-costume.l2dm"), JSON.stringify(model), "utf8");
log("[1] rig:" + model.parts.length + " 部件（身体 " + base.length + " + 服装 " + clothing.length + "）/ " + model.parameters.length + " 参数");
log("    服装组: " + spec.costumes.map((c) => c.group + "(" + c.param + ":" + c.partIds.join("/") + ")").join("  "));

// 引擎直驱：默认组1可见；切到组2
const sw = new SoftwareRenderer();
const save = async (name, params) => {
  const player = new L2dmPlayer(model, new Map());
  player.params.reset();
  for (const [k, v] of Object.entries(params)) player.params.set(k, v);
  player.render(sw);
  const u8 = sw.readPixels();
  await writeFile(join(OUT, name), Buffer.from(encodePng(canvas.width, canvas.height, u8)));
  return createHash("sha256").update(u8).digest("hex").slice(0, 16);
};
const h1 = await save("10-group1.png", { 衣装组1: 1, 衣装组2: 0 });
const h2 = await save("11-group2.png", { 衣装组1: 0, 衣装组2: 1 });
log("[2] 组1帧 sha=" + h1 + " / 组2帧 sha=" + h2 + "（" + (h1 !== h2 ? "像素不同=换装生效" : "警告：像素相同") + "）");

// driver 侧：outfit op → outfitLines → ingestor 生效
const defs = model.parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def, group: p.group }));
const stack = new LayerStack(defs);
const env = new EnvironmentLayer(defs, { seed: 7 });
const ing = new StreamIngestor({
  manifest: { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) },
  library: { motions: [], expressions: [], behaviors: [] },
  assets: { motions: new Map(), expressions: new Map() },
  stack, env, seed: 7,
});
const player = new L2dmPlayer(model, new Map());
const ev = new Evaluator(stack, env, defs, { apply(_c, params) { for (const [k, v] of Object.entries(params)) player.params.set(k, v); } });
// 模拟 outfit 宿主处理：换到组 2
const costumeList = spec.costumes.map((c) => ({ group: c.group, param: c.param, partIds: c.partIds }));
const lines = outfitLines(costumeList, 2);
for (const l of lines) ing.feedLine(l, 0);
ev.onFrame(16);
player.render(sw);
const u8 = sw.readPixels();
await writeFile(join(OUT, "20-outfit-jsonl.png"), Buffer.from(encodePng(canvas.width, canvas.height, u8)));
log("[3] outfit op → JSONL 换装帧 sha=" + createHash("sha256").update(u8).digest("hex").slice(0, 16) + "（行数 " + lines.length + "）");
log("    @l2dp/driver 契约: 换装走 HostOpHandler.outfit → 默认实现 = outfitLines → override 层 set 生效");

await writeFile(join(OUT, "report.txt"), report.join("\n") + "\n", "utf8");
console.log(report.join("\n"));
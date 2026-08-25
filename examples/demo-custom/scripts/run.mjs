// demo-custom（B-7）：自定义语义 —— 运行时注入 + 创作路径全链可渲染
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { rigCharacter } from "@l2dp/rig";
import { executeCreation } from "@l2dp/create";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
await mkdir(OUT, { recursive: true });
const report = [];
const log = (s) => report.push(s);

// ---------- ① rig 层：customTemplates 运行时注入全新语义（披风 + 翅膀 + 光环） ----------
const customTemplates = {
  cape:  { zh: "披风", order: 21, headCluster: false, color: [0.65, 0.38, 0.78, 1], grid: [3, 6], drive: { id: "披风飘" } },
  wing:  { zh: "翅膀自定", order: 22, headCluster: false, color: [0.85, 0.8, 0.95, 1], grid: [3, 4], drive: { id: "翅膀扇" } },
  halo:  { zh: "光环", order: 23, headCluster: true, color: [0.98, 0.85, 0.4, 1], grid: [4, 2] },
};
const canvas = { width: 500, height: 900 };
const parts = [
  { id: "face", semantic: "face", bbox: { x: 150, y: 200, width: 200, height: 160 } },
  { id: "body", semantic: "body_upper", bbox: { x: 90, y: 340, width: 320, height: 300 } },
  { id: "cape", semantic: "cape", bbox: { x: 30, y: 360, width: 60, height: 330 }, customParams: { 披风飘: { min: -1, max: 1, def: 0, group: "Custom" } } },
  { id: "wingL", semantic: "wing", side: "left", bbox: { x: 350, y: 300, width: 90, height: 180 }, customParams: { 翅膀扇: { min: -1, max: 1, def: 0, group: "Custom" } } },
  { id: "halo", semantic: "halo", bbox: { x: 210, y: 150, width: 80, height: 36 } },
];
const rig = rigCharacter({ id: "custom-girl", canvas, parts, customTemplates });
if (!rig.report.ok) throw new Error("rig 校验未通过: " + JSON.stringify(rig.report.checks.slice(0, 3)));
await writeFile(join(OUT, "10-custom-rig.l2dm"), JSON.stringify(rig.model), "utf8");
log("[① rig 自定义注入] 部件 " + rig.model.parts.length + "（含 cape/wing/halo 三个运行时注入语义）");
log("   参数 " + rig.model.parameters.length + "（含 披风飘/翅膀扇 drive 参数）");
log("   模板注册: " + Object.keys(customTemplates).join("/"));

// 驱动可见：置 披风飘=1 改变像素
const sw = new SoftwareRenderer();
const renderHash = (set) => {
  const player = new L2dmPlayer(rig.model, new Map());
  player.params.reset();
  for (const [k, v] of Object.entries(set)) player.params.set(k, v);
  player.render(sw);
  return createHash("sha256").update(sw.readPixels()).digest("hex").slice(0, 12);
};
const rest = renderHash({});
const drv = renderHash({ 披风飘: 1 });
log("[② 驱动] 静止 " + rest + " vs 披风飘=1 " + drv + "（" + (rest !== drv ? "可见变化" : "警告：无变化") + "）");

// ---------- ③ 创作路径：CreationDirective.customTemplates + 服装语义 → executeCreation 全链 ----------
const exec = executeCreation({
  v: 1, character: "created-custom", canvas,
  parts: [
    { id: "body", semantic: "body_upper", side: "left", bbox: { x: 90, y: 340, width: 320, height: 300 }, color: [0.5, 0.6, 0.9, 1] },
    { id: "cape", semantic: "cape", side: "left", bbox: { x: 30, y: 360, width: 60, height: 330 }, color: [0.65, 0.38, 0.78, 1] },
    { id: "dress", semantic: "outfit_dress", side: "left", bbox: { x: 90, y: 350, width: 320, height: 280 }, color: [0.9, 0.4, 0.6, 1] },
  ],
  customTemplates,
  motions: [],
});
await writeFile(join(OUT, "20-creation-custom.l2dm"), JSON.stringify(exec.model), "utf8");
log("[③ 创作路径] 自定义语义(cape) + 服装(outfit_dress) 经 executeCreation：部件 " + exec.model.parts.length + " / 动作 " + exec.motions.length);
log("   服饰部件随 衣装组1 参数显隐：dress." + (exec.model.parts.find((p) => p.id === "dress")?.opacityParam ?? "?") + " · cape." + (exec.model.parts.find((p) => p.id === "cape")?.opacityParam ?? "无"));

await writeFile(join(OUT, "report.txt"), report.join("\n") + "\n", "utf8");
console.log(report.join("\n"));
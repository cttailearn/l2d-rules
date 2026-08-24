// demo-dual-mode（A3）：双模式对照——坏行隔离 vs 整批原子拒绝（共享规则库）
import { mkdir, writeFile } from "node:fs/promises";
await mkdir(join(import.meta.dirname, "..", "out"), { recursive: true });
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator, batchValidate } from "@l2dp/driver";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
const report = [];
const log = (s) => report.push(s);

// 参数面（微笑/头转向 = 可驱动语义）
const defs = [
  { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
  { id: "呼吸", min: 0, max: 1, def: 0.5, group: "Ambient" },
];
const manifest = { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) };
const library = { motions: [{ name: "微笑点头" }], expressions: [], behaviors: [] };
const assets = {
  motions: new Map([["微笑点头", { durationMs: 1000, loop: true, curves: [{ id: "微笑", segments: [0, 0, 0, 1, 1] }] }]]),
  expressions: new Map(),
};

// 同一条含坏行的指令流（第 2 行为坏行：value 越界 RANGE）
const LINES = [
  '{"op":"play","asset":"微笑点头"}',
  '{"op":"set","sem":"头转向","value":999}',   // 坏行：RANGE（越界）
  '{"op":"set","sem":"微笑","value":0.7}',
];
const STREAM = { v: 2, directives: LINES.map((l) => JSON.parse(l)) };

// ---- 模式 A：在线流式 feedLine（行级原子、坏行隔离） ----
const stackA = new LayerStack(defs);
const envA = new EnvironmentLayer(defs, { seed: 7 });
const ingA = new StreamIngestor({ manifest, library, assets, stack: stackA, env: envA, seed: 7 });
let appliedA = 0;
const skippedA = [];
LINES.forEach((line, i) => {
  const r = ingA.feedLine(line, i * 16);
  appliedA += r.applied.length;
  for (const s of r.skipped) skippedA.push("line" + i + "(" + s.reason + ")");
});
log("[A 在线流式] applied=" + appliedA + " / skipped=" + JSON.stringify(skippedA));

// 好行(0,2)仍生效：帧末 微笑=0.7（set 覆盖）、头转向=0（坏行被隔离）
let lastP = {};
new Evaluator(stackA, envA, defs, { apply(_c, p) { lastP = { ...p }; } });

// ---- 模式 B：离线整批 feedBatch（整批原子拒绝） ----
const stackB = new LayerStack(defs);
const envB = new EnvironmentLayer(defs, { seed: 7 });
const ingB = new StreamIngestor({ manifest, library, assets, stack: stackB, env: envB, seed: 7 });
const rB = ingB.feedBatch(STREAM, 0);
log("[B 离线整批] applied=" + rB.applied.length + "（整批原子拒绝） / skipped=" + JSON.stringify(rB.skipped));

// ---- 对照：批内合法子集可独立通过（隔离验证） ----
const goodOnly = { v: 2, directives: [STREAM.directives[0], STREAM.directives[2]] };
const vG = batchValidate(goodOnly, { manifest, library, assets, params: defs, seed: 7 });
log("[C 批内合法子集] ok=" + vG.ok + "（坏行剔除后整批可通过）");

log("结论: 在线=隔离坏行继续；离线=整批原子拒绝；规则库同一套，执行策略不同");
await writeFile(join(OUT, "report.txt"), report.join("\n") + "\n", "utf8");
console.log(report.join("\n"));
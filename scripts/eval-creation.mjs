// eval-creation.mjs —— 创作评估集门禁（P4b DoD）
// 读 specs/evals/creation-cases.json；对每个 case：
//   平坦色场景(spec) → ColorKeySegmenter → 标注器(color/position) → createWithSelfRepair(自修复+规则审核)
//   断言 vs expect；任一失败退出码 1；报告写 specs/evals/report-creation.json
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ColorKeySegmenter, ColorMapLabeler, PositionLabeler } from "@l2dp/cutout";
import { createWithSelfRepair, RuleReviewer } from "@l2dp/create";
import { LlmLabeler } from "@l2dp/host";
import { OpenAIProvider } from "@l2dp/driver";

// --llm：LLM_API_KEY 已设时用真实 LLM 做语义标注（分割/审核保持确定性以便比对）；未设 key 自动跳过
const wantLlm = process.argv.includes("--llm");
const llmKey = process.env.LLM_API_KEY;
const llmMode = wantLlm && llmKey ? true : false;
if (wantLlm && !llmKey) console.log("eval-creation: 跳过 --llm（未设 LLM_API_KEY）");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cases = JSON.parse(await readFile(join(root, "specs", "evals", "creation-cases.json"), "utf8")).cases;

function solid(w, h) {
  const data = new Uint8Array(w * h * 4);
  return { width: w, height: h, data };
}
function rectIn(img, x, y, w, h, c) {
  const x1 = Math.min(img.width, x + w);
  const y1 = Math.min(img.height, y + h);
  for (let yy = Math.max(0, y); yy < y1; yy++) {
    for (let xx = Math.max(0, x); xx < x1; xx++) {
      const o = (yy * img.width + xx) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
}
function buildScene(cse) {
  const img = solid(cse.canvas.width, cse.canvas.height);
  for (const s of cse.shapes) rectIn(img, s.x, s.y, s.w, s.h, s.color);
  return img;
}

const results = [];
let fail = 0;
for (const cse of cases) {
  const img = buildScene(cse);
  const segmenter = new ColorKeySegmenter({ tol: 8, minArea: 60 });
  let labeler;
  if (llmMode && cse.labelBy === "color") {
    const provider = new OpenAIProvider({ baseUrl: process.env.LLM_BASE_URL, apiKey: llmKey, model: process.env.LLM_MODEL ?? "gpt-4o" });
    labeler = new LlmLabeler({ provider });
  } else if (cse.labelBy === "color") {
    labeler = new ColorMapLabeler(cse.shapes.map((s) => ({ color: s.color, semantic: s.semantic, side: s.side })));
  } else {
    labeler = new PositionLabeler(cse.shapes.map((s) => ({ semantic: s.semantic, side: s.side, region: { x: s.x, y: s.y, width: s.w, height: s.h } })));
  }
  const outcome = await createWithSelfRepair({
    character: "eval-" + cse.id,
    image: img,
    canvas: cse.canvas,
    segmenter,
    labeler,
    reviewer: new RuleReviewer(),
    maxRounds: 3,
  });
  const exp = cse.expect;
  const checks = [
    { name: "ok", ok: outcome.ok === exp.ok, detail: "outcome.ok=" + outcome.ok },
    { name: "partCount", ok: outcome.ok && outcome.directive.parts.length >= exp.partCountMin, detail: "parts=" + outcome.directive.parts.length + " (min " + exp.partCountMin + ")" },
    { name: "coverage", ok: outcome.ok && outcome.cutout.coveragePct >= exp.coveragePctMin, detail: "coverage=" + outcome.cutout.coveragePct + "% (min " + exp.coveragePctMin + ")" },
    { name: "motions", ok: outcome.ok && outcome.result !== undefined && outcome.result.motions.length >= exp.motions, detail: "motions=" + (outcome.result?.motions.length ?? 0) },
    { name: "rigValid", ok: outcome.ok && outcome.result !== undefined && outcome.result.rig.report.ok, detail: "rig=" + (outcome.result?.rig.report.ok ?? false) },
  ];
  const passed = checks.every((c) => c.ok);
  if (!passed) fail++;
  results.push({
    id: cse.id,
    name: cse.name,
    rounds: outcome.rounds,
    labelBy: cse.labelBy,
    partCount: outcome.directive.parts.length,
    coveragePct: outcome.cutout.coveragePct,
    motions: outcome.result?.motions.length ?? 0,
    passed,
    checks,
    log: outcome.log,
  });
  console.log((passed ? "✔" : "✖") + " " + cse.id + " " + cse.name + (passed ? "" : " → " + checks.filter((c) => !c.ok).map((c) => c.name + "(" + c.detail + ")").join(";")));
}
await writeFile(join(root, "specs", "evals", "report-creation.json"), JSON.stringify({ total: results.length, passed: results.length - fail, results }, null, 1), "utf8");
console.log("eval-creation: " + (results.length - fail) + "/" + results.length + " 通过");
if (fail > 0) process.exit(1);

// eval-drive.mjs —— 评估集门禁：golden cases → 确定性求值 → 逐断言评分 → 报告（§10）
// 用法：node scripts/eval-drive.mjs   （CI 门禁：任一 case 失败 → 退出码 1）
// 产物：specs/evals/report.json（通过率 + 失败明细）

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAllCases } from "./eval-harness.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const modelJson = readFileSync(join(root, "packages/engine/test/fixtures/demo.l2dm"), "utf8");
const cases = JSON.parse(readFileSync(join(root, "specs/evals/drive-cases.json"), "utf8")).cases;

const report = await runAllCases(modelJson, cases);

const reportPath = join(root, "specs/evals/report.json");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

console.log(`eval-drive: ${report.passed}/${report.total} 通过（${report.passed / report.total * 100}%）`);
for (const r of report.results) {
  if (r.pass) console.log(`  ✔ ${r.id}（hop ${r.hop}${r.behaviorId !== undefined ? ` ${r.behaviorId}` : ""}）`);
  else {
    console.log(`  ✖ ${r.id}: ${r.failures.join("; ")}`);
  }
}
process.exit(report.failed === 0 ? 0 : 1);

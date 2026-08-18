// 全仓库类型检查（5 包）
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules/typescript/bin/tsc");
const pkgs = ["l2dp", "dsl", "renderer", "engine", "driver"].map(p => join(root, "packages", p, "tsconfig.json"));
for (const cfg of pkgs) {
  console.log("检查", cfg);
  execFileSync(process.execPath, [tsc, "--noEmit", "-p", cfg], { stdio: "inherit" });
}
console.log("✅ l2d-rules 类型检查通过");

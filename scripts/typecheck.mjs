// 全仓库类型检查（4 包 + demo-web；renderer 已于 M6 退役，dsl 已移除）
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules/typescript/bin/tsc");
const cfgs = [
  ...["l2dp", "engine", "driver", "convert"].map(p => join(root, "packages", p, "tsconfig.json")),
  join(root, "examples", "demo-web", "tsconfig.json"),
];
for (const cfg of cfgs) {
  console.log("检查", cfg);
  execFileSync(process.execPath, [tsc, "--noEmit", "-p", cfg], { stdio: "inherit" });
}
console.log("✅ l2d-rules 类型检查通过");

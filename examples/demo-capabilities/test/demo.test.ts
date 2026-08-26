import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("P6 demo: capability runner emits scene and report", async () => {
  const child = await import("node:child_process");
  // stdio:"ignore"：子进程 stdout 不捕获（规避 Windows 沙箱对管道捕获的限制），
  // 结果经落盘 report.json 断言——状态码 + 产物均验证。
  const result = child.spawnSync(process.execPath, [join(root, "scripts", "run.mjs")], { encoding: "utf8", stdio: "ignore" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(join(root, "out", "report.json"), "utf8"));
  assert.deepEqual(report.manifestSems, ["微笑"]);
  assert.deepEqual(report.firstHop, { id: "greet", kinds: ["greeting"] });
  assert.ok(report.mcpTools.includes("emit_directives"));
  assert.deepEqual(report.phonemes.map((x) => x.viseme), ["I", "O", "silence"]);
  assert.ok(report.scene.nonTransparent > 0);
  assert.ok(report.speech.visemeCount >= 2);
});

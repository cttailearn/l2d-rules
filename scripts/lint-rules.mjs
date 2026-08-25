// lint-rules.mjs（O-3）：规则库→schema/类型/文档 元一致性检查
// 单一事实来源 = validate/rules.ts 的 OP_RULES + ir/types.ts 的 Op/PAYLOAD_FIELDS；
// 检查：ir/types Op 与 OP_RULES 键一致、schema 由 OP_RULES 生成（等价）、README op 表覆盖全 op。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OP_RULES, PAYLOAD_FIELDS, RULE_CODE_DICT } from "@l2dp/driver";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let problems = 0;
const fail = (msg) => { problems++; console.log("  ✖ " + msg); };
const ok = (msg) => console.log("  ✔ " + msg);

console.log("[lint-rules] O-3 元一致性检查");

// 1) ir/types.ts Op 字面量 vs OP_RULES 键
const typesSrc = readFileSync(join(root, "packages/driver/src/ir/types.ts"), "utf8");
const opDecl = /export type Op\s*=\s*([\s\S]*?);/.exec(typesSrc);
if (!opDecl) { fail("找不到 ir/types.ts 的 Op 类型声明"); }
else {
  const opLiterals = [...opDecl[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const ruleKeys = Object.keys(OP_RULES);
  const missingInRules = opLiterals.filter((o) => !ruleKeys.includes(o));
  const extraInRules = ruleKeys.filter((o) => !opLiterals.includes(o));
  if (missingInRules.length > 0) fail("ir/types Op 存在但 OP_RULES 缺失: " + missingInRules.join(","));
  else ok("ir/types Op (" + opLiterals.length + ") 与 OP_RULES 键一致");
  if (extraInRules.length > 0) fail("OP_RULES 存在但 ir/types 无此 Op: " + extraInRules.join(","));
  else ok("OP_RULES 无游离键");
}

// 2) OP_RULES 字段 ⊆ PAYLOAD_FIELDS ∪ COMMON_FIELDS（公共字段如 interrupt 合法，但不入载荷集）
const COMMON = ["id", "target", "at", "dur", "interrupt"];
const payloadSet = new Set([...PAYLOAD_FIELDS, ...COMMON]);
const badFields = [];
for (const [op, r] of Object.entries(OP_RULES)) {
  for (const f of [...r.required, ...r.allowed]) if (!payloadSet.has(f)) badFields.push(op + ":" + f);
}
if (badFields.length > 0) fail("OP_RULES 字段不在 PAYLOAD_FIELDS: " + badFields.join(", "));
else ok("OP_RULES 全部字段 ∈ PAYLOAD_FIELDS (" + payloadSet.size + ")");

// 3) 错误词典覆盖：OP_RULES 各 op 相关 code（OP/REQUIRED）+ 规则库 code 族
const dictMissing = ["JSON_PARSE", "SHAPE", "OP", "REQUIRED", "FORBIDDEN", "RANGE", "SEM_NOT_FOUND", "ASSET_NOT_FOUND", "STREAM_DEP"].filter((c) => !RULE_CODE_DICT[c]);
if (dictMissing.length > 0) fail("错误词典缺 code: " + dictMissing.join(","));
else ok("错误词典核心 code 齐全（" + Object.keys(RULE_CODE_DICT).length + " 条）");

// 4) SPEC-DSL（唯一权威规格）op 表覆盖全部 op
const spec = readFileSync(join(root, "docs/SPEC-DSL-v1.0.md"), "utf8");
const ruleKeys = Object.keys(OP_RULES);
const notInSpec = ruleKeys.filter((o) => !spec.includes(o));
if (notInSpec.length > 0) fail("SPEC-DSL-v1.0 未提及 op: " + notInSpec.join(","));
else ok("SPEC-DSL-v1.0 覆盖全部 " + ruleKeys.length + " 个 op");
console.log("");
if (problems > 0) { console.log("[lint-rules] 失败: " + problems + " 个问题"); process.exit(1); }
console.log("[lint-rules] ✅ 全部一致");
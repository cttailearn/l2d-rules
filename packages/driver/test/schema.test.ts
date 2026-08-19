// ir/schema —— 同源等价断言（DEVELOPMENT-SPEC C12）
// 目标：规则库 OP_RULES（validate/rules.ts）与 JSON Schema（ir/schema.ts）必须保持一致。
// 改一处未同步另一处 → 本测试红。覆盖：
//   1) 每个 op 的 required 完全一致（["op", ...OP_RULES.required]）
//   2) 每个 op 的 properties 键恰 = ["op", ...公共字段, ...OP_RULES.allowed]
//      → 表外载荷字段（FORBIDDEN）在 schema 层被 additionalProperties:false 禁止，
//        与 rules.ts 遍历 PAYLOAD_FIELDS 判定 allowed 的语义逐字段等价。
//   3) op 覆盖完备：schema 的 anyOf 正好覆盖 OP_RULES 全部 op，无多无漏。
//   4) 顶层流 Schema 的 v 常量 = IR_VERSION。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OP_RULES,
  type ValidationIssue,
  opShapeIssues,
} from "../src/validate/rules.ts";
import {
  perOpSchema,
  directiveSchema,
  directiveStreamSchema,
  emitDirectiveSchema,
  COMMON_FIELDS,
  type JsonSchema,
} from "../src/ir/schema.ts";
import { PAYLOAD_FIELDS, IR_VERSION, type Op } from "../src/ir/types.ts";

const OP_KEYS = Object.keys(OP_RULES) as Op[];

function keySet(o: Record<string, unknown>): string[] {
  return Object.keys(o).sort();
}

test("C12: 每个 op 的 required 与规则库完全一致", () => {
  for (const op of OP_KEYS) {
    const s = perOpSchema(op);
    const expected = ["op", ...(OP_RULES[op].required as readonly string[])].sort();
    assert.deepEqual(s.required?.sort(), expected, `op '${op}' required 与 OP_RULES 不一致`);
  }
});

test("C12: 每个 op 的 properties 键恰 = op + 公共字段 + 该 op 允许字段（表外字段被禁止）", () => {
  for (const op of OP_KEYS) {
    const s = perOpSchema(op);
    const props = s.properties ?? {};
    const expected = keySet(
      Object.fromEntries(
        [...new Set(["op", ...COMMON_FIELDS, ...(OP_RULES[op].allowed as readonly string[])])]
          .map((f) => [f, true] as [string, boolean]),
      ),
    );
    assert.deepEqual(keySet(props), expected, `op '${op}' properties 与 OP_RULES.allowed 不一致`);
    // additionalProperties 必须是 false（表外字段硬禁止）
    assert.equal(s.additionalProperties, false, `op '${op}' 需 additionalProperties:false`);
  }
});

test("C12: 表外载荷字段在 schema 中被禁止（与 PAYLOAD_FIELDS/OP_RULES 逐字段等价）", () => {
  for (const op of OP_KEYS) {
    const props = perOpSchema(op).properties ?? {};
    for (const f of PAYLOAD_FIELDS) {
      const inAllowed = (OP_RULES[op].allowed as readonly string[]).includes(f);
      const inProps = f in props;
      assert.equal(inProps, inAllowed, `op '${op}' 载荷字段 '${f}' 的 schema 是否允许与规则库不一致`);
    }
  }
});

test("C12: directiveSchema 的 anyOf 恰好覆盖全部 op，无多无漏，且 op.const 正确", () => {
  const s = directiveSchema();
  assert.ok(Array.isArray(s.anyOf), "directiveSchema 需 anyOf");
  const variants = s.anyOf!;
  assert.equal(new Set(variants.map((v) => (v.properties?.op as { const?: Op } | undefined)?.const)).size,
    variants.length, "变体 op.const 不得重复");
  assert.deepEqual(
    new Set(variants.map((v) => (v.properties?.op as { const?: Op } | undefined)?.const)),
    new Set(OP_KEYS),
    "schema op 集合必须与 OP_RULES 完全一致",
  );
});

test("C12: 流 Schema 的 v 常量 = IR_VERSION，required=[v,directives]", () => {
  const s = directiveStreamSchema();
  assert.deepEqual(s.properties?.v, { const: IR_VERSION });
  assert.deepEqual(s.required?.slice().sort(), ["directives", "v"]);
  assert.equal(s.additionalProperties, false);
});

test("C12: emitDirectiveSchema 包装返回 directives 数组（MCP/宿主用）", () => {
  const s = emitDirectiveSchema();
  assert.deepEqual(s.required, ["directives"]);
  assert.deepEqual((s.properties?.directives as JsonSchema)?.maxItems, 8);
});

// ---- 反向契约：schema 允许的字段，校验器 opShapeIssues 也不拒绝（实际往返） ----
test("C12: 往返——perOpSchema 声明的 allowed 字段在 opShapeIssues 中不被判 FORBIDDEN", () => {
  for (const op of OP_KEYS) {
    const props = perOpSchema(op).properties ?? {};
    const keys = new Set(Object.keys(props));
    for (const field of [...COMMON_FIELDS, ...(OP_RULES[op].allowed as readonly string[])]) {
      // common 字段不在载荷判定，跳过
      if ((COMMON_FIELDS as readonly string[]).includes(field as never)) continue;
      const raw: Record<string, unknown> = { op };
      (raw as Record<string, unknown>)[field] = "x";
      const res = opShapeIssues(raw, 0, true);
      if (!res.ok) {
        const forbidden = res.issues.filter((i: ValidationIssue) => i.rule === "FORBIDDEN");
        assert.equal(forbidden.length, 0,
          `op '${op}' 字段 '${field}' 在 schema 中允许但校验器判 FORBIDDEN（两者不同源）`);
      }
      void keys;
    }
  }
});

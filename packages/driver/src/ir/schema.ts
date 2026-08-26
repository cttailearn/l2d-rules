// 扁平指令 IR v2 —— 由 types + 规则库同源生成的 JSON Schema —— DEVELOPMENT-SPEC §6.1 / C12
// 供 LLM 结构化输出（OpenAI native `response_format: json_schema`）与 MCP 工具描述同源使用。
// 单一事实来源：validate/rules.ts 的 OP_RULES（required/allowed）。本文件只负责把那张表
// 渲染成 JSON Schema；"改一处须同步另一处"由 schema.test.ts 的等价断言保证。
// 仅可擦除语法（无 enum/namespace），零平台依赖，纯函数无副作用。

import { OP_RULES } from "../validate/rules.ts";
import { IR_VERSION, type Op } from "./types.ts";

/** JSON Schema（draft-07 常用子集，兼容 OpenAI structured outputs 约束） */
export interface JsonSchema {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

/** 指令级公共字段（任意 op 都允许；除 op 外均可选） */
export const COMMON_FIELDS = ["id", "target", "at", "dur", "interrupt"] as const;

/** 载荷字段的 JSON Schema（取值约束与 rules.ts 的 fieldRangeIssues/允许集合对齐） */
const PAYLOAD_SCHEMA: Readonly<Record<string, JsonSchema>> = {
  asset:      { type: "string" },
  expression: { type: "string" },
  outfit:     { type: "string" },
  text:       { type: "string" },
  sem:        { type: "string" },
  value:      { type: "number" },
  speed:      { type: "number", exclusiveMinimum: 0 },
  strength:   { type: "number", minimum: 0, maximum: 1 },
  mix:        { type: "number", minimum: 0, maximum: 1 },
  weight:     { type: "number", minimum: 0, maximum: 1 },
  interval:   { type: "number", minimum: 0 },
  amplitude:  { type: "number", minimum: 0 },
  period:     { type: "number", minimum: 0 },
  gaze:       { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
  ms:         { type: "number", minimum: 0 },
  loop:       { type: "boolean" },
  cover:      { type: "object", additionalProperties: { type: "number" } },
  emote: {
    type: "object", additionalProperties: false,
    properties: { valence: { type: "number" }, arousal: { type: "number" } },
    required: ["valence", "arousal"],
  },
  voice:      { type: "string" },
  blend:      { type: "string", enum: ["Add", "Multiply", "Overwrite"] },
  zoom:       { type: "number", exclusiveMinimum: 0 },
  pan:        { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
} as const;

const COMMON_SCHEMA: Readonly<Record<string, JsonSchema>> = {
  id:        { type: "string" },
  target:    { type: "string" },
  at: {
    // 流式 "+N" 相对 / 绝对 ms / 离线 "+<id>" 依赖 —— 字符串或数字皆可（合法性由校验器细分）
    oneOf: [{ type: "number" }, { type: "string" }],
  },
  dur:       { type: "number", minimum: 0 },
  interrupt: { type: "string", enum: ["target", "supersede", "queue"] },
};

/**
 * 单个 op 的严格对象 Schema。
 * - required = ["op", ...OP_RULES[op].required]（同源）
 * - additionalProperties:false 且 properties 恰好 = 公共字段 ∪ 该 op 允许的载荷字段
 *   → 表外字段（FORBIDDEN）在生成期即被禁止，与 rules.ts 语义一致。
 */
export function perOpSchema(op: Op): JsonSchema {
  const rule = OP_RULES[op];
  const allowed = rule.allowed as readonly string[];
  const properties: Record<string, JsonSchema> = { op: { const: op } };
  for (const f of COMMON_FIELDS) properties[f] = COMMON_SCHEMA[f]!;
  for (const f of allowed) properties[f] = PAYLOAD_SCHEMA[f] ?? { type: "string" };
  return {
    type: "object",
    properties,
    required: ["op", ...rule.required],
    additionalProperties: false,
  };
}

/** 单条指令 Schema：任一 op 变体。 */
export function directiveSchema(): JsonSchema {
  return {
    type: "object",
    anyOf: (Object.keys(OP_RULES) as Op[]).map((op) => perOpSchema(op)),
  };
}

/** 整条指令流 Schema（离线批量 / 流式都可用）。v 常量 = IR_VERSION。 */
export function directiveStreamSchema(): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      v: { const: IR_VERSION },
      target: { type: "string" },
      directives: { type: "array", items: directiveSchema(), minItems: 0 },
      offlines: { type: "boolean" },
    },
    required: ["v", "directives"],
  };
}


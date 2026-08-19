// MCP 表层（可选，E6）—— 工具清单由 IR JSON Schema 同源生成（DEVELOPMENT-SPEC §9 / SPEC-DSL-v1.0 §13.5）
// 工具清单 = function schema 同源：
//   - 指令类工具（play_motion/set_expression/set_parameter/look_at/speak）逐个绑定 IR op，
//     参数 schema 由 perOpSchema(op) 派生（去掉 op 字段，op 由 bridge 注入）→ 单一来源 OP_RULES。
//   - emit_directives（主工具）直接复用 emitDirectiveSchema()。
//   - get_state 为只读工具（宿主直接应答状态快照，不产生 IR 指令）。
// SDK 不实现 MCP server 本体（宿主注入）；工具调用 → IR 的薄桥见 bridge.ts。
// 仅可擦除语法（无 enum/namespace），零平台依赖，纯函数无副作用。

import { perOpSchema, emitDirectiveSchema, type JsonSchema } from "../ir/schema.ts";
import type { Op } from "../ir/types.ts";

export type McpToolName =
  | "emit_directives"
  | "play_motion"
  | "set_expression"
  | "set_parameter"
  | "look_at"
  | "speak"
  | "get_state";

export interface McpToolDef {
  label: McpToolName;
  description: string;
  /** 指令类工具对应的 IR op；只读工具无 */
  toOp?: Op;
  /** 只读工具（宿主直接应答，不产生指令） */
  readOnly?: boolean;
}

/** 7 工具清单（§9）：指令类逐个绑定 op。单一来源：MCP_TOOL_DEFS → perOpSchema → OP_RULES。 */
export const MCP_TOOL_DEFS: readonly McpToolDef[] = [
  {
    label: "emit_directives",
    description:
      "主工具：一次发射 0–8 条 IR 指令，多动作/表情/时序编排的通用入口（参数 = 完整指令流 schema，directives 内每行含 op）。",
  },
  {
    label: "play_motion",
    description: "播放一个动作资产（op=play）：asset 必填，可带 speed/mix/strength/loop/interrupt/cover。",
    toOp: "play",
  },
  {
    label: "set_expression",
    description: "设置一个表情资产（op=face）：expression 必填，可带 weight/blend。",
    toOp: "face",
  },
  {
    label: "set_parameter",
    description: "直接设置一个语义参数（op=set）：sem + value 必填。",
    toOp: "set",
  },
  {
    label: "look_at",
    description: "视线目标（op=look）：gaze=[x,y]。",
    toOp: "look",
  },
  {
    label: "speak",
    description: "让角色说话（op=speak）：text 必填，可带 voice。",
    toOp: "speak",
  },
  {
    label: "get_state",
    description: "只读：查询角色当前状态快照（参数值/播放中动作/环境层/情绪），由宿主应答，不产生 IR 指令。",
    readOnly: true,
  },
];

export const MCP_TOOL_NAMES: readonly McpToolName[] = MCP_TOOL_DEFS.map((t) => t.label);

export function mcpToolDef(name: McpToolName): McpToolDef | undefined {
  return MCP_TOOL_DEFS.find((t) => t.label === name);
}

/** 只读工具名集合（宿主应答，不走 IR）。 */
export const READ_ONLY_TOOLS: readonly McpToolName[] = MCP_TOOL_DEFS.filter((t) => t.readOnly).map((t) => t.label);

/**
 * 指令类工具的参数 schema：perOpSchema(op) 去掉 op 字段（op 由 bridge 注入），其余**完全同源**。
 * - properties = 公共字段 ∪ 该 op 允许的载荷字段（与 perOpSchema 逐键一致）
 * - required = OP_RULES[op].required（无 "op"）
 * - additionalProperties:false（表外载荷字段在生成期即被禁止，与 rules.ts 语义一致）
 */
export function toolParametersForOp(op: Op): JsonSchema {
  const s = perOpSchema(op);
  const properties: Record<string, JsonSchema> = {};
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    if (k !== "op") properties[k] = v;
  }
  const required = (s.required ?? []).filter((k) => k !== "op");
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

/** 单个工具的 inputSchema（MCP tools/list 的 inputSchema 字段）。 */
export function mcpToolSchema(name: McpToolName): JsonSchema {
  const def = mcpToolDef(name);
  if (!def) throw new Error(`未知 MCP 工具: '${name}'`);
  if (def.readOnly) return { type: "object", properties: {}, additionalProperties: false };
  if (def.label === "emit_directives") return emitDirectiveSchema();
  return toolParametersForOp(def.toOp!);
}

/** MCP tools/list 格式（宿主注入 server 本体，直接透传本清单）。 */
export interface McpToolSchema {
  name: McpToolName;
  description: string;
  inputSchema: JsonSchema;
}

export function mcpToolsList(): McpToolSchema[] {
  return MCP_TOOL_DEFS.map((t) => ({
    name: t.label,
    description: t.description,
    inputSchema: mcpToolSchema(t.label),
  }));
}

/** OpenAI Chat Completions `tools` 格式（function calling 同源）。 */
export interface OpenAiTool {
  type: "function";
  function: { name: McpToolName; description: string; parameters: JsonSchema };
}

export function mcpToolsOpenAI(): OpenAiTool[] {
  return mcpToolsList().map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

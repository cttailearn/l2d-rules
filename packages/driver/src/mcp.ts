// mcp.ts —— MCP 表层（E6，可选）：IR JSON Schema 同源生成工具清单 —— DEVELOPMENT-SPEC §9
// 薄桥：MCP 请求 → IR → 同一校验/求值。SDK 不实现 MCP server 本体（宿主注入），
// 只给同源工具清单（name/description/inputSchema），供宿主直接暴露为 function calling 工具。
// 工具清单 = function schema 同源（§13 路线图第 5 步）。

import type { JsonSchema } from "./ir/schema.ts";
import { directiveStreamSchema, perOpSchema } from "./ir/schema.ts";
import type { Op } from "./ir/types.ts";

/** 单个 MCP 工具描述（宿主直接映射为 function calling 工具）。 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

const OP_TOOL_DESC: Readonly<Record<string, { name: string; description: string }>> = {
  play: { name: "play_motion", description: "播放一个入库动作资产（顺带 speed/strength/mix/cover 覆盖）" },
  face: { name: "set_expression", description: "设置表情资产，按 weight/blend 混合到表达层" },
  set: { name: "set_parameter", description: "写 override 层：把语义参数直接设为目标值（最高优先）" },
  look: { name: "look_at", description: "设置视线目标 [x,y]（视线映射比例由宿主/引擎实现）" },
  speak: { name: "speak", description: "请求说话（文本 + 可选 voice 提示），口型由 TTS/降级管线驱动" },
};

/** get_state 工具（读当前参数状态：宿主实现，SDK 只给 schema）。 */
function getStateSchema(): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      character: { type: "string", description: "角色/槽位；缺省 main" },
      sems: { type: "array", items: { type: "string" }, description: "要读的语义参数名；缺省全部" },
    },
  };
}
const GET_STATE_TOOL: McpTool = {
  name: "get_state",
  description: "读取角色当前参数状态（宿主 ParameterSink 反向查询面，引擎只写默认不读时由宿主缓存）",
  inputSchema: getStateSchema(),
};

/**
 * 驱动工具清单（E6）：主工具 emit_directives（整流）+ 细粒度 op 工具 + get_state。
 * inputSchema 全部由规则库同源生成（perOpSchema / directiveStreamSchema）。
 */
export function driverToolCatalog(): McpTool[] {
  const tools: McpTool[] = [
    {
      name: "emit_directives",
      description: "输出一整条驱动指令流（DirectiveStream v2，可多行/离线批量）——LLM 驱动主工具",
      inputSchema: directiveStreamSchema(),
    },
  ];
  for (const opStr of Object.keys(OP_TOOL_DESC) as Op[]) {
    const d = OP_TOOL_DESC[opStr]!;
    tools.push({
      name: d.name,
      description: d.description,
      // perOpSchema 含 op 的 const 与完整 required/forbidden 结构 → 与校验器完全同源
      inputSchema: perOpSchema(opStr),
    });
  }
  tools.push(GET_STATE_TOOL);
  return tools;
}

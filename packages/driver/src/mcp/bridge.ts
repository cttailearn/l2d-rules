// MCP 薄桥 —— 工具调用 → IR 指令（同一校验/求值）—— DEVELOPMENT-SPEC §9
// SDK 不实现 MCP server 本体（宿主注入）：宿主把工具调用的 name/arguments 交给本桥，
// 得到与手写 JSONL **完全同源**的指令对象（同一 opShapeIssues 规则库），再走既有
// ingestor/evaluator（双模式校验/分层求值）。单一来源路径：工具 → op → OP_RULES。
// 仅可擦除语法（无 enum/namespace），零平台依赖，纯函数。

import { MCP_TOOL_DEFS, type McpToolName } from "./tools.ts";
import { issue, opShapeIssues, type ValidationIssue } from "../validate/rules.ts";
import type { Directive, Op } from "../ir/types.ts";

/** 宿主归一化后的工具调用（arguments 支持 OpenAI 风格 JSON 字符串或已解析对象）。 */
export interface ToolCallLike {
  name: string;
  arguments?: string | Record<string, unknown>;
}

export type ToolCallResult =
  | { ok: true; op?: Op; directives: Directive[]; readOnly?: boolean }
  | { ok: false; issues: ValidationIssue[] };

function parseArguments(call: ToolCallLike): { ok: true; args: Record<string, unknown> } | { ok: false; issues: ValidationIssue[] } {
  const a = call.arguments;
  if (a === undefined) return { ok: true, args: {} };
  if (typeof a === "object" && a !== null && !Array.isArray(a)) return { ok: true, args: a };
  if (typeof a === "string") {
    try {
      const v: unknown = JSON.parse(a);
      if (typeof v === "object" && v !== null && !Array.isArray(v)) return { ok: true, args: v as Record<string, unknown> };
      return { ok: false, issues: [issue("SHAPE", 0, `工具 '${call.name}' 参数需 JSON 对象`, "arguments")] };
    } catch (e) {
      return { ok: false, issues: [issue("JSON_PARSE", 0, `工具 '${call.name}' 参数 JSON 解析失败: ${(e as Error).message}`, "arguments")] };
    }
  }
  return { ok: false, issues: [issue("SHAPE", 0, `工具 '${call.name}' 参数类型非法`, "arguments")] };
}

/**
 * 工具调用 → IR 指令。
 * - 未知工具 / 只读工具（get_state）/ 参数非法 → 对应处理
 * - 单指令工具：注入 op 后经 opShapeIssues（同源规则库）校验
 * - emit_directives：逐条解析加载其 directives 数组，任一坏行整批失败（batch 原子语义一致）
 */
export function toolCallToDirectives(call: ToolCallLike): ToolCallResult {
  const def = MCP_TOOL_DEFS.find((t) => t.label === call.name);
  if (!def) {
    return { ok: false, issues: [issue("OP", 0, `未知 MCP 工具 '${call.name}'（清单见 MCP_TOOL_NAMES）`)] };
  }
  if (def.readOnly) return { ok: true, readOnly: true, directives: [] };

  const parsed = parseArguments(call);
  if (!parsed.ok) return parsed;

  if (def.label === "emit_directives") {
    const rows = parsed.args.directives;
    if (!Array.isArray(rows)) {
      return { ok: false, issues: [issue("SHAPE", 0, "emit_directives 参数需 directives 数组", "directives")] };
    }
    const directives: Directive[] = [];
    const issues: ValidationIssue[] = [];
    rows.forEach((raw, i) => {
      const r = opShapeIssues(raw, i, true);
      if (r.ok) directives.push(r.directive);
      else issues.push(...r.issues);
    });
    return issues.length ? { ok: false, issues } : { ok: true, op: undefined, directives };
  }

  // 单指令工具：注入 op（与 perOpSchema 同源，op 不进工具参数）
  const raw = { ...parsed.args, op: def.toOp };
  const r = opShapeIssues(raw, 0, true);
  if (!r.ok) return { ok: false, issues: r.issues };
  return { ok: true, op: def.toOp, directives: [r.directive] };
}

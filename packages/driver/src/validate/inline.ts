// inline.ts —— 在线逐行快校验（<1ms 目标）—— DEVELOPMENT-SPEC §6.6 / §7.3
// 快校验 = 规则库子集：语法 + op 形状 + 命名 + sem 存在/值域 + 资产引用 + at 流式限制。
// 不做：曲线内容（资产表查一次即知有/无，内容归 batch）、跨行依赖（流式禁止）、干跑。
// 失败 → 坏行隔离（skipped + reason=首个 issue.rule），流继续。

import type { Directive, MotionLike } from "../ir/types.ts";
import {
  opShapeIssues,
  parseJsonLine,
  namingIssues,
  semanticIssues,
  refIssues,
  type RuleCtx,
  type ValidationIssue,
} from "./rules.ts";

export interface InlineResult {
  ok: boolean;
  issues: ValidationIssue[];
  directive?: Directive;
}

export function inlineValidate(line: string, ctx: RuleCtx, lineNo = 0): InlineResult {
  const parsed = parseJsonLine(line, lineNo);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };

  const shape = opShapeIssues(parsed.raw, lineNo, false);
  if (!shape.ok) return { ok: false, issues: shape.issues };
  const d = shape.directive;

  const issues: ValidationIssue[] = [
    ...namingIssues(d, lineNo),
    ...semanticIssues(d, ctx, lineNo),
    ...refIssues(d, ctx, lineNo),
  ];
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, issues: [], directive: d };
}

// 资产解析（ingestor 路由前使用）：按名取曲线/表情（与 refIssues 同一 ctx.assets）
export function resolveAsset(d: Directive, ctx: RuleCtx): { _motion?: MotionLike; _expression?: { parameters: { id: string; value: number; blend: "Add" | "Multiply" | "Overwrite" }[] } } {
  const out: { _motion?: MotionLike; _expression?: { parameters: { id: string; value: number; blend: "Add" | "Multiply" | "Overwrite" }[] } } = {};
  if (d.op === "play" && d.asset !== undefined) out._motion = ctx.assets?.motions.get(d.asset);
  if (d.op === "face" && d.expression !== undefined) {
    const e = ctx.assets?.expressions.get(d.expression);
    if (e) out._expression = e as { parameters: { id: string; value: number; blend: "Add" | "Multiply" | "Overwrite" }[] };
  }
  return out;
}

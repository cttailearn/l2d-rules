// batch.ts —— 离线整批原子校验（全套 7 类 + 干跑）—— DEVELOPMENT-SPEC §6.6 / §7.3
// 任一规则失败 → 整批拒绝（applied 空），返回 {issues}（带行号，回传 LLM 自修复）。
// 干跑：在 scratch LayerStack/EnvironmentLayer 上求值 N 帧，任何 NaN/Inf 即拒绝。

import type { Directive, DirectiveStream, ResolvedDirective } from "../ir/types.ts";
import { EnvironmentLayer, type EnvParamDef } from "../layers/environment.ts";
import { LayerStack } from "../layers/layer-stack.ts";
import { routeDirective } from "../layers/route.ts";
import { Evaluator, type ParameterSink } from "../eval/evaluator.ts";
import {
  curveIssues,
  depIssues,
  namingIssues,
  opShapeIssues,
  parseRelativeAt,
  refIssues,
  semanticIssues,
  type RuleCtx,
  type ValidationIssue,
} from "./rules.ts";

export interface BatchValidateCtx extends RuleCtx {
  /** 干跑参数面（与 stack/env 同源） */
  params: EnvParamDef[];
  seed: number;
}

/** 整批校验：逐条全套规则 + 曲线内容 + 跨行依赖 + 干跑。 */
export function batchValidate(
  stream: DirectiveStream,
  ctx: BatchValidateCtx,
  lineOffset = 0,
): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < stream.directives.length; i++) {
    const lineNo = lineOffset + i;
    const shape = opShapeIssues(stream.directives[i], lineNo, true);
    if (!shape.ok) {
      issues.push(...shape.issues);
      continue;
    }
    const d = shape.directive;
    issues.push(
      ...namingIssues(d, lineNo),
      ...semanticIssues(d, ctx, lineNo),
      ...refIssues(d, ctx, lineNo),
    );
    // 曲线内容 + 曲线 sem 存在（引用规则下探到资产内容）
    if (d.op === "play") {
      const motion = ctx.assets?.motions.get(d.asset!);
      if (motion) {
        issues.push(...curveIssues(motion, lineNo));
        for (const c of motion.curves) {
          if (!ctx.manifest.sems.some((s) => s.name === c.id)) {
            issues.push({ path: "asset", line: lineNo, col: -1, rule: "SEM_NOT_FOUND", message: `曲线 '${c.id}' 引用的 sem 不在角色 manifest` });
          }
        }
      }
    }
  }
  issues.push(...depIssues(stream, lineOffset));
  if (issues.length > 0) return { ok: false, issues };

  const dry = dryRunIssues(stream, ctx, lineOffset);
  return dry.ok ? { ok: true, issues: [] } : { ok: false, issues: dry.issues };
}

/** at 排程（feedBatch 与干跑共享）：绝对 ms 相对流起点 / +N 相对上一条 / +id 依赖前序行开始（dur 指定则依赖其结束）。 */
export function resolveSchedule(
  stream: DirectiveStream,
  tMs: number,
): { ok: true; schedule: { d: ResolvedDirective; startMs: number }[] } | { ok: false; line: number; reason: string } {
  const schedule: { d: ResolvedDirective; startMs: number }[] = [];
  const idTimes = new Map<string, { start: number; end: number }>();
  let prev = tMs;
  for (let i = 0; i < stream.directives.length; i++) {
    const d = stream.directives[i] as ResolvedDirective;
    let start: number;
    const at = d.at;
    if (at === undefined) start = prev;
    else if (typeof at === "number") start = tMs + at;
    else {
      const rel = parseRelativeAt(at);
      if (rel !== null) start = prev + rel;
      else {
        const base = idTimes.get(at.slice(1));
        if (base === undefined) return { ok: false, line: i, reason: "AT_DEP_MISSING" };
        start = d.dur !== undefined ? base.start + d.dur : base.start;
      }
    }
    schedule.push({ d, startMs: start });
    if (d.id) idTimes.set(d.id, { start, end: start + (d.dur ?? 0) });
    prev = start;
  }
  return { ok: true, schedule };
}

// ---------------- 干跑（DRY_RUN） ----------------

const DRY_FRAME_MS = 16;
const DRY_MAX_FRAMES = 500;

/** 干跑：整批应用到全新 stack/env，求值时间轴覆盖，任何 NaN/Inf 即 DRY_RUN 拒绝。 */
function dryRunIssues(
  stream: DirectiveStream,
  ctx: BatchValidateCtx,
  lineOffset: number,
): { ok: boolean; issues: ValidationIssue[] } {
  const sched = resolveSchedule(stream, 0);
  if (!sched.ok) {
    return { ok: false, issues: [{ path: "", line: lineOffset + sched.line, col: -1, rule: sched.reason, message: `at 排程失败: ${sched.reason}` }] };
  }

  // 时间轴覆盖：最后一条的开始 + 时长（loop 封顶 2000ms 防无限）
  let maxEnd = 0;
  for (const { d, startMs } of sched.schedule) {
    const dur = d.op === "play" ? (d._motion?.loop ? 2000 : d._motion?.durationMs ?? 0) : (d.dur ?? 0);
    maxEnd = Math.max(maxEnd, startMs + dur);
  }
  const frames = Math.min(DRY_MAX_FRAMES, Math.ceil(maxEnd / DRY_FRAME_MS) + 1);

  let bad = "";
  const sink: ParameterSink = {
    apply(_c: string, params: Record<string, number>): void {
      if (bad) return;
      for (const [k, v] of Object.entries(params)) {
        if (typeof v !== "number" || !Number.isFinite(v)) {
          bad = `sem '${k}' 求值得非有限值 ${String(v)}`;
          return;
        }
      }
    },
  };
  const stack = new LayerStack(ctx.params);
  const env = new EnvironmentLayer(ctx.params, { seed: ctx.seed });
  const ev = new Evaluator(stack, env, ctx.params, sink);
  for (const { d, startMs } of sched.schedule) {
    routeDirective(
      { ...d, _motion: ctx.assets?.motions.get(d.asset ?? "") ?? d._motion, _expression: ctx.assets?.expressions.get(d.expression ?? "") ?? d._expression },
      startMs,
      stack,
      env,
    );
  }
  for (let i = 0; i < frames && bad === ""; i++) ev.onFrame(DRY_FRAME_MS);

  return bad === ""
    ? { ok: true, issues: [] }
    : { ok: false, issues: [{ path: "", line: lineOffset, col: -1, rule: "DRY_RUN", message: bad }] };
}

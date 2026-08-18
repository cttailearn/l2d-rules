// 共享规则库（7 类 + IR/流专属）—— DEVELOPMENT-SPEC §6.6 / SPEC-DSL-v1.0 §8
// 一套规则库服务双模式（inline 快校验 / batch 整批原子），错误结构直接回传 LLM 自修复。
//
// 规则分类（SPEC §8 表格）：
//   语法   —— JSON 可解析、对象形状（JSON_PARSE / SHAPE）
//   语义   —— op 合法、required 字段（OP / REQUIRED）、sem 存在（SEM_NOT_FOUND）
//   命名   —— 无裸官方 PARAM_/PARTS_（映射区外；NAMING）
//   范围   —— 值域硬校验（RANGE）
//   引用   —— play/face 资产在库且可解析（ASSET_NOT_FOUND / ASSET_UNRESOLVED）
//   曲线   —— play 资产 segments 合法（CURVE）
//   IR 专属 —— id 唯一（ID_DUP）、+id 依赖存在且无环（AT_DEP_MISSING / DEP_CYCLE）
//   干跑   —— 求值无 NaN/越界（DRY_RUN，batch 专属，见 batch.ts）
//
// at 流式限制（P2-1）：在线流式禁 "+<id>"（STREAM_DEP）。

import { isStandardParam } from "@l2dp/l2dp";
import {
  PAYLOAD_FIELDS,
  type Directive,
  type DirectiveStream,
  type ExpressionLike,
  type MotionLike,
} from "../ir/types.ts";

export interface ValidationIssue {
  /** 指令内路径（如 "asset"；顶层为 ""） */
  path: string;
  /** JSONL 行号（0 基；解析失败用当前行） */
  line: number;
  /** 列号（行级原子，恒 -1） */
  col: number;
  /** 规则名（供 LLM 自修复与 skipped.reason 复用） */
  rule: string;
  message: string;
}

export interface RuleCtx {
  manifest: { sems: { name: string; min: number; max: number; group?: string; def?: number }[] };
  library: { motions: { name: string; group?: string }[]; expressions: { name: string }[]; behaviors: never[] };
  assets?: { motions: Map<string, MotionLike>; expressions: Map<string, ExpressionLike> };
}

export function issue(rule: string, line: number, message: string, path = ""): ValidationIssue {
  return { path, line, col: -1, rule, message };
}

// ---------------- 语法：JSON 解析 ----------------

export function parseJsonLine(line: string, lineNo: number): { ok: true; raw: unknown } | { ok: false; issues: ValidationIssue[] } {
  try {
    return { ok: true, raw: JSON.parse(line) };
  } catch (e) {
    return { ok: false, issues: [issue("JSON_PARSE", lineNo, `JSON 解析失败: ${(e as Error).message}`)] };
  }
}

// ---------------- 语义：op 形状（required/forbidden/值域/at） ----------------

/** per-op：required（必填）+ allowed（允许的载荷字段；表外字段一律拒绝）。与规格 6.1 表同源。 */
export const OP_RULES: Record<Directive["op"], { required: readonly string[]; allowed: readonly string[] }> = {
  play:   { required: ["asset"], allowed: ["asset", "speed", "strength", "mix", "cover", "loop", "interrupt"] },
  face:   { required: ["expression"], allowed: ["expression", "weight", "blend"] },
  set:    { required: ["sem", "value"], allowed: ["sem", "value"] },
  outfit: { required: ["outfit"], allowed: ["outfit"] },
  speak:  { required: ["text"], allowed: ["text", "voice"] },
  blink:  { required: [], allowed: ["interval"] },
  drift:  { required: ["sem", "amplitude", "period"], allowed: ["sem", "amplitude", "period"] },
  look:   { required: ["gaze"], allowed: ["gaze"] },
  camera: { required: [], allowed: [] },
  action: { required: ["asset"], allowed: ["asset", "interrupt"] },
  emote:  { required: ["emote"], allowed: ["emote"] },
  wait:   { required: ["ms"], allowed: ["ms"] },
};

function fieldRangeIssue(d: Directive, field: string, v: unknown, lineNo: number): ValidationIssue | null {
  const num = (): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  switch (field) {
    case "value": {
      const n = num();
      return Number.isNaN(n) ? issue("RANGE", lineNo, "value 必须是有限数字", field) : null;
    }
    case "speed": {
      const n = num();
      return Number.isNaN(n) || n <= 0 ? issue("RANGE", lineNo, "speed 必须 > 0", field) : null;
    }
    case "weight": case "mix": case "strength": {
      const n = num();
      return Number.isNaN(n) || n < 0 || n > 1 ? issue("RANGE", lineNo, `${field} 必须在 [0,1]`, field) : null;
    }
    case "amplitude": case "period": case "interval": case "ms": case "dur": {
      const n = num();
      return Number.isNaN(n) || n < 0 ? issue("RANGE", lineNo, `${field} 必须 ≥ 0`, field) : null;
    }
    case "gaze": {
      if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
        return issue("RANGE", lineNo, "gaze 必须为 [x,y] 两个有限数字", field);
      }
      return null;
    }
    case "emote": {
      if (typeof v !== "object" || v === null) return issue("RANGE", lineNo, "emote 必须为对象", field);
      const e = v as { valence?: unknown; arousal?: unknown };
      const okV = typeof e.valence === "number" && Number.isFinite(e.valence) && e.valence >= -1 && e.valence <= 1;
      const okA = typeof e.arousal === "number" && Number.isFinite(e.arousal) && e.arousal >= 0 && e.arousal <= 1;
      if (!okV || !okA) return issue("RANGE", lineNo, "emote 必须为 { valence∈[-1,1], arousal∈[0,1] }", field);
      return null;
    }
    default:
      return null;
  }
}

/**
 * op 形状校验：op 合法 / required / 载荷字段白名单（表外=FORBIDDEN）/ 值域 / at 流式限制。
 * @param atDepsAllowed 是否允许 "+<id>" 依赖（batch true；inline false → STREAM_DEP）
 */
export function opShapeIssues(raw: unknown, lineNo: number, atDepsAllowed: boolean): { ok: true; directive: Directive } | { ok: false; issues: ValidationIssue[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [issue("SHAPE", lineNo, "指令必须是 JSON 对象")] };
  }
  const dir = raw as Record<string, unknown>;
  const op = dir.op;
  if (typeof op !== "string" || !(op in OP_RULES)) {
    return { ok: false, issues: [issue("OP", lineNo, `未知 op: '${String(op)}'`)] };
  }
  const rule = OP_RULES[op as Directive["op"]];
  const issues: ValidationIssue[] = [];
  for (const r of rule.required) {
    if (dir[r] === undefined) issues.push(issue("REQUIRED", lineNo, `op '${op}' 缺少必填字段 '${r}'`, r));
  }
  for (const f of PAYLOAD_FIELDS) {
    if (dir[f] === undefined) continue;
    if (!(rule.allowed as readonly string[]).includes(f)) {
      issues.push(issue("FORBIDDEN", lineNo, `op '${op}' 不允许字段 '${f}'`, f));
    }
  }
  for (const [f, v] of Object.entries(dir)) {
    if (f === "op") continue;
    if ((PAYLOAD_FIELDS as readonly string[]).includes(f as never)) {
      const e = fieldRangeIssue(dir as unknown as Directive, f, v, lineNo);
      if (e) issues.push(e);
    }
  }
  if (!atDepsAllowed && typeof dir.at === "string" && !/^\+\d+(\.\d+)?$/.test(dir.at)) {
    issues.push(issue("STREAM_DEP", lineNo, `流式模式禁止跨行依赖 at='${dir.at}'（只允许 +N 相对毫秒）`, "at"));
  }
  return issues.length === 0 ? { ok: true, directive: raw as unknown as Directive } : { ok: false, issues };
}

/** 把 at 解析为相对毫秒偏移（缺省 / "+N"）；绝对数字与 "+<id>" 返回 null（由调用方处理）。 */
export function parseRelativeAt(at: Directive["at"]): number | null {
  if (at === undefined) return 0;
  if (typeof at === "number") return null;
  const m = /^\+(\d+(?:\.\d+)?)$/.exec(at);
  return m ? Number(m[1]) : null;
}

// ---------------- 命名：无裸官方 PARAM_/PARTS_（映射区外） ----------------

/** 语义名不得是裸官方 PARAM / PARTS 前缀 id（映射区外；语义模式约定，见 SPEC C11）。 */
export function namingIssues(d: Directive, lineNo: number): ValidationIssue[] {
  const names: [string, string][] = [];
  if (d.sem !== undefined) names.push(["sem", d.sem]);
  if (d.asset !== undefined) names.push(["asset", d.asset]);
  if (d.expression !== undefined) names.push(["expression", d.expression]);
  if (d.outfit !== undefined) names.push(["outfit", d.outfit]);
  const out: ValidationIssue[] = [];
  for (const [field, name] of names) {
    if (name.startsWith("PARAM_") || name.startsWith("PARTS_") || isStandardParam(name)) {
      out.push(issue("NAMING", lineNo, `语义名 '${name}' 是官方 PARAM/PARTS id——需 semantic:true 编译产物（映射区外禁裸官方 id）`, field));
    }
  }
  return out;
}

// ---------------- 语义：sem 存在 + 值域 ----------------

export function semanticIssues(d: Directive, ctx: RuleCtx, lineNo: number): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (d.sem !== undefined) {
    const sem = ctx.manifest.sems.find((s) => s.name === d.sem);
    if (!sem) out.push(issue("SEM_NOT_FOUND", lineNo, `sem '${d.sem}' 不在角色 manifest`, "sem"));
    else if (d.value !== undefined && (d.value < sem.min || d.value > sem.max)) {
      out.push(issue("RANGE", lineNo, `value ${d.value} 超出 sem '${d.sem}' 范围 [${sem.min},${sem.max}]`, "value"));
    }
  }
  return out;
}

// ---------------- 引用：play/face 资产在库 + 可解析 ----------------

export function refIssues(d: Directive, ctx: RuleCtx, lineNo: number): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (d.op === "play") {
    if (!ctx.library.motions.some((m) => m.name === d.asset)) out.push(issue("ASSET_NOT_FOUND", lineNo, `play 资产 '${d.asset}' 不在动作库`, "asset"));
    else if (!ctx.assets?.motions.has(d.asset!)) out.push(issue("ASSET_UNRESOLVED", lineNo, `play 资产 '${d.asset}' 无曲线表（assets 未注入）`, "asset"));
  }
  if (d.op === "face") {
    if (!ctx.library.expressions.some((e) => e.name === d.expression)) out.push(issue("ASSET_NOT_FOUND", lineNo, `face 资产 '${d.expression}' 不在表情库`, "expression"));
    else if (!ctx.assets?.expressions.has(d.expression!)) out.push(issue("ASSET_UNRESOLVED", lineNo, `face 资产 '${d.expression}' 无参数表（assets 未注入）`, "expression"));
  }
  return out;
}

// ---------------- 曲线：play 资产 segments 合法 ----------------

/** motion3 Segments 合法性：初始点 + ≥1 段、全部有限、时间单调不减。 */
export function curveIssues(motion: MotionLike, lineNo: number): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!(motion.durationMs > 0)) out.push(issue("CURVE", lineNo, `durationMs 必须 > 0（得 ${motion.durationMs}）`, "asset"));
  for (const c of motion.curves) {
    const s = c.segments;
    if (s.length < 5) {
      out.push(issue("CURVE", lineNo, `曲线 '${c.id}' segments 过短（<5，至少 初始点+1段）`, "asset"));
      continue;
    }
    if (!s.every((x) => typeof x === "number" && Number.isFinite(x))) {
      out.push(issue("CURVE", lineNo, `曲线 '${c.id}' segments 含非有限值`, "asset"));
      continue;
    }
    // 时间单调不减：线性段 [t0,v0, 0, t1,v1] 每段 t1 > t0
    let prevT = s[0]!;
    let i = 2;
    let ok = true;
    while (i < s.length) {
      const type = s[i];
      i += 1;
      if (type === 0 || type === 2 || type === 3) {
        if (i + 1 >= s.length) { ok = false; break; }
        const t1 = s[i]!;
        if (t1 <= prevT) { ok = false; break; }
        prevT = t1;
        i += 2;
      } else if (type === 1) {
        if (i + 5 >= s.length) { ok = false; break; }
        const t1 = s[i + 4]!;
        if (t1 <= prevT) { ok = false; break; }
        prevT = t1;
        i += 6;
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) out.push(issue("CURVE", lineNo, `曲线 '${c.id}' 段结构非法（标识符/时间单调）`, "asset"));
  }
  return out;
}

// ---------------- IR 专属：id 唯一 + 依赖存在/无环 ----------------

/** id 唯一 + "+<id>" 引用存在且无前向引用（batch 跨行）。 */
export function depIssues(stream: DirectiveStream, lineOffset: number): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const ids = new Set<string>();
  const deps = new Map<number, string>(); // 指令下标 → 依赖的 id
  stream.directives.forEach((d, i) => {
    if (d.id !== undefined) {
      if (ids.has(d.id)) out.push(issue("ID_DUP", lineOffset + i, `指令 id '${d.id}' 重复`, "id"));
      ids.add(d.id);
    }
    if (typeof d.at === "string" && !/^\+\d+(\.\d+)?$/.test(d.at)) {
      const depId = d.at.slice(1);
      const target = stream.directives.findIndex((x) => x.id === depId);
      if (target === -1) {
        out.push(issue("AT_DEP_MISSING", lineOffset + i, `at 依赖的指令 id '${depId}' 不存在`, "at"));
      } else if (target >= i) {
        out.push(issue("DEP_CYCLE", lineOffset + i, `at 依赖 '${depId}' 是前向引用（仅可依赖前序行）`, "at"));
      } else {
        deps.set(i, depId);
      }
    }
  });
  return out;
}

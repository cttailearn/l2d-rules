// 指令快校验（inline 模式）—— DEVELOPMENT-SPEC §6.1 op 约束表 + §7.3 快校验底线
// 与规格 6.1 表格同源：required/forbidden 均为硬校验。改表格须同步此处。
// 完整 7 类规则库（batch 原子 / 干跑 / 慢校验）属 M6 validate/。

import { PAYLOAD_FIELDS, type Directive, type Op } from "./types.ts";

export interface InlineIssue {
  rule: string;
  message: string;
}

/** per-op：required（必填） + allowed（允许的载荷字段；表外字段一律拒绝） */
const OP_RULES: Record<Op, { required: readonly string[]; allowed: readonly string[] }> = {
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

/** 值域检查：字段名 → (值, 校验函数)；返回错误信息或 null。 */
function checkValue(d: Directive, field: string, v: unknown): string | null {
  const num = (): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  switch (field) {
    case "value": {
      const n = num();
      return Number.isNaN(n) ? "value 必须是有限数字" : null;
    }
    case "speed": {
      const n = num();
      return Number.isNaN(n) || n <= 0 ? "speed 必须 > 0" : null;
    }
    case "weight": case "mix": case "strength": {
      const n = num();
      return Number.isNaN(n) || n < 0 || n > 1 ? `${field} 必须在 [0,1]` : null;
    }
    case "amplitude": case "period": case "interval": case "ms": case "dur": {
      const n = num();
      return Number.isNaN(n) || n < 0 ? `${field} 必须 ≥ 0` : null;
    }
    case "gaze": {
      if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
        return "gaze 必须为 [x,y] 两个有限数字";
      }
      return null;
    }
    case "emote": {
      if (typeof v !== "object" || v === null) return "emote 必须为对象";
      const e = v as { valence?: unknown; arousal?: unknown };
      const okV = typeof e.valence === "number" && Number.isFinite(e.valence) && e.valence >= -1 && e.valence <= 1;
      const okA = typeof e.arousal === "number" && Number.isFinite(e.arousal) && e.arousal >= 0 && e.arousal <= 1;
      if (!okV || !okA) return "emote 必须为 { valence∈[-1,1], arousal∈[0,1] }";
      return null;
    }
    default:
      return null;
  }
}

/**
 * 单条指令快校验（<1ms 目标：仅类型/存在性/值域，不做资产/语义引用——引用由 ingestor 按 manifest/library 查）。
 * @param atDepsAllowed 是否允许 "+<id>" 依赖（离线批量 true；在线流式 false → STREAM_DEP）
 */
export function validateDirective(
  d: unknown,
  atDepsAllowed: boolean,
): { ok: true; directive: Directive } | { ok: false; issues: InlineIssue[] } {
  const issues: InlineIssue[] = [];
  if (typeof d !== "object" || d === null || Array.isArray(d)) {
    return { ok: false, issues: [{ rule: "SHAPE", message: "指令必须是 JSON 对象" }] };
  }
  const dir = d as Record<string, unknown>;
  const op = dir.op;
  if (typeof op !== "string" || !(op in OP_RULES)) {
    return { ok: false, issues: [{ rule: "OP", message: `未知 op: '${String(op)}'` }] };
  }
  const rule = OP_RULES[op as Op];

  // required
  for (const r of rule.required) {
    if (dir[r] === undefined) issues.push({ rule: "REQUIRED", message: `op '${op}' 缺少必填字段 '${r}'` });
  }
  // 载荷字段白名单（表外字段 = forbidden）
  for (const f of PAYLOAD_FIELDS) {
    if (dir[f] === undefined) continue;
    if (!(rule.allowed as readonly string[]).includes(f)) {
      issues.push({ rule: "FORBIDDEN", message: `op '${op}' 不允许字段 '${f}'` });
    }
  }
  // 值域
  for (const [f, v] of Object.entries(dir)) {
    if (f === "op") continue;
    if ((PAYLOAD_FIELDS as readonly string[]).includes(f as never)) {
      const err = checkValue(d as Directive, f, v);
      if (err) issues.push({ rule: "RANGE", message: err });
    }
  }
  // at：流式禁止 "+<id>"（STREAM_DEP）
  if (!atDepsAllowed && typeof dir.at === "string" && !/^\+\d+(\.\d+)?$/.test(dir.at)) {
    issues.push({ rule: "STREAM_DEP", message: `流式模式禁止跨行依赖 at='${dir.at}'（只允许 +N 相对毫秒）` });
  }
  return issues.length === 0 ? { ok: true, directive: d as Directive } : { ok: false, issues };
}

/** 把 at 解析为相对毫秒偏移（缺省 / "+N"）；绝对数字与 "+<id>" 返回 null（由调用方处理）。 */
export function parseRelativeAt(at: Directive["at"]): number | null {
  if (at === undefined) return 0;
  if (typeof at === "number") return null;
  const m = /^\+(\d+(?:\.\d+)?)$/.exec(at);
  return m ? Number(m[1]) : null;
}

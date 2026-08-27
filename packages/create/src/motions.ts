// motions.ts —— 基础动作资产生成器（idle/blink/talk/surprise）
// 曲线 = motion3 segments 布局（初始点 + 交替 0(linear)/点）；时间秒。确定性纯函数。
import type { EngineMotion } from "@l2dp/engine";
import type { CreationMotion, MotionKind } from "./ir.ts";

export interface MotionParamDef { id: string; min: number; max: number; def?: number }

export interface NamedMotion {
  name: string;
  kind: MotionKind;
  motion: EngineMotion;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 关键帧 → motion3 segments（线性段；t 严格递增）。 */
export function keysToSegments(keys: readonly (readonly [number, number])[]): number[] {
  const sorted: [number, number][] = [];
  for (const k of keys) sorted.push([k[0], k[1]]);
  sorted.sort((a, b) => a[0] - b[0]);
  const dedup: [number, number][] = [];
  for (const k of sorted) {
    if (dedup.length > 0 && k[0] <= dedup[dedup.length - 1]![0]) continue;
    dedup.push(k);
  }
  if (dedup.length === 0) return [0, 0];
  const out: number[] = [dedup[0]![0], dedup[0]![1]];
  for (let i = 1; i < dedup.length; i++) {
    const k = dedup[i]!;
    out.push(0, k[0], k[1]);
  }
  return out;
}

export function motionFromCreation(curveDefs: CreationMotion["curves"], durationMs: number, loop: boolean, name: string, kind: MotionKind): EngineMotion {
  return {
    durationMs,
    loop,
    curves: curveDefs.map((c) => ({ id: c.param, segments: keysToSegments(c.keys) })),
  };
}

/** 正弦采样关键帧（在参数范围上） */
function sineKeys(durationS: number, offset: number, amp: number, freqHz: number, phase: number, min: number, max: number, samples = 9): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / (samples - 1)) * durationS;
    const v = offset + amp * Math.sin(2 * Math.PI * freqHz * t + phase);
    out.push([t, clamp(v, min, max)]);
  }
  return out;
}

const rng = (p: MotionParamDef): number => (p.max - p.min);

/** 依据参数面生成基础动作集（只引用存在的参数）。 */
export function generateStarterMotions(params: MotionParamDef[], kinds: MotionKind[] = ["idle", "blink", "talk", "surprise", "walk"]): NamedMotion[] {
  const byId = new Map(params.map((p) => [p.id, p]));
  const has = (id: string): boolean => byId.has(id);
  const R = (id: string): number => {
    const p = byId.get(id);
    return p ? rng(p) : 1;
  };
  const out: NamedMotion[] = [];

  if (kinds.includes("idle")) {
    const durationMs = 2400;
    const curves: CreationMotion["curves"] = [];
    if (has("呼吸")) curves.push({ param: "呼吸", keys: sineKeys(durationMs / 1000, 0, R("呼吸") * 0.55, 0.25, 0, 0, 1) });
    if (has("头转向")) curves.push({ param: "头转向", keys: sineKeys(durationMs / 1000, 0, R("头转向") * 0.12, 0.12, 0, -30, 30) });
    if (has("发摆")) curves.push({ param: "发摆", keys: sineKeys(durationMs / 1000, 0, R("发摆") * 0.4, 0.12, 1.2, -1, 1) });
    if (has("身转")) curves.push({ param: "身转", keys: sineKeys(durationMs / 1000, 0, R("身转") * 0.3, 0.1, 0.5, -10, 10) });
    out.push({ name: "idle", kind: "idle", motion: motionFromCreation(curves, durationMs, true, "idle", "idle") });
  }

  if (kinds.includes("blink")) {
    const durationMs = 320;
    const keys: [number, number][] = [[0, 0], [0.13, 1], [0.32, 0]];
    const curves: CreationMotion["curves"] = [];
    if (has("眼闭左")) curves.push({ param: "眼闭左", keys });
    if (has("眼闭右")) curves.push({ param: "眼闭右", keys });
    out.push({ name: "blink", kind: "blink", motion: motionFromCreation(curves, durationMs, false, "blink", "blink") });
  }

  if (kinds.includes("talk")) {
    const durationMs = 1100;
    const curves: CreationMotion["curves"] = [];
    if (has("嘴开")) curves.push({ param: "嘴开", keys: sineKeys(durationMs / 1000, 0.1, R("嘴开") * 0.55, 2.2, 0, 0, 1) });
    if (has("头点头")) curves.push({ param: "头点头", keys: sineKeys(durationMs / 1000, 0, R("头点头") * 0.2, 2.2, 0.5, -30, 30) });
    out.push({ name: "talk", kind: "talk", motion: motionFromCreation(curves, durationMs, true, "talk", "talk") });
  }

  if (kinds.includes("surprise")) {
    const durationMs = 900;
    const curves: CreationMotion["curves"] = [];
    if (has("眉左升")) curves.push({ param: "眉左升", keys: [[0, 0], [0.15, 1], [0.6, 0.3], [0.9, 0]] });
    if (has("眉右升")) curves.push({ param: "眉右升", keys: [[0, 0], [0.15, 1], [0.6, 0.3], [0.9, 0]] });
    if (has("嘴开")) curves.push({ param: "嘴开", keys: [[0, 0], [0.18, 0.9], [0.9, 0.2]] });
    if (has("头转向")) curves.push({ param: "头转向", keys: [[0, 0], [0.5, 6], [0.9, 0]] });
    out.push({ name: "surprise", kind: "surprise", motion: motionFromCreation(curves, durationMs, false, "surprise", "surprise") });
  }

  if (kinds.includes("walk")) {
    // 行走：节奏步态——腿摆(交替大步) + 臂摆(反相) + 身摆/身转 + 点头微动（只引用存在的参数）
    const stepS = 0.42; // 单步秒
    const cycle = stepS * 2; // 完整步态周期
    const durationMs = Math.round(cycle * 1000) * 2; // 2 周期 loop，便于肉眼观察
    const curves: CreationMotion["curves"] = [];
    const stride = (id: string, amp: number, phase: number): void => {
      if (has(id)) curves.push({ param: id, keys: sineKeys(durationMs / 1000, 0, amp, 1 / cycle, phase, 0, 1) });
    };
    // 腿摆：左右腿反相大步（0..1 摆动；若已有腿摆参数）
    stride("腿摆", 0.5, 0);
    stride("臂摆", 0.4, Math.PI); // 反相（对侧手臂/腿）
    // 身摆/身转/点头微动（步态起伏 + 前进摆动）
    stride("身摆", 0.25, Math.PI / 2);
    stride("身转", 0.12, Math.PI / 2);
    if (has("头转向")) {
      curves.push({ param: "头转向", keys: sineKeys(durationMs / 1000, 0, 0.06, 1 / cycle, Math.PI / 2, 0, 1) });
    }
    if (has("头点头")) {
      curves.push({ param: "头点头", keys: sineKeys(durationMs / 1000, 0.05, 0.08, 1 / cycle, 0, 0, 1) });
    }
    out.push({ name: "walk", kind: "walk", motion: motionFromCreation(curves, durationMs, true, "walk", "walk") });
  }
  return out;
}

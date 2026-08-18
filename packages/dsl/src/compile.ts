// 语言 A 编译器（P1）：AST → .l2dp 资产（motion3/exp3）与角色 manifest 缓存。
// 对齐：l2dp v0.2 类型（packages/l2dp）、Haru 官方 motion3 Segments 布局（0=Linear/1=Bezier，时间单位秒）。
// 引用解析：track/set 的 sem 语义名 → manifest 映射官方 PARAM_*（须过标准白名单）。

import { DSL_SYNTAX_VERSION } from "./version.ts";
import { DslError } from "./errors.ts";
import { isStandardParam } from "@l2dp/l2dp";
import type { Motion as Motion3, Expression as Expression3 } from "@l2dp/l2dp";
import {
  EASINGS,
  type CharacterBlock,
  type CurveOpts,
  type Doc,
  type Easing,
  type ExpressionBlock,
  type Frame,
  type MotionBlock,
  type SceneBlock,
  type SourcePos,
  type Unit,
} from "./ast.ts";

// ------------------------------------------------------------------ 编译产物类型

export interface CharacterManifest {
  formatVersion: 1;
  syntaxVersion: string;
  id: string;
  source?: string;
  slot?: string;
  layers: { name: string; parts: string[]; z?: number; physics?: string }[];
  bones: { name: string; layer: string; pivot?: { x: number; y: number }; limit?: { axis?: string; sign?: string; value: number; unit?: Unit } }[];
  outfits: { name: string; group: number }[];
  sems: { name: string; min: number; max: number; unit?: Unit; params: string[] }[];
  /** 动作库索引（同一源文档中声明的资产名）；LLM 驱动模式与调度器消费，见规范 5.1.1/12.1 */
  assetIndex: { motions: { name: string; group?: string }[]; expressions: { name: string }[]; behaviors: never[] };
}

/** 舞台布局产物：多角色入场/相机/背景（渲染端 P6 消费） */
export interface SceneLayout {
  formatVersion: 1;
  syntaxVersion: string;
  id: string;
  camera?: { zoom?: number; anchor?: { x: number; y: number } };
  casts: { name: string; source: string; anchor: { x: number; y: number }; scale?: number }[];
  bg?: string;
  physics?: boolean;
}

export interface CompileOutput {
  manifests: CharacterManifest[];
  motions: Motion3[];
  expressions: Expression3[];
  scenes: SceneLayout[];
}

export type CompileResult = { ok: true; output: CompileOutput } | { ok: false; error: DslError };

// ------------------------------------------------------------------ easing → 贝塞尔控制点（时间 x 与值 y 均按 [0,1] 标度）

export const EASING_BEZIER: Record<Easing, [number, number, number, number] | null> = {
  linear: null, // 用线性段
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  easeOutBack: [0.34, 1.56, 0.64, 1],
};

// ------------------------------------------------------------------ Segments 生成（对齐 Haru 官方布局）

export interface SegPoint {
  t: number; // 秒
  v: number; // 值（官方参数域）
}

/**
 * 生成 motion3 Segments 扁平数组。
 * - 无 easing（linear）：单 Linear 段 `[0, p0..pn]`（多点折线）
 * - 有 easing：首段 Linear 建立起点 `[0, p0, p1]`，后续每对关键帧一个 Bezier 段
 *   `[1, c1t,c1v, c2t,c2v, pn]`（起点沿用上一关键帧，control 点由 cubic-bezier 换算）
 * 首元素恒为 0（Linear），与官方 Cubism 曲线惯例一致（Haru 所有曲线均以 Linear 起始）。
 */
export function buildSegments(points: SegPoint[], easing?: Easing): number[] {
  if (points.length === 0) return [0];
  if (points.length === 1) return [0, points[0].t, points[0].v];

  const bz = easing !== undefined && easing !== "linear" ? EASING_BEZIER[easing] : null;
  if (bz === null) {
    const s: number[] = [0];
    for (const p of points) s.push(round6(p.t), round6(p.v));
    return s;
  }

  const s: number[] = [0, round6(points[0].t), round6(points[0].v)];
  // i=1 仍是 Linear（建立第二个点，后续 Bezier 段起点沿用它）
  s.push(round6(points[1].t), round6(points[1].v));
  for (let i = 2; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = b.t - a.t;
    const dv = b.v - a.v;
    const c1t = a.t + bz[0] * dt;
    const c1v = a.v + bz[1] * dv;
    const c2t = a.t + bz[2] * dt;
    const c2v = a.v + bz[3] * dv;
    s.push(1, round6(c1t), round6(c1v), round6(c2t), round6(c2v), round6(b.t), round6(b.v));
  }
  return s;
}

/**
 * 从 motion3 Segments 统计段数与点数（口径 = Haru 官方：每「类型标记+点组」为一段；
 * Linear 段 n 个点、Bezier 段 3 个点、Stepped 段 1 个点），见 docs/SPEC-DSL-v1.0.md 3 章。
 */
export function countSegmentsPoints(segments: number[]): { segments: number; points: number } {
  if (segments.length === 0) return { segments: 0, points: 0 };
  let seg = 0;
  let pts = 0;
  let i = 0;
  while (i < segments.length) {
    const type = segments[i];
    i += 1;
    seg += 1;
    if (type === 0) {
      let n = 0;
      while (i + 1 < segments.length && segments[i] !== 1 && segments[i] !== 2) {
        n += 1;
        i += 2;
      }
      pts += n;
    } else if (type === 1) {
      pts += 3;
      i += 6;
    } else if (type === 2) {
      pts += 1;
      i += 2;
    } else {
      break; // 无法识别的段
    }
  }
  return { segments: seg, points: pts };
}

// ------------------------------------------------------------------ curve 函数展开（P1 信号级；范围映射/参数化属 P6）

const CURVE_SIGNALS: Record<string, { amp: number; bias: number; freqHz: number; phase: number }> = {
  breath: { amp: 0.5, bias: 0.5, freqHz: 0.5, phase: 0 }, // ≈ 2s 周期呼吸，0..1
  wave: { amp: 0.5, bias: 0.5, freqHz: 1, phase: Math.PI / 2 },
  random: { amp: 0.5, bias: 0.5, freqHz: 2, phase: 0.7 }, // P1 简化：固定频正弦，非真随机
};

export function expandCurve(kind: "breath" | "blink" | "wave" | "random", durationMs: number, fps: number, fallbackPos: SourcePos, opts?: CurveOpts): Frame[] {
  if (kind === "blink") {
    const amp = opts?.amplitude ?? 1;
    const mk = (timeMs: number, v: number): Frame => ({ timeMs, value: { num: round6(v * amp), pos: fallbackPos }, pos: fallbackPos });
    return [mk(0, 0), mk(100, 1), mk(250, 0)];
  }
  const base = CURVE_SIGNALS[kind];
  const amp = opts?.amplitude ?? base.amp;
  const bias = opts?.bias ?? base.bias;
  const freqHz = opts?.periodMs !== undefined && opts.periodMs > 0 ? 1000 / opts.periodMs : base.freqHz;
  const phase = base.phase;
  const n = Math.max(2, Math.ceil((durationMs / 1000) * fps));
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const timeMs = round6(t * durationMs);
    const v = round6(bias + amp * Math.sin(2 * Math.PI * freqHz * t * (durationMs / 1000) + phase));
    frames.push({ timeMs, value: { num: v, pos: fallbackPos }, pos: fallbackPos });
  }
  return frames;
}

// ------------------------------------------------------------------ 编译入口

export function compileDoc(doc: Doc, opts: { fps?: number } = {}): CompileResult {
  try {
    const manifests = doc.blocks.filter((b): b is CharacterBlock => b.kind === "character").map(compileCharacter);
    const hasMotionOrExpr = doc.blocks.some((b) => b.kind === "motion" || b.kind === "expression");
    if ((hasMotionOrExpr) && manifests.length === 0) {
      const first = doc.blocks.find((b) => b.kind === "motion" || b.kind === "expression")!;
      throw new DslError((first as { pos: SourcePos }).pos.line, (first as { pos: SourcePos }).pos.col, "REF",
        "包含 motion/expression 但缺少 character 块（需角色 manifest 解析语义参数）");
    }
    const manifest = manifests[0]; // 文档惯例：单角色文件
    const motions: Motion3[] = [];
    const expressions: Expression3[] = [];
    const scenes: SceneLayout[] = [];
    for (const b of doc.blocks) {
      if (b.kind === "motion") motions.push(compileMotion(b, manifest, opts));
      if (b.kind === "expression") expressions.push(compileExpression(b, manifest));
      if (b.kind === "scene") scenes.push(compileScene(b));
    }
    // 把同文档声明的资产名登记进 assetIndex（固定态资产索引）
    if (manifest) {
      manifest.assetIndex.motions.push(...doc.blocks.filter((b): b is MotionBlock => b.kind === "motion").map((m) => ({ name: m.name, group: m.group })));
      manifest.assetIndex.expressions.push(...doc.blocks.filter((b): b is ExpressionBlock => b.kind === "expression").map((e) => ({ name: e.name })));
    }
    return { ok: true, output: { manifests, motions, expressions, scenes } };
  } catch (e) {
    if (e instanceof DslError) return { ok: false, error: e };
    throw e;
  }
}

export function compileCharacter(c: CharacterBlock): CharacterManifest {
  for (const sem of c.sems) {
    for (const p of sem.params) {
      if (!isStandardParam(p)) {
        throw new DslError(sem.pos.line, sem.pos.col, "BAD_PARAM",
          `sem '${sem.name}' 映射的官方参数 '${p}' 不在标准白名单（specs/standard-params.json + isStandardParam）`);
      }
    }
    if (sem.min >= sem.max) throw new DslError(sem.pos.line, sem.pos.col, "CONSTRAINT", `sem '${sem.name}' 范围无效`);
  }
  return {
    formatVersion: 1,
    syntaxVersion: DSL_SYNTAX_VERSION,
    id: c.name,
    source: c.source,
    slot: c.slot,
    layers: c.layers.map((l) => ({ name: l.name, parts: l.parts, z: l.z, physics: l.physics })),
    bones: c.bones.map((b) => ({ name: b.name, layer: b.layer, pivot: b.pivot, limit: b.limit })),
    outfits: c.outfits.map((o) => ({ name: o.name, group: o.group })),
    sems: c.sems.map((s) => ({ name: s.name, min: s.min, max: s.max, unit: s.unit, params: s.params })),
    assetIndex: { motions: [], expressions: [], behaviors: [] },
  };
}

export function compileScene(s: SceneBlock): SceneLayout {
  return {
    formatVersion: 1,
    syntaxVersion: DSL_SYNTAX_VERSION,
    id: s.name,
    camera: s.camera,
    casts: s.casts.map((c) => ({ name: c.name, source: c.source, anchor: c.anchor, scale: c.scale })),
    bg: s.bg,
    physics: s.physics,
  };
}

function semIndex(manifest: CharacterManifest): Map<string, { min: number; max: number; unit?: Unit; params: string[] }> {
  return new Map(manifest.sems.map((s) => [s.name, s]));
}

export function compileMotion(motion: MotionBlock, manifest: CharacterManifest, opts: { fps?: number } = {}): Motion3 {
  const fps = opts.fps ?? 30;
  const sems = semIndex(manifest);

  const frameMax = motion.tracks.reduce((acc, t) => Math.max(acc, ...t.frames.map((f) => f.timeMs)), 0);
  const durationMs = motion.durationMs ?? (frameMax > 0 ? frameMax : 3000);

  const curves: Motion3["curves"] = [];
  let segmentsTotal = 0;
  let pointsTotal = 0;
  for (const tr of motion.tracks) {
    const sem = sems.get(tr.sem);
    if (sem === undefined) {
      throw new DslError(tr.pos.line, tr.pos.col, "REF", `motion '${motion.name}' 引用了不存在的语义参数 '${tr.sem}'（不在角色 manifest）`);
    }
    const frames = tr.curve !== undefined ? expandCurve(tr.curve, durationMs, fps, tr.pos, tr.curveOpts) : tr.frames;
    const points: SegPoint[] = frames.map((f) => ({ t: f.timeMs / 1000, v: f.value.num }));
    const segments = buildSegments(points, tr.easing);
    const stat = countSegmentsPoints(segments);
    for (const p of sem.params) {
      curves.push({ target: "Parameter", id: p, segments: [...segments] });
      segmentsTotal += stat.segments; // 每条官方参数曲线各计一次
      pointsTotal += stat.points;
    }
  }

  return {
    meta: {
      duration: round6(durationMs / 1000),
      fps,
      loop: motion.loop,
      curveCount: curves.length,
      totalSegmentCount: segmentsTotal,
      totalPointCount: pointsTotal,
    },
    curves,
  };
}

export function compileExpression(expr: ExpressionBlock, manifest: CharacterManifest): Expression3 {
  const sems = semIndex(manifest);
  const parameters: Expression3["parameters"] = [];
  for (const s of expr.sets) {
    const sem = sems.get(s.sem);
    if (sem === undefined) {
      throw new DslError(s.pos.line, s.pos.col, "REF", `expression '${expr.name}' 引用了不存在的语义参数 '${s.sem}'`);
    }
    for (const p of sem.params) {
      parameters.push({ id: p, value: s.value.num, blend: expr.blend as Expression3["parameters"][number]["blend"] });
    }
  }
  return { type: "Live2D Expression", parameters };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

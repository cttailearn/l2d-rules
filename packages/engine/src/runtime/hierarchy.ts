// 变换层级 hierarchy.ts —— DEVELOPMENT-SPEC §5.5
// 参照 Iki affine.ts + deform.ts（evaluateTransform / deformerLocalMatrix / resolveDeformerWorlds）。
// binding 语义（与 Iki 对齐，忠实于规范 §5.5 "参照 iki affine"）：
//   t = params.normalized(param)         // 参数在自身范围的归一化位置 0..1
//   value = from + (to - from) * t       // from/to = 变换分量输出区间（非参数区间）
//   channel：x/y→平移累加；rotation→角度(deg)累加；scaleX/Y→缩放累加（加法性）
// 局部 deformer 矩阵 = translate(pivot)·TRS·translate(-pivot)（绕枢轴）。

import type { L2dmBinding, L2dmDeformer } from "../format/types.ts";
import type { ParameterStore } from "./parameter-store.ts";

/** 2D 仿射（3x3 齐次矩阵上两行）：| a c e | / | b d f | / | 0 0 1 | */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function translate(tx: number, ty: number): Affine {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy: number): Affine {
  return [sx, 0, 0, sy, 0, 0];
}

/** 旋转（角度制） */
export function rotate(degrees: number): Affine {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

/** a·b（先应用 b，再应用 a） */
export function multiply(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** 仿射变换作用于点 */
export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export interface ResolvedTransform {
  x: number;
  y: number;
  rotation: number; // deg
  scaleX: number;
  scaleY: number;
}

const IDENTITY_TRANSFORM: ResolvedTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

/**
 * 求值 bindings → 在基础变换上累加（Iki evaluateTransform 语义）。
 */
export function evalBindings(
  bindings: L2dmBinding[] | undefined,
  params: ParameterStore,
  base: ResolvedTransform,
): ResolvedTransform {
  const out: ResolvedTransform = { ...base };
  for (const b of bindings ?? []) {
    const t = params.normalized(b.parameter);
    const value = b.from + (b.to - b.from) * t;
    switch (b.channel) {
      case "x": out.x += value; break;
      case "y": out.y += value; break;
      case "rotation": out.rotation += value; break;
      case "scaleX": out.scaleX += value; break;
      case "scaleY": out.scaleY += value; break;
    }
  }
  return out;
}

/** 从基础变换 + bindings 构造局部 TRS 矩阵（顺序同 Iki：translate·rotate·scale） */
export function bindingToMatrix(
  base: ResolvedTransform,
  bindings: L2dmBinding[] | undefined,
  params: ParameterStore,
): Affine {
  const t = evalBindings(bindings, params, base);
  return multiply(translate(t.x, t.y), multiply(rotate(t.rotation), scale(t.scaleX, t.scaleY)));
}

/** deformer 绕其枢轴的局部矩阵：translate(pivot)·TRS·translate(-pivot) */
export function deformerLocalMatrix(
  d: L2dmDeformer,
  params: ParameterStore,
): Affine {
  const trs = bindingToMatrix(IDENTITY_TRANSFORM, d.bindings, params);
  const pivot = d.pivot ?? { x: 0, y: 0 };
  return multiply(
    multiply(translate(pivot.x, pivot.y), trs),
    translate(-pivot.x, -pivot.y),
  );
}

/**
 * 计算每个 deformer 的世界矩阵（沿父链连乘，任意数组顺序；父先于子递归解析）。
 * 入参假定已通过 validate（无环、父存在）；父缺失/成环抛 Error（防御：表示未校验模型进入引擎）。
 */
export function resolveDeformerMatrices(
  deformers: L2dmDeformer[],
  params: ParameterStore,
): Map<string, Affine> {
  const byId = new Map(deformers.map(d => [d.id, d]));
  const cache = new Map<string, Affine>();
  const resolving = new Set<string>();

  const worldOf = (id: string): Affine => {
    const cached = cache.get(id);
    if (cached) return cached;
    if (resolving.has(id)) throw new Error(`deformer 层级成环: ${id}`);
    resolving.add(id);
    const d = byId.get(id);
    if (!d) throw new Error(`deformer '${id}' 不存在`);
    const local = deformerLocalMatrix(d, params);
    const w = d.parent !== undefined ? multiply(local, worldOf(d.parent)) : local;
    cache.set(id, w);
    resolving.delete(id);
    return w;
  };

  const worlds = new Map<string, Affine>();
  for (const d of deformers) worlds.set(d.id, worldOf(d.id));
  return worlds;
}

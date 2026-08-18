// ArtMesh 形变模型（规格 6.2 deformers.json / T1）：与 Cubism 语义一致
export interface Vec2 { x: number; y: number; }
export interface DeformerDef {
  id: string;
  type: "warp" | "rotation";
  target: string;
  controlPoints: { source: Vec2; destination: Vec2 }[];
  normalization: { paramId: string; min: number; def: number; max: number };
  curve: "linear" | "bezier";
  curvePoints?: Vec2[];
}

export interface WeightedMesh {
  id: string;
  vertices: Vec2[];          // 基准位置
  weights: { deformerId: string; values: number[] }[]; // 每顶点权重
}

export function curveValue(curve: "linear" | "bezier", t: number, pts?: Vec2[]): number {
  if (curve === "bezier") {
    const tt = Math.min(1, Math.max(0, t)); // 贝塞尔仅定义在 [0,1]
    if (pts && pts.length >= 2) {
      const [p0, p1] = [pts[0], pts[1]];
      return p0.y + (p1.y - p0.y) * tt;
    }
    return tt;
  }
  return t; // 线性保持符号（负参数反向形变）
}

// 参数值 → 有符号归一化 t ∈ [-1,1]（def 两侧方向相反；线性曲线保持符号）
export function normalizeParam(v: number, n: { min: number; def: number; max: number }): number {
  if (v >= n.def) return n.max > n.def ? (v - n.def) / (n.max - n.def) : 0;
  return n.min < n.def ? -(n.def - v) / (n.def - n.min) : 0;
}

// 计算单顶点形变位移（所有变形器加权和）
export function deformVertex(v: Vec2, mesh: WeightedMesh, vertexIndex: number, paramValues: Record<string, number>): Vec2 {
  let dx = 0, dy = 0;
  for (const w of mesh.weights) {
    const def = findDeformer(w.deformerId);
    if (!def) continue;
    const pv = paramValues[def.normalization.paramId];
    if (pv === undefined) continue;
    const t = normalizeParam(pv, def.normalization);
    const c = curveValue(def.curve, t, def.curvePoints);
    const weight = w.values[vertexIndex] ?? 0;
    if (weight === 0 || c === 0) continue;
    // 控制点对插值：以 source 为基点，destination 为目标
    const base = def.controlPoints[0]?.source ?? { x: 0, y: 0 };
    const dest = def.controlPoints[0]?.destination ?? { x: 0, y: 0 };
    dx += (dest.x - base.x) * c * weight;
    dy += (dest.y - base.y) * c * weight;
  }
  return { x: v.x + dx, y: v.y + dy };
}

const deformerRegistry = new Map<string, DeformerDef>();
export function registerDeformers(defs: DeformerDef[]): void { for (const d of defs) deformerRegistry.set(d.id, d); }
export function clearDeformers(): void { deformerRegistry.clear(); }
export function findDeformer(id: string): DeformerDef | undefined { return deformerRegistry.get(id); }

export function deformMesh(mesh: WeightedMesh, paramValues: Record<string, number>): Vec2[] {
  return mesh.vertices.map((v, i) => deformVertex(v, mesh, i, paramValues));
}

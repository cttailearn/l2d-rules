// meshes.ts —— 模板网格生成（P4a）
// 每个语义部件 = 语义模板网格配准到其 bbox（画布像素坐标，y 向下，与 engine 坐标契约一致）。
import type { L2dmMesh } from "@l2dp/engine";

export interface Grid {
  cols: number;
  rows: number;
  width: number;
  height: number;
  x0: number;
  y0: number;
  /** [x0,y0, x1,y1, ...] 画布坐标 */
  vertices: number[];
  /** [u0,v0, ...] 0..1 */
  uvs: number[];
  /** 三角形索引（3 的倍数） */
  indices: number[];
}

/** 矩形 bbox → 网格（cols×rows；行列按 0..cols-1 / 0..rows-1 均匀展开）。 */
export function makeGrid(
  cols: number,
  rows: number,
  bbox: { x: number; y: number; width: number; height: number },
): Grid {
  const width = Math.max(1, bbox.width);
  const height = Math.max(1, bbox.height);
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      vertices.push(bbox.x + (c / (cols - 1)) * width, bbox.y + (r / (rows - 1)) * height);
      uvs.push(c / (cols - 1), r / (rows - 1));
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i0 = r * cols + c;
      const i1 = i0 + 1;
      const i2 = i0 + cols;
      const i3 = i2 + 1;
      indices.push(i0, i1, i2, i0, i2, i3);
    }
  }
  return { cols, rows, width, height, x0: bbox.x, y0: bbox.y, vertices, uvs, indices };
}

/** 顶点 index → (col, row) */
export function gridColRow(g: Grid, vi: number): [number, number] {
  const c = vi % g.cols;
  const r = (vi - c) / g.cols;
  return [c, r];
}

/** 顶点 index → 画布坐标 (x, y) */
export function gridXY(g: Grid, vi: number): [number, number] {
  return [g.vertices[vi * 2]!, g.vertices[vi * 2 + 1]!];
}

export function toL2dmMesh(g: Grid): L2dmMesh {
  return { vertices: g.vertices, uvs: g.uvs, indices: g.indices };
}

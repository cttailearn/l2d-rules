// moc/to-l2dm.ts —— `.moc`（Cubism 2.x）解析结果 → 基础姿态 .l2dm
// 语义（与官方 runtime 一致）：
//   - pointCount = 绘制顶点数；indices = 三角形索引（polygonCount*3）
//   - uv = 每顶点 2 个 f32（0..1，纹理空间）
//   - points = 位置池：每顶点可有多状态（base + 形变 keyform），base 姿态 = 前 pointCount*2
//   - 坐标系：Cubism 2 画布原点 (0,0) 左上、y 向下 —— 与 .l2dm（左上原点、y 向下）天然一致，无需翻转
//   - 绘制顺序：按 averageDrawOrder 升序（缺省按出现顺序）
//   - 纹理：mesh.textureId → textures[textureId]（model.json 提供）
import type { L2dmModel } from "@l2dp/engine";
import { mapEngineGroup } from "../map.ts";
import type { MocData, MocMesh } from "./format.ts";

export interface MocToL2dmOptions {
  id: string;
  /** model.json textures（idx → 文件名） */
  textures?: string[];
  /** 目标画布覆盖（缺省用 moc canvas） */
  canvas?: { width: number; height: number };
}

/** 取一个 mesh 的 base 姿态顶点（xy 交错）：位置池前 pointCount*2 */
export function basePointsOf(mesh: MocMesh): number[] {
  const n = Math.min(mesh.points.length, mesh.pointCount * 2);
  return mesh.points.slice(0, n);
}

/** 便捷：状态数（位置池/每状态顶点数） */
export function stateCountOf(mesh: MocMesh): number {
  const per = mesh.pointCount * 2;
  return per > 0 ? Math.max(1, Math.round(mesh.points.length / per)) : 1;
}

export function mocToL2dm(moc: MocData, opts: MocToL2dmOptions): L2dmModel {
  const texArr = opts.textures ?? [];

  // ---- 参数 ----
  const parameters = moc.parameters.map((p) => ({
    id: p.id,
    min: Math.min(p.min, p.max),
    max: Math.max(p.min, p.max),
    def: p.def,
    group: mapEngineGroup(p.id, undefined, []),
  }));

  // ---- 画布 ----
  const canvas = opts.canvas ?? (moc.canvas.width > 0 && moc.canvas.height > 0
    ? { width: moc.canvas.width, height: moc.canvas.height }
    : { width: 32, height: 32 });

  // ---- 网格部件（按 averageDrawOrder 升序；缺档案按出现顺序） ----
  const indexed = moc.meshes
    .map((mesh, i) => ({ mesh, i }))
    .sort((a, b) => a.mesh.averageDrawOrder - b.mesh.averageDrawOrder || a.i - b.i);

  const parts: L2dmModel["parts"] = indexed.map(({ mesh }, order) => {
    const base = basePointsOf(mesh);
    const nv = mesh.pointCount * 2; // 顶点（xy）应该有的长度
    // 顶点不足/索引越界 → 跳过（防御）
    if (base.length < nv || mesh.indices.length === 0 || mesh.indices.length % 3 !== 0 || mesh.uv.length < nv) {
      return { id: mesh.id || `m${order}`, order, color: [1, 1, 1, 0] };
    }
    // 修正 UV 长度（pool 可能 > nv；截断到 nv）
    const uvs = mesh.uv.slice(0, nv);
    const tex = mesh.textureId >= 0 && mesh.textureId < texArr.length ? texArr[mesh.textureId] : undefined;
    return {
      id: mesh.id || `m${order}`,
      order,
      texture: tex,
      color: [1, 1, 1, 1],
      mesh: {
        vertices: base,
        uvs,
        indices: mesh.indices.slice(),
      },
    };
  });

  return {
    formatVersion: 1,
    id: opts.id,
    canvas,
    parameters,
    parts,
  };
}

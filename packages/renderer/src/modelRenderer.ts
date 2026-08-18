// 模型级渲染（软件路径）：部件网格（UV+纹理页）→ 形变 → drawOrder 排序 → 光栅化
import { deformMesh, registerDeformers, type WeightedMesh, type DeformerDef } from "./deform.ts";
import { buildRenderList, type RenderPart } from "./scene.ts";
import { SoftwareCanvas, type Tex2D, type Tri2D } from "./software.ts";
import type { Mesh } from "@l2dp/l2dp";

export interface RenderModel {
  parts: RenderPart[];
  meshes: Map<string, { vertices: { x: number; y: number; u: number; v: number }[]; triangles: number[]; weights: { deformerId: string; values: number[] }[] }>;
  textures: Map<number, Tex2D>;
  deformers: DeformerDef[];
}

export interface RenderOptions { activeCostumeGroup: number | null; clear: [number, number, number, number]; scale?: number; offsetX?: number; offsetY?: number; }

export function renderModel(model: RenderModel, params: Record<string, number>, opts: RenderOptions): SoftwareCanvas {
  registerDeformers(model.deformers);
  const canvas = new SoftwareCanvas(320, 320);
  canvas.clear(opts.clear);
  const scale = opts.scale ?? 1, ox = opts.offsetX ?? 0, oy = opts.offsetY ?? 0;
  for (const part of buildRenderList(model.parts, { activeCostumeGroup: opts.activeCostumeGroup })) {
    if (!part.meshId) continue;
    const raw = model.meshes.get(part.meshId);
    if (!raw || raw.triangles.length < 3) continue;
    const mesh: WeightedMesh = { id: part.meshId, vertices: raw.vertices.map(v => ({ x: v.x, y: v.y })), weights: raw.weights };
    const deformed = deformMesh(mesh, params);
    const tex = model.textures.get(part.texturePage) ?? null;
    for (let i = 0; i + 2 < raw.triangles.length; i += 3) {
      const [ia, ib, ic] = [raw.triangles[i], raw.triangles[i + 1], raw.triangles[i + 2]];
      if (ia >= deformed.length || ib >= deformed.length || ic >= deformed.length) continue;
      const tri: Tri2D = {
        a: [deformed[ia].x * scale + ox, deformed[ia].y * scale + oy],
        b: [deformed[ib].x * scale + ox, deformed[ib].y * scale + oy],
        c: [deformed[ic].x * scale + ox, deformed[ic].y * scale + oy],
        uv: [[raw.vertices[ia].u, raw.vertices[ia].v], [raw.vertices[ib].u, raw.vertices[ib].v], [raw.vertices[ic].u, raw.vertices[ic].v]],
        tex,
        color: [255, 255, 255, Math.round(255 * part.opacity)],
      };
      canvas.drawTri(tri);
    }
  }
  return canvas;
}

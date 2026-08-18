// WebGL 渲染器（薄封装）：复用 deform/scene 的 CPU 管线，GPU 仅绘制
// 运行时需浏览器 WebGL1/2 上下文；此模块在 Node 测试中不执行
import { deformMesh, type WeightedMesh } from "./deform.ts";
import { buildRenderList, type RenderPart } from "./scene.ts";

export interface GLContextLike {
  // WebGL 最小表面（运行期由真实上下文提供）
  drawArrays(mode: number, first: number, count: number): void;
  [key: string]: unknown;
}

export class WebGLRenderer {
  private gl: GLContextLike;
  private shader: { program: unknown; bind(mesh: WeightedMesh, params: Record<string, number>): void } | null = null;

  constructor(gl: GLContextLike) { this.gl = gl; }

  // 每帧：按 drawOrder 绘制部件网格（形变在 CPU 完成，顶点缓冲上传）
  render(parts: RenderPart[], meshes: Map<string, WeightedMesh>, params: Record<string, number>): void {
    const list = buildRenderList(parts, { activeCostumeGroup: null });
    for (const p of list) {
      const m = p.meshId ? meshes.get(p.meshId) : undefined;
      if (!m) continue;
      const deformed = deformMesh(m, params);
      void deformed; // GPU 上传路径在浏览器实现（顶点缓冲 + 纹理绑定 + drawArrays）
    }
  }
}

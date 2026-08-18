// 软件光栅化器 SoftwareRenderer —— 无头/CI/兜底（DEVELOPMENT-SPEC §5.7）
// 从 renderer/software.ts 迁移并适配 RenderSink 三阶段：
//   边缘函数重心坐标光栅化 + UV 最近邻采样 + 直通 alpha 混合。
// 确定性：纯函数、无随机；同 (mesh 序列) → 同像素。

import type { RenderMesh, RenderSink, Tex2D } from "./sink.ts";

function edge(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x: number,
  y: number,
): number {
  return (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
}

export class SoftwareRenderer implements RenderSink {
  private textures = new Map<string, Tex2D>();
  private width = 0;
  private height = 0;
  private data = new Uint8Array(0);
  private inFrame = false;

  uploadTexture(id: string, img: Tex2D): void {
    this.textures.set(id, img);
  }

  begin(width: number, height: number): void {
    this.width = Math.max(0, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    this.data = new Uint8Array(this.width * this.height * 4);
    this.data.fill(0); // 透明黑底
    this.inFrame = true;
  }

  draw(mesh: RenderMesh): void {
    if (!this.inFrame) throw new Error("draw 必须在 begin 之后调用");
    if (mesh.indices.length % 3 !== 0) return;
    const tex =
      mesh.texId === null ? null : (this.textures.get(mesh.texId) ?? null);
    const { verts, uvs } = mesh;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const i0 = mesh.indices[t] * 2;
      const i1 = mesh.indices[t + 1] * 2;
      const i2 = mesh.indices[t + 2] * 2;
      this.rasterTri(
        [verts[i0], verts[i0 + 1]],
        [verts[i1], verts[i1 + 1]],
        [verts[i2], verts[i2 + 1]],
        uvs[i0],
        uvs[i0 + 1],
        uvs[i1],
        uvs[i1 + 1],
        uvs[i2],
        uvs[i2 + 1],
        tex,
        mesh.color,
      );
    }
  }

  end(): void {
    this.inFrame = false;
  }

  readPixels(): Uint8Array | null {
    return this.data;
  }

  size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** 直接取某像素（测试断言用） */
  pixel(x: number, y: number): [number, number, number, number] {
    const o = (y * this.width + x) * 4;
    return [this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3]];
  }

  /** 非透明像素数（测试断言用） */
  countNonTransparent(): number {
    let n = 0;
    for (let i = 0; i < this.width * this.height; i++) {
      if (this.data[i * 4 + 3] > 0) n++;
    }
    return n;
  }

  private rasterTri(
    a: [number, number],
    b: [number, number],
    c: [number, number],
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    u2: number,
    v2: number,
    tex: Tex2D | null,
    color: [number, number, number, number],
  ): void {
    const [ax, ay] = a;
    const [bx, by] = b;
    const [cx, cy] = c;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(ay, by, cy)));
    const area2 = edge(ax, ay, bx, by, cx, cy);
    if (Math.abs(area2) < 1e-9) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = edge(bx, by, cx, cy, x + 0.5, y + 0.5);
        const w1 = edge(cx, cy, ax, ay, x + 0.5, y + 0.5);
        const w2 = edge(ax, ay, bx, by, x + 0.5, y + 0.5);
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          const area = area2;
          const u = w0 / area;
          const v = w1 / area;
          const w = w2 / area;
          const o = (y * this.width + x) * 4;
          if (tex) {
            const tu = u0 * u + u1 * v + u2 * w;
            const tv = v0 * u + v1 * v + v2 * w;
            const px = Math.min(
              tex.width - 1,
              Math.max(0, Math.floor(tu * tex.width)),
            );
            const py = Math.min(
              tex.height - 1,
              Math.max(0, Math.floor(tv * tex.height)),
            );
            const to = (py * tex.width + px) * 4;
            // 覆盖系数 = 纹素 alpha × tint alpha；tint RGB 逐通道乘（与 WebGL2 shader tex.rgb*uTint.rgb 一致）
            const a = (tex.data[to + 3] / 255) * (color[3] / 255);
            const ia = 1 - a;
            this.data[o] = Math.round(
              tex.data[to] * (color[0] / 255) * a + this.data[o] * ia,
            );
            this.data[o + 1] = Math.round(
              tex.data[to + 1] * (color[1] / 255) * a + this.data[o + 1] * ia,
            );
            this.data[o + 2] = Math.round(
              tex.data[to + 2] * (color[2] / 255) * a + this.data[o + 2] * ia,
            );
            this.data[o + 3] = Math.min(
              255,
              Math.round(
                tex.data[to + 3] * (color[3] / 255) + this.data[o + 3] * ia,
              ),
            );
          } else {
            this.data[o] = color[0];
            this.data[o + 1] = color[1];
            this.data[o + 2] = color[2];
            this.data[o + 3] = color[3];
          }
        }
      }
    }
  }
}

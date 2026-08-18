// 软件光栅化器（测试/缩略图/无 GPU 兜底）：RGBA 缓冲 + 三角形填充 + UV 采样
export interface Tex2D { width: number; height: number; data: Uint8Array; } // RGBA
export interface Tri2D { a: [number, number]; b: [number, number]; c: [number, number]; uv: [[number, number], [number, number], [number, number]]; tex: Tex2D | null; color: [number, number, number, number]; }

export class SoftwareCanvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array; // RGBA

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  clear(rgba: [number, number, number, number] = [0, 0, 0, 255]): void {
    for (let i = 0; i < this.width * this.height; i++) {
      this.data[i * 4] = rgba[0]; this.data[i * 4 + 1] = rgba[1]; this.data[i * 4 + 2] = rgba[2]; this.data[i * 4 + 3] = rgba[3];
    }
  }

  // 边函数重心坐标光栅化
  drawTri(t: Tri2D): void {
    const [ax, ay] = t.a, [bx, by] = t.b, [cx, cy] = t.c;
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
          const u = w0 / area2, v = w1 / area2, w = w2 / area2;
          const o = (y * this.width + x) * 4;
          if (t.tex) {
            const tu = t.uv[0][0] * u + t.uv[1][0] * v + t.uv[2][0] * w;
            const tv = t.uv[0][1] * u + t.uv[1][1] * v + t.uv[2][1] * w;
            const px = Math.min(t.tex.width - 1, Math.max(0, Math.floor(tu * t.tex.width)));
            const py = Math.min(t.tex.height - 1, Math.max(0, Math.floor(tv * t.tex.height)));
            const to = (py * t.tex.width + px) * 4;
            const a = (t.tex.data[to + 3] / 255) * (t.color[3] / 255);
            const ia = 1 - a;
            this.data[o] = Math.round(t.tex.data[to] * a + this.data[o] * ia);
            this.data[o + 1] = Math.round(t.tex.data[to + 1] * a + this.data[o + 1] * ia);
            this.data[o + 2] = Math.round(t.tex.data[to + 2] * a + this.data[o + 2] * ia);
            this.data[o + 3] = Math.min(255, Math.round((t.tex.data[to + 3] / 255) * 255 + this.data[o + 3] * ia));
          } else {
            this.data[o] = t.color[0]; this.data[o + 1] = t.color[1]; this.data[o + 2] = t.color[2]; this.data[o + 3] = t.color[3];
          }
        }
      }
    }
  }

  pixel(x: number, y: number): [number, number, number, number] {
    const o = (y * this.width + x) * 4;
    return [this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3]];
  }

  // 非零像素统计（测试断言用）
  countNonTransparent(): number {
    let n = 0;
    for (let i = 0; i < this.width * this.height; i++) if (this.data[i * 4 + 3] > 0) n++;
    return n;
  }
}

function edge(x0: number, y0: number, x1: number, y1: number, x: number, y: number): number {
  return (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
}

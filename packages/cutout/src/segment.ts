// segment.ts —— 平坦色候选选区（半自动档的确定性兜底；SPEC §9.2 模式C 候选选区）
// 平坦色插画：按 RGB 色距聚簇 + 4 邻接 BFS 连通域；面积 < minArea 的碎片视为噪点过滤。
import type { CandidateRegion, RgbaImage } from "./types.ts";

export interface ColorKeyOptions {
  /** 同色容差（每通道最大差；缺省 12） */
  tol?: number;
  /** 最小区域面积（px²，更小视为碎片过滤；缺省 40） */
  minArea?: number;
  /** 背景色（缺省=图像边缘多数颜色） */
  background?: [number, number, number];
}

export interface Region {
  id: string;
  color: [number, number, number];
  pixels: number;
  bbox: { x: number; y: number; width: number; height: number };
  mask: Uint8Array;
}

function colorClose(col: [number, number, number], o: number, data: Uint8Array, tol: number): boolean {
  return (
    Math.abs(col[0] - data[o]!) <= tol &&
    Math.abs(col[1] - data[o + 1]!) <= tol &&
    Math.abs(col[2] - data[o + 2]!) <= tol
  );
}

/** 检测背景色：保守的角点法——四角（≥3）同色才视为背景（透明角排除）。
 * 平滑色块场景（白底）四角同白 → 判背景；角色触边/透明底 → 四角不同或透明 → 不误判背景。
 */
export function detectBackground(image: RgbaImage): [number, number, number] | null {
  const corner = (x: number, y: number): [number, number, number] | null => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    const o = (y * image.width + x) * 4;
    if (image.data[o + 3] < 128) return null;
    return [image.data[o]!, image.data[o + 1]!, image.data[o + 2]!];
  };
  const corners = [
    corner(0, 0), corner(image.width - 1, 0),
    corner(0, image.height - 1), corner(image.width - 1, image.height - 1),
  ];
  const seen = new Map<string, number>();
  for (const c of corners) {
    if (!c) continue;
    const k = c[0] + "," + c[1] + "," + c[2];
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, v] of seen) if (v > bestN) { best = k; bestN = v; }
  if (best !== null && bestN >= 3) {
    return best.split(",").map((n) => Number(n)) as [number, number, number];
  }
  return null;
}

/** 平坦色连通域候选选区（只处理 alpha ≥ 128 的像素）。 */
export function colorKeyRegions(image: RgbaImage, opts: ColorKeyOptions = {}): Region[] {
  const tol = opts.tol ?? 12;
  const minArea = opts.minArea ?? 40;
  const W = image.width;
  const H = image.height;
  const visited = new Uint8Array(W * H);
  const bg = opts.background ?? detectBackground(image);
  const regions: Region[] = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (visited[idx] !== 0) continue;
      const o = idx * 4;
      if (image.data[o + 3]! < 128) { visited[idx] = 1; continue; }
      const col: [number, number, number] = [image.data[o]!, image.data[o + 1]!, image.data[o + 2]!];
      if (bg && colorClose(bg, o, image.data, tol)) { visited[idx] = 1; continue; }

      const mask = new Uint8Array(W * H);
      const stack: number[] = [idx];
      visited[idx] = 1;
      mask[idx] = 1;
      let count = 0;
      let minX = x, maxX = x, minY = y, maxY = y;
      while (stack.length > 0) {
        const p = stack.pop()!;
        const px = p % W;
        const py = (p - px) / W;
        count++;
        const nbs = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
        for (const [nx, ny] of nbs) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (visited[ni] !== 0) continue;
          const no = ni * 4;
          if (image.data[no + 3]! < 128) { visited[ni] = 1; continue; }
          if (colorClose(col, no, image.data, tol * 1.6)) {
            visited[ni] = 1;
            mask[ni] = 1;
            stack.push(ni);
            if (nx < minX) minX = nx;
            if (nx > maxX) maxX = nx;
            if (ny < minY) minY = ny;
            if (ny > maxY) maxY = ny;
          } else {
            visited[ni] = 1;
          }
        }
      }
      if (count >= minArea) {
        regions.push({
          id: "r" + (regions.length + 1),
          color: col,
          pixels: count,
          bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
          mask,
        });
      }
    }
  }
  return regions;
}

/** Region → CandidateRegion（切图器/标注器统一入口） */
export function toCandidates(regions: Region[]): CandidateRegion[] {
  return regions.map((r) => ({
    id: r.id,
    bbox: r.bbox,
    mask: r.mask,
    color: r.color,
    pixels: r.pixels,
    confidence: Math.min(1, r.pixels / 400),
  }));
}

/** 平坦色分割器（确定性 Segmenter 实现；宿主可换成 U2Net/SAM2 等注入）。 */
export class ColorKeySegmenter {
  readonly name = "color-key";
  private readonly opts: ColorKeyOptions;
  constructor(opts: ColorKeyOptions = {}) {
    this.opts = opts;
  }
  segment(image: RgbaImage): Promise<CandidateRegion[]> {
    return Promise.resolve(toCandidates(colorKeyRegions(image, this.opts)));
  }
}

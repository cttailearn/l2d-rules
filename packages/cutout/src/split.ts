// split.ts —— 按 mask 拆出部件图（裁剪为内容 bbox 的 RGBA PNG data URI）
import { encodePng, pngToDataUri } from "./png.ts";
import type { RgbaImage } from "./types.ts";
import type { CutoutPart } from "./types.ts";

/** 部件掩码输入（任意来源：ColorKey / U2Net / 手动） */
export interface MaskShape {
  mask: Uint8Array;
  pixels?: number;
  color?: [number, number, number];
}

export interface MaskedPart {
  region: MaskShape;
  semantic: string;
  side?: "left" | "right";
}

/** 掩码内容 bbox（原图空间） */
export function maskBBox(mask: Uint8Array, width: number, height: number): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function cropWithAlpha(image: RgbaImage, bbox: { x: number; y: number; width: number; height: number }, mask: Uint8Array): Uint8Array {
  const w = Math.max(1, bbox.width);
  const h = Math.max(1, bbox.height);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = bbox.y + y;
    for (let x = 0; x < w; x++) {
      const sx = bbox.x + x;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      const src = (sy * image.width + sx) * 4;
      const dst = (y * w + x) * 4;
      const m = mask[sy * image.width + sx] !== 0 ? 1 : 0;
      out[dst] = image.data[src]!;
      out[dst + 1] = image.data[src + 1]!;
      out[dst + 2] = image.data[src + 2]!;
      out[dst + 3] = Math.round((image.data[src + 3]! * m));
    }
  }
  return out;
}

/** 由已标注部件（region + semantic）切出 CutoutPart。 */
export function cutoutMasked(image: RgbaImage, parts: MaskedPart[]): CutoutPart[] {
  return parts.map((p, i) => {
    const bbox = maskBBox(p.region.mask, image.width, image.height);
    const crop = cropWithAlpha(image, bbox, p.region.mask);
    const dataUri = pngToDataUri(encodePng(bbox.width, bbox.height, crop));
    return {
      id: p.semantic + (p.side === "right" ? "-r" : "") + (i > 0 ? "-" + i : ""),
      semantic: p.semantic,
      side: p.side,
      image: { dataUri },
      bbox,
      confidence: (p.region.pixels ?? 0) > 0 ? Math.min(1, (p.region.pixels ?? 0) / 400) : 0.5,
      maskArea: countMask(p.region.mask),
    } as CutoutPart;
  });
}

function countMask(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) n++;
  return n;
}

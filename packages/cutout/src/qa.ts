// qa.ts —— 切图质检（SPEC §9.2：总覆盖率 / 重叠区；§7.3 输出契约）
// 覆盖率 = 部件掩码并集覆盖的非透明输入像素 / 输入非透明像素；重叠率 = 被 ≥2 部件覆盖的像素 / 输入非透明像素。
import { decodePng, dataUriToBytes } from "./png.ts";
import type { CutoutPart, RgbaImage } from "./types.ts";

export interface CutoutQa {
  coveragePct: number;
  overlapPct: number;
  issues: string[];
}

/** 从部件图 data URI 精确重投影掩码（用本包的 PNG 解码，避免把 PNG 字节当裸 RGBA）。 */
function partMask(p: CutoutPart): { w: number; h: number; a: Uint8Array } | null {
  try {
    const dec = decodePng(dataUriToBytes(p.image.dataUri));
    const a = new Uint8Array(dec.width * dec.height);
    for (let i = 0; i < a.length; i++) a[i] = dec.data[i * 4 + 3]! >= 128 ? 1 : 0;
    return { w: dec.width, h: dec.height, a };
  } catch {
    return null;
  }
}

export function analyzeCutout(image: RgbaImage, parts: CutoutPart[]): CutoutQa {
  if (parts.length === 0) {
    return { coveragePct: 0, overlapPct: 0, issues: ["无部件产出"] };
  }
  const W = image.width;
  const H = image.height;
  const size = W * H;
  const cover = new Uint8Array(size);
  const multi = new Uint8Array(size);
  let inputOpaque = 0;
  for (let i = 0; i < size; i++) if (image.data[i * 4 + 3]! >= 128) inputOpaque++;
  if (inputOpaque === 0) return { coveragePct: 0, overlapPct: 0, issues: ["输入全透明"] };
  for (const p of parts) {
    const dec = partMask(p);
    if (!dec) continue;
    for (let y = 0; y < dec.h; y++) {
      const sy = p.bbox.y + y;
      if (sy < 0 || sy >= H) continue;
      for (let x = 0; x < dec.w; x++) {
        const sx = p.bbox.x + x;
        if (sx < 0 || sx >= W) continue;
        if (dec.a[y * dec.w + x] === 0) continue;
        const idx = sy * W + sx;
        if (cover[idx] === 0) cover[idx] = 1;
        else multi[idx] = 1;
      }
    }
  }
  let covered = 0, over = 0;
  for (let i = 0; i < size; i++) { if (cover[i] !== 0) covered++; if (multi[i] !== 0) over++; }
  const coveragePct = (covered / inputOpaque) * 100;
  const overlapPct = (over / inputOpaque) * 100;
  const issues: string[] = [];
  if (coveragePct < 98) issues.push("总覆盖率 " + coveragePct.toFixed(1) + "% < 98%（缺漏部件或空隙）");
  if (overlapPct > 2) issues.push("重叠区 " + overlapPct.toFixed(1) + "% > 2%（多层叠放过多）");
  return { coveragePct, overlapPct, issues };
}

/** 汇总 CutoutResult（合入 QA） */
export function finalizeCutout(image: RgbaImage, parts: CutoutPart[]): { canvas: { width: number; height: number }; parts: CutoutPart[]; issues: string[]; coveragePct: number; overlapPct: number } {
  const qa = analyzeCutout(image, parts);
  return {
    canvas: { width: image.width, height: image.height },
    parts,
    issues: qa.issues,
    coveragePct: Math.round(qa.coveragePct * 10) / 10,
    overlapPct: Math.round(qa.overlapPct * 10) / 10,
  };
}

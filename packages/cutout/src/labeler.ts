// labeler.ts —— 语义标注器（LLM 钩子 + 确定性兜底）
// PositionLabeler：模板槽（区域→语义，SPEC §9.3 模板槽思路）按 IoU 分配；ColorMapLabeler：色彩→语义（素材色板规范）。
import type { CandidateRegion, CutoutPart, Labeler, RgbaImage } from "./types.ts";
import { cutoutMasked, type MaskedPart } from "./split.ts";

export interface Slot {
  semantic: string;
  side?: "left" | "right";
  region: { x: number; y: number; width: number; height: number };
}

function intersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ix * iy;
}
function area(r: { width: number; height: number }): number {
  return Math.max(1, r.width * r.height);
}

/** 模板槽标注：候选按 IoU 最大槽归属；无命中槽 → 丢弃。确定性。 */
export class PositionLabeler implements Labeler {
  readonly name = "position";
  private readonly slots: Slot[];
  constructor(slots: Slot[]) {
    this.slots = slots;
  }
  async label(candidates: CandidateRegion[], image: RgbaImage): Promise<CutoutPart[]> {
    const masked: MaskedPart[] = [];
    for (const c of candidates) {
      if (!c.mask) continue;
      let best: Slot | null = null;
      let bestIoU = -1;
      for (const s of this.slots) {
        const inter = intersect(s.region, c.bbox);
        const union = area(s.region) + area(c.bbox) - inter;
        const iou = inter / union;
        if (iou > bestIoU) { bestIoU = iou; best = s; }
      }
      if (best && bestIoU >= 0.05) {
        masked.push({ region: { mask: c.mask, pixels: c.pixels }, semantic: best.semantic, side: best.side });
      }
    }
    return cutoutMasked(image, masked);
  }
}

/** 色彩标注（平坦色素材色板规范）：候选主色 → 语义。确定性。 */
export class ColorMapLabeler implements Labeler {
  readonly name = "colormap";
  private readonly map: Map<number, { semantic: string; side?: "left" | "right" }>;
  constructor(mapping: { color: [number, number, number]; semantic: string; side?: "left" | "right" }[]) {
    this.map = new Map();
    for (const m of mapping) this.map.set(rgbKey(m.color[0], m.color[1], m.color[2]), { semantic: m.semantic, side: m.side });
  }
  async label(candidates: CandidateRegion[], image: RgbaImage): Promise<CutoutPart[]> {
    const masked: MaskedPart[] = [];
    for (const c of candidates) {
      if (!c.mask || !c.color) continue;
      const hit = this.map.get(rgbKey(c.color[0], c.color[1], c.color[2]));
      if (hit) masked.push({ region: { mask: c.mask, pixels: c.pixels, color: c.color }, semantic: hit.semantic, side: hit.side });
    }
    return cutoutMasked(image, masked);
  }
}

function rgbKey(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

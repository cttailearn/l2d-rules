// @l2dp/cutout —— 半自动切图类型（P4b；SPEC-v2.0 §9.1-9.2 的 SDK 侧落地）
// 仅可擦除语法（无 enum/namespace）。
export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA 8bit/通道；行长 width*4 */
  data: Uint8Array;
}

/** 候选选区（分割器输出；可带 mask 或 bbox，或两者） */
export interface CandidateRegion {
  id: string;
  /** 掩码（可选；0/1，行长 width） */
  mask?: Uint8Array;
  /** 包围盒（像素；与 mask 内容一致时给出） */
  bbox: { x: number; y: number; width: number; height: number };
  /** 主色（可选，平坦色分割用） */
  color?: [number, number, number];
  /** 像素数（可选） */
  pixels?: number;
  confidence: number;
}

/** 部件产物（按 mask 拆出的裁剪图 + 语义 + 质检） */
export interface CutoutPart {
  id: string;
  semantic: string;
  /** 左右（眼/眉等双侧语义；@l2dp/rig PartSpec.side） */
  side?: "left" | "right";
  /** 裁剪后的 RGBA 部件图（data URI，直接内嵌 .l2dm atlas） */
  image: { dataUri: string };
  /** 内容 bbox（画布像素）——@l2dp/rig 的 PartSpec.bbox 来源 */
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  maskArea: number;
}

export interface CutoutResult {
  canvas: { width: number; height: number };
  parts: CutoutPart[];
  issues: string[];
  coveragePct: number;
  overlapPct: number;
}

/** 分割器（宿主可注入 ML/手动）：U2Net/SAM2/ComfyUI REST/手动点选——SDK 提供 ColorKeySegmenter 兜底，零平台依赖。 */
export interface Segmenter {
  segment(image: RgbaImage): Promise<CandidateRegion[]>;
  /** 供 UI/LLM 展示的名称 */
  readonly name: string;
}

/** 语义标注器（LLM 钩子）：把候选选区映射为语义部件。SDK 提供确定性 PositionLabeler/ColorMapLabeler。 */
export interface Labeler {
  label(candidates: CandidateRegion[], image: RgbaImage): Promise<CutoutPart[]>;
  readonly name: string;
}

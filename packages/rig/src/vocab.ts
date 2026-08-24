// vocab.ts —— 语义部件模板表（绘制顺序先验 / 颜色 / 网格分辨率 / 头簇成员）
// 语义类对齐 specs/parts-naming.json（bodyParts），是本包唯一词表来源。
import type { RigSemantic } from "./types.ts";

export interface RigTemplate {
  semantic: RigSemantic;
  zh: string;
  /** 绘制顺序先验（小=先画=靠后）；部件最终 order = 先验×10 + 出现序号 */
  order: number;
  /** 是否属于头簇（随头转向/头点头一起动） */
  headCluster: boolean;
  /** 缺省纯色（RGBA 0..1） */
  color: [number, number, number, number];
  /** 模板网格分辨率 [cols, rows]（形变合成按行列分区） */
  grid: [number, number];
}

export const RIG_TEMPLATES: Record<RigSemantic, RigTemplate> = {
  hair_back:  { semantic: "hair_back",  zh: "后发", order: 0,  headCluster: true,  color: [0.24, 0.22, 0.34, 1], grid: [3, 4] },
  neck:       { semantic: "neck",       zh: "颈",   order: 1,  headCluster: true,  color: [1.0, 0.82, 0.72, 1], grid: [2, 2] },
  ear:        { semantic: "ear",        zh: "耳",   order: 2,  headCluster: true,  color: [1.0, 0.82, 0.72, 1], grid: [2, 2] },
  body_upper: { semantic: "body_upper", zh: "上躯", order: 3,  headCluster: false, color: [0.42, 0.56, 0.75, 1], grid: [5, 4] },
  hair_side:  { semantic: "hair_side",  zh: "侧发", order: 4,  headCluster: true,  color: [0.44, 0.42, 0.56, 1], grid: [2, 4] },
  face:       { semantic: "face",       zh: "脸",   order: 5,  headCluster: true,  color: [1.0, 0.85, 0.75, 1], grid: [6, 6] },
  nose:       { semantic: "nose",       zh: "鼻",   order: 6,  headCluster: true,  color: [1.0, 0.8, 0.7, 1],   grid: [2, 2] },
  mouth:      { semantic: "mouth",      zh: "口",   order: 7,  headCluster: true,  color: [0.62, 0.14, 0.2, 1], grid: [3, 4] },
  eyeball:    { semantic: "eyeball",    zh: "目玉", order: 8,  headCluster: true,  color: [1, 1, 1, 1],         grid: [2, 2] },
  eye:        { semantic: "eye",        zh: "目",   order: 9,  headCluster: true,  color: [0.99, 0.78, 0.66, 1], grid: [4, 3] },
  brow:       { semantic: "brow",       zh: "眉",   order: 10, headCluster: true,  color: [0.3, 0.28, 0.36, 1],  grid: [3, 2] },
  hair_front: { semantic: "hair_front", zh: "前发", order: 11, headCluster: true,  color: [0.5, 0.48, 0.62, 1],  grid: [5, 3] },
};

/** 头簇语义（随头转向/头点头联动） */
export function headClusterSemantics(): RigSemantic[] {
  return (Object.values(RIG_TEMPLATES) as RigTemplate[])
    .filter((t) => t.headCluster)
    .map((t) => t.semantic);
}

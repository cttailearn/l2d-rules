// vocab.ts —— 语义部件模板表（绘制顺序先验 / 颜色 / 网格分辨率 / 头簇成员）
// 语义类对齐 specs/parts-naming.json（bodyParts），是本包唯一词表来源。
import type { RigClothingSemantic, RigSemantic } from "./types.ts";

export type RigTemplateSemantic = RigSemantic | RigClothingSemantic;

export interface RigTemplate {
  semantic: RigTemplateSemantic;
  zh: string;
  /** 绘制顺序先验（小=先画=靠后）；部件最终 order = 先验×10 + 出现序号 */
  order: number;
  /** 是否属于头簇（随头转向/头点头一起动） */
  headCluster: boolean;
  /** 服装部件（B-3）：随服装组可见性参数显隐 */
  clothing?: boolean;
  /** 缺省纯色（RGBA 0..1） */
  color: [number, number, number, number];
  /** 模板网格分辨率 [cols, rows]（形变合成按行列分区） */
  grid: [number, number];
}

export const RIG_TEMPLATES: Record<RigTemplateSemantic, RigTemplate> = {
  // ---- 身体层（20 语义，对齐 specs/parts-naming.json bodyParts）----
  hair_back:  { semantic: "hair_back",  zh: "后发", order: 0,  headCluster: true,  color: [0.24, 0.22, 0.34, 1], grid: [3, 4] },
  neck:       { semantic: "neck",       zh: "颈",   order: 1,  headCluster: true,  color: [1.0, 0.82, 0.72, 1], grid: [2, 2] },
  ear:        { semantic: "ear",        zh: "耳",   order: 2,  headCluster: true,  color: [1.0, 0.82, 0.72, 1], grid: [2, 2] },
  hoho:       { semantic: "hoho",       zh: "颊",   order: 3,  headCluster: true,  color: [0.95, 0.75, 0.7, 1], grid: [2, 2] },
  body_upper: { semantic: "body_upper", zh: "上躯", order: 4,  headCluster: false, color: [0.42, 0.56, 0.75, 1], grid: [5, 4] },
  hair_side:  { semantic: "hair_side",  zh: "侧发", order: 5,  headCluster: true,  color: [0.44, 0.42, 0.56, 1], grid: [2, 4] },
  face:       { semantic: "face",       zh: "脸",   order: 6,  headCluster: true,  color: [1.0, 0.85, 0.75, 1], grid: [6, 6] },
  nose:       { semantic: "nose",       zh: "鼻",   order: 7,  headCluster: true,  color: [1.0, 0.8, 0.7, 1],   grid: [2, 2] },
  mouth:      { semantic: "mouth",      zh: "口",   order: 8,  headCluster: true,  color: [0.62, 0.14, 0.2, 1], grid: [3, 4] },
  eyeball:    { semantic: "eyeball",    zh: "目玉", order: 9,  headCluster: true,  color: [1, 1, 1, 1],         grid: [2, 2] },
  eye:        { semantic: "eye",        zh: "目",   order: 10, headCluster: true,  color: [0.99, 0.78, 0.66, 1], grid: [4, 3] },
  brow:       { semantic: "brow",       zh: "眉",   order: 11, headCluster: true,  color: [0.3, 0.28, 0.36, 1],  grid: [3, 2] },
  hair_front: { semantic: "hair_front", zh: "前发", order: 12, headCluster: true,  color: [0.5, 0.48, 0.62, 1],  grid: [5, 3] },
  body_lower: { semantic: "body_lower", zh: "下躯", order: 13, headCluster: false, color: [0.32, 0.44, 0.62, 1], grid: [4, 5] },
  adult_breast: { semantic: "adult_breast", zh: "胸", order: 14, headCluster: false, color: [0.95, 0.8, 0.85, 1], grid: [3, 3] },
  arm_a:      { semantic: "arm_a",      zh: "臂A",  order: 15, headCluster: false, color: [1.0, 0.85, 0.78, 1], grid: [2, 5] },
  arm_b:      { semantic: "arm_b",      zh: "臂B",  order: 16, headCluster: false, color: [1.0, 0.82, 0.75, 1], grid: [2, 5] },
  adult_genital: { semantic: "adult_genital", zh: "阴部（分级）", order: 17, headCluster: false, color: [0.9, 0.75, 0.8, 1], grid: [2, 2] },
  leg:        { semantic: "leg",        zh: "腿",   order: 18, headCluster: false, color: [0.96, 0.84, 0.8, 1], grid: [2, 6] },
  feet:       { semantic: "feet",       zh: "足",   order: 19, headCluster: false, color: [0.9, 0.8, 0.78, 1],  grid: [2, 2] },
  // ---- 非标准部位（B-4｜demo.l2dm 实证路径：尾巴/兽耳/翅膀，任意语义参数）----
  tail:       { semantic: "tail",       zh: "尾巴", order: 20, headCluster: false, color: [0.55, 0.45, 0.68, 1], grid: [2, 6] },
  ear_beast:  { semantic: "ear_beast",  zh: "兽耳", order: 21, headCluster: true,  color: [0.6, 0.5, 0.7, 1],   grid: [3, 4] },
  wing:       { semantic: "wing",       zh: "翅膀", order: 22, headCluster: false, color: [0.8, 0.75, 0.9, 1],  grid: [3, 5] },
  // ---- 服装层（B-3：对齐 specs/parts-naming.json clothingPartTemplates；随服装组显隐）----
  hairstyle:      { semantic: "hairstyle",      zh: "发型配件", order: 23, headCluster: true,  clothing: true, color: [0.66, 0.6, 0.78, 1], grid: [4, 3] },
  outfit_dress:   { semantic: "outfit_dress",   zh: "连衣裙",   order: 24, headCluster: false, clothing: true, color: [0.8, 0.5, 0.62, 1], grid: [5, 5] },
  outfit_top:     { semantic: "outfit_top",     zh: "上衣",     order: 25, headCluster: false, clothing: true, color: [0.72, 0.62, 0.85, 1], grid: [5, 4] },
  outfit_bottom:  { semantic: "outfit_bottom",  zh: "下身",     order: 26, headCluster: false, clothing: true, color: [0.45, 0.45, 0.66, 1], grid: [4, 4] },
  outfit_underwear: { semantic: "outfit_underwear", zh: "内衣", order: 27, headCluster: false, clothing: true, color: [0.85, 0.78, 0.9, 1], grid: [3, 3] },
  outfit_shoes:   { semantic: "outfit_shoes",   zh: "鞋",       order: 28, headCluster: false, clothing: true, color: [0.3, 0.3, 0.4, 1], grid: [2, 3] },
  outfit_socks:   { semantic: "outfit_socks",   zh: "袜",       order: 29, headCluster: false, clothing: true, color: [0.9, 0.9, 0.95, 1], grid: [2, 4] },
  outfit_accessory: { semantic: "outfit_accessory", zh: "饰品", order: 30, headCluster: true, clothing: true, color: [0.95, 0.8, 0.45, 1], grid: [2, 2] },
};

/** 头簇语义（随头转向/头点头联动）：身体层+非标准部位的头簇成员（服装发型配件随头但由服装组显隐，不强制进头簇摆动）。 */
export function headClusterSemantics(): RigTemplateSemantic[] {
  return (Object.values(RIG_TEMPLATES) as RigTemplate[])
    .filter((t) => t.headCluster && t.clothing !== true)
    .map((t) => t.semantic);
}

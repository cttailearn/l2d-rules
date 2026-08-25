// @l2dp/rig —— 半自动绑定类型（P4a；SPEC-v2.0 §9.3 的 SDK 落地）
// 仅可擦除语法（无 enum/namespace），类型注解仅编译期生效。
import type { L2dmModel, L2dmParamGroup } from "@l2dp/engine";
import type { RigTemplateLike } from "./vocab.ts";

/** P4a 支持的语义部件类型（B-1：对齐 specs/parts-naming.json 身体层 20 语义 + B-4：非标准部位 tail/ear_beast/wing） */
export const RIG_SEMANTICS = [
  "hair_back", "hair_side", "hair_front",
  "ear", "neck", "face", "eye", "eyeball", "brow", "mouth", "nose",
  "hoho", "body_upper", "body_lower", "arm_a", "arm_b", "leg", "feet",
  "adult_breast", "adult_genital", "tail", "ear_beast", "wing",
] as const;
export type RigSemantic = (typeof RIG_SEMANTICS)[number];

/** 服装层语义（B-3：对齐 specs/parts-naming.json clothingPartTemplates） */
export const CLOTHING_SEMANTICS = [
  "outfit_top", "outfit_bottom", "outfit_dress",
  "outfit_underwear", "outfit_shoes", "outfit_socks", "outfit_accessory",
  "hairstyle",
] as const;
export type RigClothingSemantic = (typeof CLOTHING_SEMANTICS)[number];

/** 自定义语义 id（B-7：运行时注入；任意字符串均可注册） */
export type CustomSemantic = string & { __customSemantic?: never };

/** 服装部件（B-3）：在 RigPartSpec 基础上带服装组号（Haru 双服装组范式 _001/_002）。 */
export interface RigClothingPartSpec extends RigPartSpec {
  /** 服装组号（>=1；同组部件一起切换）。缺省 1。 */
  costumeGroup?: number;
}

/** 服装组描述（RigSpec 审计用） */
export interface RigCostumeGroup {
  group: number;
  partIds: string[];
}

/** 单个部件输入：部件图 + 语义类 + 画布上的位置（模板网格配准到此 bbox） */
export interface RigPartSpec {
  id: string;
  semantic: RigSemantic | RigClothingSemantic | CustomSemantic;
  /** 画布像素 bbox（可视图；模板网格按此配准展开） */
  bbox: { x: number; y: number; width: number; height: number };
  /** 纯色部件（RGBA 0..1；缺省取模板默认色） */
  color?: [number, number, number, number];
  /** 纹理部件（data URI；内嵌进 .l2dm atlas，键 = 部件 id） */
  image?: { dataUri: string };
  /** 覆盖自动绘制顺序（缺省按语义先验推导） */
  order?: number;
  /** 左右之分（决定绑定 L/R 参数；缺省 "left"） */
  side?: "left" | "right";
  /** 额外自定义参数 */
  customParams?: Record<string, { min?: number; max?: number; def?: number; group?: L2dmParamGroup }>;
}

export interface RigCharacterSpec {
  /** 角色名 → .l2dm id（sanitize） */
  id: string;
  /** 画布（缺省 512×1024） */
  canvas?: { width: number; height: number };
  parts: RigPartSpec[];
  /**
   * 自定义语义模板注入（B-7）：key = 语义 id，值 = 模板（可从 RIG_TEMPLATES 克隆改造）。
   * 运行时合并进查找表（custom 优先），无需改源码即可注册新语义；
   * 隐藏的驱动参数用 drive.id（部件 customParams 声明即自动绑定摆动 warp）。
   */
  customTemplates?: Record<string, RigTemplateLike>;
  /** 头转向枢轴（缺省 = face bbox 底中，无 face 时 = 画布中下部） */
  hinge?: { x: number; y: number };
  /** 是否生成发丝物理摆锤（缺省 true） */
  physics?: boolean;
  /** 是否生成呼吸 deformer（body 部件随呼吸 scale，缺省 true） */
  breathing?: boolean;
}

/** 部件↔参数 的绑定记录（审计/回注 LLM 用） */
export interface RigBinding {
  param: string;
  kind: "warp1d" | "warp2d" | "deformer" | "pendulum-out";
}

export interface RigSpecPart {
  id: string;
  semantic: RigSemantic | RigClothingSemantic | CustomSemantic;
  order: number;
  color?: [number, number, number, number];
  texture?: string;
  bindings: RigBinding[];
  /** 服装组号（服装部件） */
  costumeGroup?: number;
}

export interface RigSpecDeformer {
  id: string;
  parent?: string;
  pivot?: { x: number; y: number };
  bindings: { parameter: string; channel: "rotation" | "scaleX" | "scaleY" | "x" | "y"; from: number; to: number }[];
}

export interface RigSpecPendulum {
  id: string;
  input: string;
  outputParams: string[];
  delay: number;
  acceleration: number;
}

/** 绑定审计（RigSpec）：LLM/人工可回溯，可回注修改后再 rebind。 */
export interface RigSpec {
  character: string;
  canvas: { width: number; height: number };
  hinge: { x: number; y: number } | null;
  parameters: { id: string; min: number; max: number; def?: number; group?: string }[];
  parts: RigSpecPart[];
  deformers: RigSpecDeformer[];
  physics: RigSpecPendulum[] | null;
  pose: { groups: { ids: string[] }[] } | null;
  /** 服装组（B-3）：每个组的部件 id + 对应可见性参数名（衣装组<N>） */
  costumes: { group: number; param: string; partIds: string[] }[];
  /** 成人分级部件（B-6）：默认隐藏，ContentPolicy 决定可用性 */
  adult: { semantic: string; partIds: string[] }[];
  notes: string[];
}

export interface RigResult {
  /** 合法 .l2dm（通过 engine validateL2dmModel） */
  model: L2dmModel;
  /** 绑定审计记录 */
  spec: RigSpec;
  /** 质检报告 */
  report: import("./report.ts").RigReport;
}

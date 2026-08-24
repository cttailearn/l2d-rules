// @l2dp/rig —— 半自动绑定类型（P4a；SPEC-v2.0 §9.3 的 SDK 落地）
// 仅可擦除语法（无 enum/namespace），类型注解仅编译期生效。
import type { L2dmModel, L2dmParamGroup } from "@l2dp/engine";

/** P4a 支持的语义部件类型（对齐 specs/parts-naming.json 身体层子集） */
export const RIG_SEMANTICS = [
  "hair_back", "hair_side", "hair_front",
  "ear", "neck", "face", "eye", "eyeball", "brow", "mouth", "nose",
  "body_upper",
] as const;
export type RigSemantic = (typeof RIG_SEMANTICS)[number];

/** 单个部件输入：部件图 + 语义类 + 画布上的位置（模板网格配准到此 bbox） */
export interface RigPartSpec {
  id: string;
  semantic: RigSemantic;
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
  semantic: RigSemantic;
  order: number;
  color?: [number, number, number, number];
  texture?: string;
  bindings: RigBinding[];
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

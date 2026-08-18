// .l2dm 模型格式类型（v1）—— DEVELOPMENT-SPEC §5.1（开放 schema，单一来源）
// 设计参照 Iki `.iki`（开放、AI 可生成）融合语义层需求：
//   参数即引擎参数（语义名，任意多，无官方 PARAM/PARTS 白名单）；
//   部件可任意多；形变 = 参数插值偏移 keyform 累加。
// 约束：仅可擦除语法（无 enum/namespace），类型注解仅编译期生效。

export const L2DM_FORMAT_VERSION = 1;

export interface L2dmModel {
  formatVersion: 1;
  /** 角色名（= 语义层角色名） */
  id: string;
  canvas: { width: number; height: number };
  /** 可控制参数 = 语义参数（无官方 ID 概念，多部位自由扩展） */
  parameters: L2dmParameter[];
  /** 部件（任意多，无白名单上限）。flat 列表，z-order 渲染 */
  parts: L2dmPart[];
  /** 变换层级（可选的 deformer 树，参照 ayagami deformer 链） */
  deformers?: L2dmDeformer[];
  physics?: L2dmPhysics;
  /** 部件联动（如手臂 A/B） */
  pose?: L2dmPose;
}

export const L2DM_PARAM_GROUPS = [
  "LipSync", "EyeBlink", "Head", "Body", "Physics", // 引擎内置：环境层/口型/物理路由
  "Ambient", "Custom", // Ambient=环境层辖辖；Custom=模型作者扩展
] as const;
export type L2dmParamGroup = (typeof L2DM_PARAM_GROUPS)[number];

export interface L2dmParameter {
  /** 语义名（如 "微笑" / "头转向" / "尾巴摆" / "耳朵动"） */
  id: string;
  min: number;
  max: number;
  def?: number;
  /** 事件组（LipSync/EyeBlink/…）；缺省 = "Custom" */
  group?: L2dmParamGroup;
}

export interface L2dmPart {
  id: string;
  /** 渲染顺序（后绘制者覆盖） */
  order: number;
  /** atlas 文件名；无 = 纯色 */
  texture?: string;
  /** atlas 子矩形（UV 归一化 0..1） */
  uvRect?: { x: number; y: number; width: number; height: number };
  /** 纯色或 tint */
  color?: [number, number, number, number];
  /** 三角形网格（局部 ±0.5 单位空间） */
  mesh?: L2dmMesh;
  /** deformer 引用（层级） */
  parent?: string;
  /** 可见性由参数驱动（可选） */
  opacityParam?: string;
}

export interface L2dmMesh {
  /** [x0,y0, x1,y1, ...] 局部坐标 */
  vertices: number[];
  /** [u0,v0, ...] 0..1 */
  uvs: number[];
  /** 三角形索引，3 的倍数 */
  indices: number[];
  /** 参数→顶点偏移 keyform（§5.4） */
  warps?: L2dmWarp[];
  /** 2D 参数网格（转头核心）。实现注：规则 4 需校验，故由 mesh 承载（参照 Iki applyWarps 的 warp/warp2d 并存） */
  warp2d?: L2dmWarp2D[];
}

export interface L2dmKeyform {
  /** 参数自身范围值（非归一化） */
  value: number;
  /** 与 vertices 同长的 [dx0,dy0,...] 累加偏移 */
  offsets: number[];
}

export interface L2dmWarp {
  /** 驱动参数（语义名） */
  parameter: string;
  /** ≥2，值单调 */
  keyforms: L2dmKeyform[];
}

export interface L2dmWarp2D {
  /** X/Y 轴参数（转头核心） */
  parameters: [string, string];
  valuesX: number[];
  valuesY: number[];
  /** row-major: k(i,j) = j*valuesX.length + i */
  keyforms: L2dmKeyform2D[];
}
export interface L2dmKeyform2D {
  offsets: number[];
}

export interface L2dmDeformer {
  id: string;
  parent?: string;
  pivot?: { x: number; y: number };
  /** 变换可被参数驱动（rotation/scale/translate 的绑定），参照 iki affine + ayagami deformer */
  bindings?: L2dmBinding[];
}

export interface L2dmBinding {
  parameter: string;
  channel: "rotation" | "scaleX" | "scaleY" | "x" | "y";
  /** 参数值区间 → 变换值 */
  from: number;
  to: number;
}

export interface L2dmPhysics {
  pendulums: {
    id: string;
    /** 输入参数（如 头转向） */
    input: string;
    /** 输出参数（如 前发摆/后发摆） */
    outputParams: string[];
    /** 摆锤参数 */
    delay: number;
    acceleration: number;
  }[];
}

export interface L2dmPose {
  /** 联动组 */
  groups: { ids: string[] }[];
}

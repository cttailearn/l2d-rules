// 语言 A DSL AST 类型（v0.1 语法：character / motion / expression；scene 属 P6）
// 约束：仅可擦除语法（无 enum/namespace），类型注解仅编译期生效 —— 对齐 packages/l2dp

export interface SourcePos {
  line: number;
  col: number;
}

export const EASINGS = ["linear", "easeIn", "easeOut", "easeInOut", "easeOutBack"] as const;
export type Easing = (typeof EASINGS)[number];

export const CURVE_KINDS = ["breath", "blink", "wave", "random"] as const;
export type CurveKind = (typeof CURVE_KINDS)[number];

export const EXPR_BLENDS = ["Add", "Multiply", "Overwrite"] as const;
export type ExprBlend = (typeof EXPR_BLENDS)[number];

export const UNITS = ["ms", "s", "deg", "px"] as const;
export type Unit = (typeof UNITS)[number];

/** 标量：数值 + 可选单位。无单位 = 0..1 语义值；deg 用于角度维度。 */
export interface ScalarValue {
  num: number;
  unit?: Unit;
  pos: SourcePos;
}

/** 关键帧：timeMs 为毫秒时间点，value 为语义通道目标值。 */
export interface Frame {
  timeMs: number;
  value: ScalarValue;
  pos: SourcePos;
}

/** 动作曲线轨道：引用角色 manifest 的 sem 语义参数。 */
export interface Track {
  sem: string;
  pos: SourcePos;
  frames: Frame[];
  easing?: Easing;
  curve?: CurveKind; // curve: <func>，与 frames 互斥
  curveOpts?: CurveOpts; // curve 参数化（可选项）
}

/** curve 函数参数化：amplitude/bias 为无单位数值（0..1 语义值标度）；periodMs 时长。 */
export interface CurveOpts {
  amplitude?: number;
  bias?: number;
  periodMs?: number;
}

export interface MotionBlock {
  kind: "motion";
  name: string;
  pos: SourcePos;
  group?: string;
  durationMs?: number;
  loop: boolean;
  tracks: Track[];
}

/** 身体层：部件归组（parts 引用语义部件名，映射在 manifest） */
export interface LayerDef {
  name: string;
  pos: SourcePos;
  parts: string[];
  z?: number;
  physics?: string; // 物理标签（hair/bust/…），P6 参与物理路由
}

/** 骨/变换手柄：层内 pivot（对齐 deformer）；limit 为可选约束（P6 语义细化） */
export interface BoneDef {
  name: string;
  pos: SourcePos;
  layer: string;
  pivot?: { x: number; y: number };
  limit?: { axis?: string; sign?: string; value: number; unit?: Unit };
}

/** 换装位：按服装组号成组切换（对齐 PARTS_<工程>_<名>_<NNN>） */
export interface OutfitDef {
  name: string;
  pos: SourcePos;
  group: number;
}

/** 语义参数：语义名 → 1..n 个官方 PARAM_*（映射区，允许官方 ID） */
export interface SemDef {
  name: string;
  pos: SourcePos;
  min: number;
  max: number;
  unit?: Unit; // 范围单位（无 = 0..1 语义值；deg = 角度）
  params: string[];
}

export interface CharacterBlock {
  kind: "character";
  name: string;
  pos: SourcePos;
  source?: string;
  slot?: string;
  layers: LayerDef[];
  bones: BoneDef[];
  outfits: OutfitDef[];
  sems: SemDef[];
}

export interface SetLine {
  sem: string;
  value: ScalarValue;
  pos: SourcePos;
}

export interface ExpressionBlock {
  kind: "expression";
  name: string;
  pos: SourcePos;
  blend: ExprBlend;
  sets: SetLine[];
}

/** 场景入场角色实例（cast） */
export interface CastDef {
  name: string;
  pos: SourcePos;
  source: string;
  anchor: { x: number; y: number };
  scale?: number;
}

/** 舞台编排场景（多模型/换装/相机目标；布局语义，渲染端 P6 消费） */
export interface SceneBlock {
  kind: "scene";
  name: string;
  pos: SourcePos;
  camera?: { zoom?: number; anchor?: { x: number; y: number } };
  casts: CastDef[];
  bg?: string;
  physics?: boolean;
}

export type Block = CharacterBlock | MotionBlock | ExpressionBlock | SceneBlock;

export interface Doc {
  version: string;
  sourceId: string;
  blocks: Block[];
}

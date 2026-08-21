// moc/format.ts —— Cubism 2.x `.moc` 二进制格式常量与数据结构（自研，零平台依赖）
// 参照：live2d-parser (rust, cubism_v1) 的对象模型 + 真实语料（164 个 .moc）实证。
//
// 已知结构（实证）：
//   - 头部 10 字节：magic "moc"(3) + version(u8) + 固定 6 字节前缀（语料全版本一致，保守跳过）
//   - 数值域大端（i32/f32 BE）；计数/类型 id 用 LEB128 varint
//   - 对象流：type id(varint) + 载荷；顶层依次为 parameters(ObjectData)、parts(ObjectData)、
//     canvas.width(i32 BE)、canvas.height(i32 BE)
//
// 纪律：纯数据层、确定性；DataView/手写 varint（浏览器/Node 一致）。

/** .moc magic（3 字节 + 版本字节 @3） */
export const MOC_MAGIC = "moc";
/** 对象流起点（magic 4 + 固定前缀 6）——语料实测所有版本一致 */
export const MOC_HEADER_SIZE = 8;

/** MocVersion（byte 3）——Cubism 2.x 导出格式代次 */
export const MocVersion = {
  V1_6_INITIAL: 6,
  V1_7_OPACITY: 7,
  V1_8_TEX_OPTION: 8,
  V1_9_AVATAR_PARTS: 9,
  V1_10_SDK2_0: 10,
  V1_11_SDK2_1: 11,
} as const;
export type MocVersionN = (typeof MocVersion)[keyof typeof MocVersion];

/** ObjectData 类型 id（官方 live2d.js G._\$9o / St._\$4b 实证） */
export const MocTypeId = {
  NULL: 0,
  OBJECT_ARRAY: 15,
  INT32_ARRAY_16: 16,
  INT32_ARRAY_25: 25,
  FLOAT64_ARRAY_26: 26,
  FLOAT32_ARRAY_27: 27,
  /** 对象引用：读 int32 → 对象缓存索引 */
  REFERENCE: 33,
  STR_DRAW_50: 50,
  STR_DATA_51: 51,
  STR_NAME_60: 60,
  STR_ID_134: 134,
  CURVED_SURFACE_DEFORMER: 65,
  PIVOT_MANAGER: 66,
  PIVOT: 67,
  ROTATION_DEFORMER: 68,
  AFFINE: 69,
  /** 单 Mesh/Drawable（官方 new $t） */
  MESH_70: 70,
  PARAMETER: 131,
  PART: 133,
} as const;


/** 字符串子类型（String::read 的 varint 分支；0=空串，其余先读长度再读字节） */
export const MocStrType = {
  EMPTY: 0,
  REF: 33, // "REF_<id>"
  DRAW_NAME: 50,
  DATA_NAME: 51,
  UNKNOWN_60: 60,
  UNKNOWN_134: 134,
} as const;

// ---------------- 解析产物（MocData） ----------------

export interface MocCanvas {
  width: number;
  height: number;
}

export interface MocParameter {
  id: string;
  min: number;
  max: number;
  def: number;
}

export interface MocPivot {
  id: string;
  count: number;
  /** f32 数组（官方惯例每组 3 个值） */
  values: number[];
}

export interface MocAffine {
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  reflectX: boolean;
  reflectY: boolean;
}

export interface MocRotationDeformer {
  kind: "rotation";
  id: string;
  targetId: string;
  pivots: MocPivot[];
  affine: MocAffine[];
  opacities: number[];
}

export interface MocCurvedSurfaceDeformer {
  kind: "curved-surface";
  id: string;
  targetId: string;
  row: number;
  col: number;
  pivots: MocPivot[];
  opacities: number[];
}

export type MocDeformer = MocRotationDeformer | MocCurvedSurfaceDeformer;

export interface MocMesh {
  id: string;
  /** 所属部件（target_id） */
  targetId: string;
  /** 基础顶点（xy 交错，point_count*2） */
  points: number[];
  /** 三角形索引（index_array；polygon_count*3 期望） */
  indices: number[];
  /** UV（xy 交错） */
  uv: number[];
  averageDrawOrder: number;
  /** pivot 绘制顺序（多数模型 1 行长 -> 缺省 [1]） */
  drawOrders: number[];
  /** pivot 透明度 */
  opacities: number[];
  /** 裁剪（clip）部件 id */
  clipIds: string[];
  textureId: number;
  pointCount: number;
  polygonCount: number;
  meshFlags: number;
  colorCompositionType: number;
  colorGroupId: number;
  culling: boolean;
}

export interface MocPart {
  id: string;
  flags: number;
  /** 部件挂载的 deformer（RotationDeformer / CurvedSurfaceDeformer / Affine / Pivot...） */
  deformers: MocDeformer[];
  /** 部件挂载的组件（Mesh 等） */
  meshes: MocMesh[];
  /** 嵌套子部件 */
  children: MocPart[];
  /** 可见性 */
  visible: boolean;
  /** 锁定 */
  locked: boolean;
}

export interface MocData {
  format: "l2dp-read-moc";
  version: number;
  /** Cubism2 版本名（V1_6..V1_11） */
  versionName: string;
  canvas: MocCanvas;
  parameters: MocParameter[];
  parts: MocPart[];
  /** 全部 mesh（按部件深度优先展开，供转换层使用） */
  meshes: MocMesh[];
}

export type MocResult = { ok: true; moc: MocData } | { ok: false; error: string };
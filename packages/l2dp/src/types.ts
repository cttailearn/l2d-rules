// .l2dp v0.2 类型定义（规格第 6 章，对齐官方 runtime 结构）
// 仅支持可擦除语法（无 enum/namespace），类型注解仅在编译期生效

export const CATEGORIES = ["body", "clothing"] as const;
export type Category = (typeof CATEGORIES)[number];

export const BLEND_MODES = ["normal", "add", "multiply"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const DIFF_TARGETS = ["texture", "mesh"] as const;
export type DiffTarget = (typeof DIFF_TARGETS)[number];

export const DEFORMER_TYPES = ["warp", "rotation"] as const;
export type DeformerType = (typeof DEFORMER_TYPES)[number];

export const CURVE_TYPES = ["linear", "bezier"] as const;
export type CurveType = (typeof CURVE_TYPES)[number];

export const EXPR_BLENDS = ["Add", "Multiply", "Overwrite"] as const;
export type ExprBlend = (typeof EXPR_BLENDS)[number];

export interface Manifest {
  schemaVersion: number;
  id: string;
  name: string;
  author: string;
  grade: string;
  displayInfo: { width: number; height: number; originX: number; originY: number; pixelsPerUnit: number };
  layout?: { width?: number; height?: number; x?: number; y?: number };
  genFingerprint?: string;
  projectRef?: string;
  fileManifest: {
    textures: string[];
    parts: string;
    meshes: string;
    deformers?: string;
    params: string;
    groups?: string;
    pose?: string;
    hitareas?: string;
    physics?: string;
    motions: string;
    expressions: string;
  };
}

export interface DiffRef {
  id: string;
  target: DiffTarget;
  src: string;
  paramCondition?: { paramId: string; min: number; max: number }[];
}

export interface Part {
  id: string;
  name: string;
  category: Category;
  type: string;
  costumeGroup: number | null;
  parent: string | null;
  visible: boolean;
  drawOrder: number;
  opacity: number;
  blendMode: BlendMode;
  texturePage: number;
  uvBounds: { x: number; y: number; w: number; h: number };
  diffs: DiffRef[];
}

export interface Deformer {
  id: string;
  type: DeformerType;
  target: string; // meshId | partId
  controlPoints: { source: { x: number; y: number }; destination: { x: number; y: number } }[];
  normalization: { paramId: string; min: number; def: number; max: number };
  curve: CurveType;
  curvePoints?: { x: number; y: number }[];
}

export interface Mesh {
  id: string;
  partId: string;
  vertices: { x: number; y: number; u: number; v: number }[];
  triangles: number[];
  weights: { deformerId: string; values: number[] }[];
}

export interface ParamDef {
  id: string;
  name: string;
  standard: boolean;
  min: number;
  max: number;
  defaultValue: number;
}

export interface Groups {
  paramGroups: { target: "Parameter"; name: string; ids: string[] }[];
  partGroups: { name: string; ids: string[] }[];
}

export interface Pose {
  type: "Live2D Pose";
  groups: { id: string; link: string[] }[][];
}

export interface HitArea {
  id: string;
  name: string;
  partIds: string[];
}

export interface Physics {
  meta: {
    settingsCount: number;
    effectiveForces: { gravity: { x: number; y: number }; wind: { x: number; y: number } };
    dictionary: { id: string; name: string }[];
  };
  settings: {
    id: string;
    input: { sourceParamId: string; weight: number; type: "X" | "Angle"; reflect: boolean }[];
    output: { destinationParamId: string; vertexIndex: number; scale: number; weight: number; type: "X" | "Angle"; reflect: boolean }[];
    vertices: { position: { x: number; y: number }; mobility: number; delay: number; acceleration: number; radius: number }[];
    normalization: { position: { min: number; def: number; max: number }; angle: { min: number; def: number; max: number } };
  }[];
}

export interface Motion {
  meta: { duration: number; fps: number; loop: boolean; curveCount?: number; totalSegmentCount?: number; totalPointCount?: number };
  curves: { target: "Parameter"; id: string; segments: number[] }[];
  sound?: string;
}

export interface Expression {
  type: "Live2D Expression";
  parameters: { id: string; value: number; blend: ExprBlend }[];
}

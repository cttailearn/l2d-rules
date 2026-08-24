// 创作 IR v1（P4b）——LLM 结构化产物的"创作侧"契约（与驱动 IR v2 并列）
// 仅可擦除语法。
import type { RigSemantic } from "@l2dp/rig";

export interface CreationPart {
  id: string;
  semantic: RigSemantic;
  side?: "left" | "right";
  bbox: { x: number; y: number; width: number; height: number };
  color?: [number, number, number, number];
  /** 部件图（裁剪 RGBA dataURI；@l2dp/rig PartSpec.image） */
  image?: { dataUri: string };
}

export type MotionKind = "idle" | "blink" | "talk" | "surprise";

export interface MotionParamCurve {
  /** 参数 id */
  param: string;
  /** 关键帧 [t秒, 值][]（线性段；t 递增） */
  keys: [number, number][];
}

export interface CreationMotion {
  name: string;
  kind: MotionKind;
  loop?: boolean;
  durationMs: number;
  curves: MotionParamCurve[];
}

export interface CreationDirective {
  v: 1;
  character: string;
  canvas?: { width: number; height: number };
  parts: CreationPart[];
  hinge?: { x: number; y: number };
  physics?: boolean;
  breathing?: boolean;
  motions?: CreationMotion[];
}

export interface CreationEval {
  issues: { rule: string; message: string }[];
}

export const CREATION_IR_VERSION = 1;

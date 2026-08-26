// 扁平指令 IR v2（Directive Stream）—— DEVELOPMENT-SPEC §6.1
// 仅可擦除语法（无 enum/namespace）。schema.ts（LLM 结构化输出用）M7 由本文件生成。

export const IR_VERSION = 2;

export type Op =
  | "play" | "face" | "set" | "outfit" | "speak" | "blink"
  | "drift" | "look" | "camera" | "action" | "emote" | "wait";

/** 载荷字段全集（校验用：required/forbidden 均从中取） */
export const PAYLOAD_FIELDS = [
  "asset", "expression", "outfit", "text", "sem", "value",
  "speed", "strength", "mix", "weight", "interval", "amplitude", "period",
  "gaze", "ms", "loop", "cover", "emote", "voice", "blend",
  "zoom", "pan",
] as const;
export type PayloadField = (typeof PAYLOAD_FIELDS)[number];

export interface Directive {
  id?: string;
  op: Op;
  /** 角色/槽位；缺省 "main" */
  target?: string;
  /** 绝对 ms | 相对上一条(+N) | 依赖 id 开始(+id，仅离线批量) */
  at?: number | `+${number}` | `+${string}`;
  /** 覆盖时长 */
  dur?: number;
  // ---- op 载荷（扁平，禁止嵌套对象套对象 ≥3 层）----
  asset?: string;
  expression?: string;
  outfit?: string;
  text?: string;
  sem?: string;
  value?: number;
  speed?: number;
  strength?: number;
  mix?: number;
  weight?: number;
  interval?: number;
  amplitude?: number;
  period?: number;
  gaze?: [number, number];
  ms?: number;
  loop?: boolean;
  /** play 覆盖 */
  cover?: Record<string, number>;
  emote?: { valence: number; arousal: number };
  /** face 混合模式 */
  blend?: "Add" | "Multiply" | "Overwrite";
  interrupt?: "target" | "supersede" | "queue";
  /** TTS voice 提示 */
  voice?: string;
  /** camera：缩放（>0），宿主/SceneStage 消费 */
  zoom?: number;
  /** camera：平移目标 [x,y]，宿主/SceneStage 消费 */
  pan?: [number, number];
}

/** 内部解析产物字段（ingestor 注入，非 IR 线字段，不进 schema） */
export interface DirectiveInternal {
  _motion?: MotionLike;
  _expression?: ExpressionLike;
}

export type ResolvedDirective = Directive & DirectiveInternal;

export interface DirectiveStream {
  v: 2;
  target?: string;
  directives: Directive[];
  /** 离线批量标志（缺省 false=流式） */
  offlines?: boolean;
}

// ---- 资产形状（play/face 引用的引擎资产；结构型，与 @l2dp/engine 兼容）----

/** 动作资产（结构型 = engine EngineMotion） */
export interface MotionLike {
  durationMs: number;
  loop: boolean;
  curves: { id: string; segments: number[] }[];
}

/** 表情资产（结构型 = l2dp Expression3 的 parameters） */
export interface ExpressionLike {
  parameters: { id: string; value: number; blend: "Add" | "Multiply" | "Overwrite" }[];
}

// ---- 校验/路由上下文（ingestor 与 validate 共享；结构型，与 CharacterManifest 兼容）----

export interface ManifestLike {
  sems: { name: string; min: number; max: number; group?: string; def?: number }[];
}

export interface AssetIndex {
  motions: { name: string; group?: string }[];
  expressions: { name: string }[];
  behaviors: never[];
}

/** 同步资产表（feedLine 为同步入口；异步 AssetSource 由宿主在 M7 包装） */
export interface AssetStore {
  motions: Map<string, MotionLike>;
  expressions: Map<string, ExpressionLike>;
}

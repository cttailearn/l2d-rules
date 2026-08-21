// @l2dp/convert —— 官方 Live2D 模型 → SDK 语义资产 转换层（自研，绕开 Cubism Core）
//
// 把既有 Live2D 官方资产（model3.json / cdi3.json / physics3.json / pose3.json /
// userdata3.json / motion3.json / exp3.json）解析并转换为 SDK 语义资产：
//   - engine 可加载的 `.l2dm` 骨架（参数面 + 占位网格，Phase 2 由 .moc3 提供真实几何）
//   - driver 可驱动的动作/表情/物理（motion3/exp3 经 engine compat 直接可采样）
//
// 边界（与 ARCHITECTURE 一致）：
//   - 纯数据层：零 fs / 网络依赖，文件内容经 Loader 注入（examples/demo-real 提供 FS loader）
//   - 只做格式转写，不解释纹理位图、不写平台内容策略
//   - 几何/参数范围/绘制顺序在官方 `.moc3` 二进制（Phase 2，见 docs/MOC3-PHASE2-PLAN.md）；
//     Phase 1 产出 .l2dm 骨架，范围用启发式 + paramRanges 覆盖
//
// 版本三件套之一：syntaxVersion（semver）随本包。

/** 转换包 syntaxVersion（semver） */
export const CONVERT_SYNTAX_VERSION = "0.1.0";

// ---------------- 官方格式（宽松只读形状，以真实 Haru 样本为准） ----------------

export interface Model3Json {
  Version: number;
  FileReferences: {
    Moc: string;
    Textures: string[];
    Physics?: string;
    Pose?: string;
    DisplayInfo?: string;
    UserData?: string;
    Expressions?: { Name: string; File: string }[];
    Motions?: Record<string, { File: string; FadeInTime?: number; FadeOutTime?: number; Sound?: string }[]>;
  };
  Groups?: { Target: string; Name: string; Ids: string[] }[];
  HitAreas?: { Id: string; Name: string }[];
  Layout?: Record<string, number>;
}

export interface Cdi3Json {
  Version?: number;
  Parameters?: { Id: string; GroupId?: string; Name?: string }[];
  ParameterGroups?: { Id: string; GroupId?: string; Name?: string }[];
  Parts?: { Id: string; Name?: string }[];
}

export interface Physics3Json {
  Version?: number;
  Meta?: {
    PhysicsSettingCount?: number;
    TotalInputCount?: number;
    TotalOutputCount?: number;
    VertexCount?: number;
    EffectiveForces?: { Gravity?: { X?: number; Y?: number }; Wind?: { X?: number; Y?: number } };
    PhysicsDictionary?: { Id: string; Name?: string }[];
  };
  PhysicsSettings?: Physics3Setting[];
}

export interface Physics3Setting {
  Id?: string;
  Input?: {
    Source?: { Target?: string; Id?: string };
    Weight?: number;
    Type?: string;
    Reflect?: boolean;
  }[];
  Output?: {
    Destination?: { Target?: string; Id?: string };
    VertexIndex?: number;
    Scale?: number;
    Weight?: number;
    Type?: string;
    Reflect?: boolean;
  }[];
  Vertices?: {
    Position?: { X?: number; Y?: number };
    Mobility?: number;
    Delay?: number;
    Acceleration?: number;
    Radius?: number;
  }[];
  Normalization?: { position: [number, number, number]; angle: [number, number, number] } | null;
}

export interface Pose3Json {
  Type?: string;
  Groups?: { Id: string; Link: string[] }[][];
}

export interface UserData3Json {
  Version?: number;
  Meta?: { UserDataCount?: number; TotalUserDataSize?: number };
  UserData?: { Target?: string; Id?: string; Value?: string }[];
}

export interface Motion3Json {
  Version?: number;
  Meta?: { Duration?: number; Fps?: number; Loop?: boolean };
  Curves?: { Target?: string; Id: string; Segments: number[] }[];
}

export interface Exp3Json {
  Type?: string;
  Parameters?: { Id: string; Value?: number; Blend?: "Add" | "Multiply" | "Overwrite" }[];
}

// ---------------- 转换产物（ConvertedBundle） ----------------

export interface ConvertedParam {
  id: string;
  /** cdi3 ParameterGroup id（若有） */
  groupId?: string;
  /** cdi3 显示名（日文/英文，宿主可作 UI 文案） */
  displayName?: string;
  /** 引擎参数组（映射后：EyeBlink/LipSync/Head/Body/Physics/Ambient/Custom） */
  engineGroup: string;
  /** 参数值域：来自 paramRanges 覆盖 → 启发式猜测（真实范围在 .moc3，Phase 2） */
  min: number;
  max: number;
  def?: number;
}

export interface ConvertedPart {
  id: string;
  displayName?: string;
}

export interface ConvertedMotion {
  /** model3 Motions 分组（Idle/TapBody/…） */
  group: string;
  file: string;
  /** 驱动名（= play asset 名，解码后 basename） */
  name: string;
  fadeIn: number;
  fadeOut: number;
  sound?: string;
  /** 引擎动作（engine compat 产物；official motion3 Segments → 直接可采样） */
  motion: { durationMs: number; loop: boolean; curves: { id: string; segments: number[] }[] };
}

export interface ConvertedExpression {
  file: string;
  /** 驱动名（= face asset 名） */
  name: string;
  expression: { parameters: { id: string; value: number; blend: "Add" | "Multiply" | "Overwrite" }[] };
}

export interface ConvertedPhysicsSetting {
  id: string;
  name?: string;
  inputs: { param: string; weight: number; type: "X" | "Y" | "Angle"; reflect: boolean }[];
  outputs: { param: string; scale: number; weight: number; reflect: boolean }[];
  vertices: { x: number; y: number; mobility: number; delay: number; acceleration: number; radius: number }[];
  normalization: { position: [number, number, number]; angle: [number, number, number] } | null;
}

export interface ConvertedBundle {
  format: "l2dp-converted";
  syntaxVersion: string;
  /** 来源模型名（= 角色名） */
  source: string;
  /** model3 Version */
  version: number;
  fileRefs: {
    moc: string;
    /** .moc3 字节大小（Phase 2 解析几何） */
    mocSize: number | null;
    textures: { file: string; size: number }[];
    physics?: string;
    pose?: string;
    displayInfo?: string;
    userData?: string;
  };
  params: ConvertedParam[];
  parts: ConvertedPart[];
  /** model3 Groups（EyeBlink/LipSync 参数组等） */
  groups: { target: string; name: string; ids: string[] }[];
  hitAreas: { id: string; name: string }[];
  layout?: Record<string, number>;
  motions: ConvertedMotion[];
  expressions: ConvertedExpression[];
  physics: { gravity: { x: number; y: number }; wind: { x: number; y: number }; settings: ConvertedPhysicsSetting[] } | null;
  pose: { groups: { ids: string[]; links: Record<string, string[]> }[] } | null;
  userData: { target: string; id: string; value: string }[] | null;
}

// ---------------- 入口契约 ----------------

/** 文件加载器（相对模型目录的 rel 路径 → 原文/字节）。由调用方实现（demo 用 node fs）。 */
export interface FileLoader {
  (relPath: string): Promise<{ text?: string; bytes?: Uint8Array }>;
}

export interface ConvertOptions {
  /** 角色名（写到 bundle.source 与 .l2dm.id） */
  name: string;
  /** 参数值域覆盖（如 moc3 里程碑前想用真实范围） */
  paramRanges?: Record<string, { min: number; max: number; def?: number }>;
}

export interface ConvertResult {
  ok: boolean;
  bundle: ConvertedBundle | null;
  /** 非致命跳过（如单个 motion 无法导入） */
  warnings: string[];
  error?: string;
}

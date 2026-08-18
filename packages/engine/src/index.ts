// @l2dp/engine —— 自研 Live2D 类引擎（DEVELOPMENT-SPEC §5）
// M1(format) + M2(runtime) + M3(render) 完成。后续：player+compat/（M4）
// 目标：不依赖 Live2D Cubism Core、多部位无白名单上限、原生大模型驱动、可无头渲染。

export * from "./format/types.ts";
export * from "./format/validate.ts";
export * from "./format/loader.ts";
export * from "./runtime/parameter-store.ts";
export * from "./runtime/hierarchy.ts";
export * from "./runtime/deform.ts";
export * from "./runtime/random.ts";
export * from "./runtime/physics.ts";
export * from "./render/sink.ts";
export * from "./render/software.ts";
export * from "./render/webgl2.ts";
export * from "./player/motion.ts";
export * from "./player/player.ts";
export * from "./compat/l2dp-import.ts";

/** 引擎包版本（与 spec 硬约束：版本三件套之一，写进产物） */
export const ENGINE_VERSION = "0.1.0";

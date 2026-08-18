// @l2dp/driver —— LLM 驱动核心（DEVELOPMENT-SPEC §6）
// M0 骨架 → M5 完成：扁平 IR + StreamIngestor + LayerStack + EnvironmentLayer + Evaluator。
// 后续：validate/（M6，双模式规则库）→ provider+twohop+tts/（M7）。
// 目标：JSONL 流式驱动（在线逐行/离线整批双模式），融合分工，确定性一等公民。

export const DRIVER_VERSION = "0.1.0";

// ---- IR（§6.1）----
export * from "./ir/types.ts";
// ---- 分层求值（§6.3/6.4）----
export * from "./layers/environment.ts";
export * from "./layers/layer-stack.ts";
export * from "./layers/route.ts";
// ---- 双模式校验（§6.6）----
export * from "./validate/rules.ts";
export * from "./validate/inline.ts";
export * from "./validate/batch.ts";
// ---- 流式（§6.2）----
export * from "./stream/ingestor.ts";
// ---- 求值（§6.5）----
export * from "./eval/evaluator.ts";

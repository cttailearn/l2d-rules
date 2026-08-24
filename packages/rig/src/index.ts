// @l2dp/rig —— 半自动绑定（P4a）：PartSpec → 参数挂接 + warp 合成 + 自动顺序/物理 → 合法 .l2dm + RigSpec + 质检
// 依赖 @l2dp/engine（格式/校验/运行时）与 @l2dp/convert（author.ts 写入面）。
export * from "./types.ts";
export * from "./vocab.ts";
export * from "./params.ts";
export * from "./meshes.ts";
export * from "./warps.ts";
export * from "./report.ts";
export * from "./rig.ts";

export const RIG_VERSION = "0.1.0";

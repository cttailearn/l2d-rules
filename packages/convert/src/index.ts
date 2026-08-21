// @l2dp/convert —— 官方 Live2D 模型 → SDK 语义资产 转换层（自研，绕开 Cubism Core）
//
// Phase 1（本包当前）：JSON 格式链路。
//   convertLive2dModel(model3, loader, opts) → ConvertedBundle
//   toL2dmSkeleton(bundle)                    → 可渲染 .l2dm 骨架（占位几何）
//   parseModel3/Cdi3/…                        → 单格式解析（防御、可测）
// Phase 2（独立里程碑）：.moc3 二进制几何。见 docs/MOC3-PHASE2-PLAN.md。

export * from "./types.ts";
export * from "./parse.ts";
export * from "./map.ts";
export * from "./convert.ts";
export * from "./skeleton.ts";
export * from "./artifact.ts";
export * from "./author.ts";
export * from "./moc3/index.ts";
export * from "./moc/index.ts";

// moc3 —— 官方 .moc3 二进制解析（Phase 2，自研、绕开 Cubism Core）
// 现状（逆向进度，见 docs/MOC3-PHASE2-PLAN.md）：
//   ✅ 容器：头部 / SOT(160) / countInfo(23) / canvas —— 与 py-moc3 参考一致
//   ✅ 分节：~90 typed array 全部按名读出（参数/部件/ArtMesh/形变/关键帧/UV/绘制顺序…）
//   ✅ 生成：moc3ToL2dm() → 真实几何 .l2dm（顶点/UV/真实索引缓冲/绘制顺序/参数范围）
//   ✅ 动画形变：deform.ts 烘焙 keyform（自身 art_mesh keyform + warp 位移场 + 链）→ .l2dm.mesh.warps
//
// 由 @l2dp/convert 消费：解析结果 → .l2dm 真实几何。

export * from "./reader.ts";
export * from "./container.ts";
export * from "./format.ts";
export * from "./moc3.ts";
export * from "./to-l2dm.ts";
export * from "./deformers.ts";
export * from "./deform.ts";

// moc —— Cubism 2.x `.moc` 二进制解析（自研、绕开官方 runtime）
// 现状：
//   ✅ 头部 / 对象流（ObjectData 类型化读 + Mesh 直接字段读）
//   ✅ 参数 / 部件树 / deformer / mesh（顶点/UV/索引/纹理/绘制顺序）
//   ✅ 生成：mocToL2dm() → 基础姿态 .l2dm（真实几何 + 参数范围）
//   ⏳ Cubism2 形变（rotation/curved-surface → 动画 warps）后续里程碑

export * from "./format.ts";
export * from "./reader.ts";
export * from "./to-l2dm.ts";
export * from "./parse2.ts";

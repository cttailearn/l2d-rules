// @l2dp/engine —— 自研 Live2D 类引擎（DEVELOPMENT-SPEC §5）
// M0 骨架：包入口。模块结构按顺序落地：
//   format/（M1）→ runtime/（M2）→ render/（M3）→ player+compat/（M4）
// 目标：不依赖 Live2D Cubism Core、多部位无白名单上限、原生大模型驱动、可无头渲染。

/** 引擎包版本（与 spec 硬约束：版本三件套之一，写进产物） */
export const ENGINE_VERSION = "0.1.0";

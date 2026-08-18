// @l2dp/driver —— LLM 驱动核心（DEVELOPMENT-SPEC §6）
// M0 骨架：包入口。模块结构按顺序落地：
//   ir/（M5）→ stream/（M5）→ layers/（M5）→ eval/（M5）
//   → validate/（M6）→ provider+twohop+tts/（M7）
// 目标：JSONL 流式驱动（在线逐行/离线整批双模式），融合分工，确定性一等公民。

/** 驱动包版本（与 spec 硬约束：版本三件套之一） */
export const DRIVER_VERSION = "0.1.0";

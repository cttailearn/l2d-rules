// 宿主 op 契约（R-P1-3）—— outft/speak/look/camera/action/wait 的路由边界
// 这些 op 不落在 LayerStack/EnvironmentLayer，而由宿主（渲染/换装/TTS/相机）消费。
// SDK 只定义契约（handlers）与"未接线"的显式上报；host 未注入时 feed 仍计入 hostOps 透明暴露。

import type { Directive } from "../ir/types.ts";

/** 宿主路由 op 全集 */
export const HOST_OPS = ["outfit", "speak", "look", "camera", "action", "wait"] as const;
export type HostOp = (typeof HOST_OPS)[number];

/**
 * 宿主 op 处理器（R-P1-3）：宿主按需实现；缺省整套缺省 → 未接线。
 * 每个方法收到已快校验的指令与生效时刻。
 */
export interface HostOpHandler {
  outfit?(d: Directive, tMs: number): void | Promise<void>;
  speak?(d: Directive, tMs: number): void | Promise<void>;
  look?(d: Directive, tMs: number): void | Promise<void>;
  camera?(d: Directive, tMs: number): void | Promise<void>;
  action?(d: Directive, tMs: number): void | Promise<void>;
  wait?(d: Directive, tMs: number): void | Promise<void>;
}

export function isHostOp(op: Directive["op"]): op is HostOp {
  return (HOST_OPS as readonly string[]).includes(op);
}

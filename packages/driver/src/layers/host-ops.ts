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

/** 服装组描述（B-3：与 @l2dp/rig 的 RigSpec.costumes 同形；结构型避免跨包依赖） */
export interface CostumeGroup {
  group: number;
  param: string;
  partIds: string[];
}

/**
 * outfit 换装指令生成（B-3）：把服装组切换编码为 JSONL set 行（只写可见组参数）。
 * 用法：宿主把 `outfitLines(costumes, targetGroup)` 喂给 StreamIngestor.feedLine 逐行生效，
 * 或作为 HostOpHandler.outfit 的默认实现（拿到 d.outfit → 解析组号）。
 */
export function outfitLines(costumes: CostumeGroup[], targetGroup: number): string[] {
  const lines: string[] = [];
  const has = costumes.some((c) => c.group === targetGroup);
  if (!has) return lines;
  for (const c of costumes) {
    const on = c.group === targetGroup ? 1 : 0;
    lines.push(JSON.stringify({ op: "set", sem: c.param, value: on }));
  }
  return lines;
}

/** 从 服装组参数名 解析组号（衣装组2 → 2；失败返回 null）。 */
export function costumeGroupFromParam(param: string): number | null {
  const m = /^衣装组(\d+)$/.exec(param);
  return m ? Number(m[1]) : null;
}

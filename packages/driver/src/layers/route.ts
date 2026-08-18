// 分层路由（§7.4）—— ingestor 与 batch 干跑共享的唯一路由实现
//   play/face/set → LayerStack      emote/blink/drift → EnvironmentLayer
//   outfit/speak/look/camera/action/wait → 宿主消费（M6/M7 接线），此处仅确认

import type { ResolvedDirective } from "../ir/types.ts";
import type { EnvironmentLayer } from "./environment.ts";
import type { LayerStack } from "./layer-stack.ts";

export function routeDirective(
  d: ResolvedDirective,
  startMs: number,
  stack: LayerStack,
  env: EnvironmentLayer,
): void {
  switch (d.op) {
    case "play":
    case "face":
    case "set":
      stack.push(d, startMs);
      return;
    case "emote":
      env.setEmote(d.emote ?? null);
      return;
    case "blink":
      env.feedBlink(d.interval);
      return;
    case "drift":
      env.setDrift(d.sem!, d.amplitude!, d.period!);
      return;
    default:
      return; // 宿主 op（outfit/speak/look/camera/action/wait）
  }
}

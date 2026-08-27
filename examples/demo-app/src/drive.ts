// drive.ts —— 「全功能演示」的纯函数面（无 DOM，可单测）
// 按角色「参数面 + 动作资产 + 服装组」把功能名翻译成 JSONL 指令行；不可用返回 null。
import type { AppCharacter } from "./chars.ts";

/** driveFeature 依赖的宿主最小接口（AppCore 满足） */
export interface DriveHost {
  character: AppCharacter;
  params(): Record<string, number>;
  setOutfit(group: number): string[];
}

export interface FeatureCommand {
  lines: string[];
  label: string;
}

function hasParam(core: DriveHost, id: string): boolean {
  return id in core.params();
}

function hasMotion(core: DriveHost, name: string): boolean {
  const m = core.character.motions;
  return m ? name in m : false;
}

export function setp(sem: string, v: number, waitMs?: number): string[] {
  return waitMs
    ? [
        JSON.stringify({ op: "set", sem, value: v }),
        JSON.stringify({ op: "wait", ms: waitMs }),
        JSON.stringify({ op: "set", sem, value: 0 }),
      ]
    : [JSON.stringify({ op: "set", sem, value: v })];
}

export const FEATURE_LABELS: Record<string, string> = {
  walk: "🚶 行走", outfit1: "👗 换装·组1", outfit2: "🧥 换装·组2", nod: "🙆 点头", shake: "🙅 摇头",
  smile: "😊 微笑", open: "😮 张嘴", blink: "😉 眨眼", surprised: "😲 惊讶", reset: "⟲ 复位",
};

/** 功能名 → JSONL；null = 当前角色缺少对应部件/资产。 */
export function driveFeature(core: DriveHost, feat: string): FeatureCommand | null {
  switch (feat) {
    case "walk":
      if (hasMotion(core, "walk")) return { label: "行走（walk 步态循环）", lines: ['{"op":"play","asset":"walk"}'] };
      if (hasParam(core, "腿摆")) {
        return { label: "行走（腿摆/身摆 步态）", lines: ['{"op":"play","asset":"walk"}', '{"op":"set","sem":"身摆","value":0.3}'] };
      }
      return { label: "无腿摆/臂摆 → 行走不可用", lines: [] };
    case "outfit1":
      return core.character.costumes ? { label: "换装·组1", lines: core.setOutfit(1) } : null;
    case "outfit2":
      return core.character.costumes ? { label: "换装·组2", lines: core.setOutfit(2) } : null;
    case "nod":
      if (hasParam(core, "头点头")) return { label: "头部·点头", lines: setp("头点头", 12, 600) };
      if (hasParam(core, "ParamAngleY")) return { label: "头部·点头", lines: setp("ParamAngleY", 12, 600) };
      return null;
    case "shake":
      if (hasParam(core, "头转向")) return { label: "头部·摇头", lines: setp("头转向", 16, 300) };
      if (hasParam(core, "ParamAngleX")) return { label: "头部·摇头", lines: setp("ParamAngleX", 14, 300) };
      return null;
    case "smile":
      if (core.character.expressions && "开心" in core.character.expressions) {
        return { label: "脸部·微笑（face 开心）", lines: ['{"op":"face","expression":"开心","weight":0.6}'] };
      }
      if (hasParam(core, "ParamMouthForm")) return { label: "脸部·微笑", lines: setp("ParamMouthForm", 1) };
      if (hasParam(core, "嘴笑")) return { label: "脸部·微笑", lines: setp("嘴笑", 1) };
      return null;
    case "open":
      if (hasParam(core, "嘴开")) return { label: "脸部·张嘴", lines: setp("嘴开", 0.8, 500) };
      if (hasParam(core, "ParamMouthOpenY")) return { label: "脸部·张嘴", lines: setp("ParamMouthOpenY", 0.8, 500) };
      return null;
    case "blink":
      if (hasMotion(core, "blink")) return { label: "脸部·眨眼（blink）", lines: ['{"op":"play","asset":"blink"}'] };
      if (hasParam(core, "眼闭左") && hasParam(core, "眼闭右")) {
        return {
          label: "脸部·眨眼",
          lines: [
            JSON.stringify({ op: "set", sem: "眼闭左", value: 1 }),
            JSON.stringify({ op: "set", sem: "眼闭右", value: 1 }),
            JSON.stringify({ op: "wait", ms: 160 }),
            JSON.stringify({ op: "set", sem: "眼闭左", value: 0 }),
            JSON.stringify({ op: "set", sem: "眼闭右", value: 0 }),
          ],
        };
      }
      return null;
    case "surprised":
      if (hasMotion(core, "surprise")) return { label: "脸部·惊讶（surprise）", lines: ['{"op":"play","asset":"surprise"}'] };
      if (hasParam(core, "嘴开") && hasParam(core, "眉左升")) {
        return {
          label: "脸部·惊讶",
          lines: [
            JSON.stringify({ op: "set", sem: "嘴开", value: 0.8 }),
            JSON.stringify({ op: "set", sem: "眉左升", value: 1 }),
            JSON.stringify({ op: "set", sem: "眉右升", value: 1 }),
          ],
        };
      }
      return null;
    case "reset":
      return { label: "复位参数", lines: [] };
    default:
      return null;
  }
}

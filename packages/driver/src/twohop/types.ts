// twohop/types.ts —— 事件 + 行为库索引（第一跳"目录进、IR 出"）—— DEVELOPMENT-SPEC §6.8
// §14.3-2 / P6：同优先级多候选取加权随机（weight + 种子化 RNG），供"资产权重/随机选择"落地。

import { mulberry32, type SeededRandom } from "@l2dp/engine";

/** 事件（宿主/交互触发；双事件源之一） */
export type DriverEvent =
  | { type: "user_text"; text: string }
  | { type: "user_voice"; text?: string }
  | { type: "emote"; valence: number; arousal: number }
  | { type: "idle" }
  | { type: "start" }
  | { type: "end" };

/** 决策上下文（情绪由宿主可观测信号注入，LLM 不主猜——§6.9） */
export interface Context {
  mood?: { valence: number; arousal: number };
  recent?: string[];
  [k: string]: unknown;
}

/** 已登记行为：事件 → 最高优先匹配 → 直接出 JSONL（不进 LLM） */
export interface BehaviorItem {
  id: string;
  /** 触发事件 type 列表（"user_text"/"user_voice"/"emote"/"idle"/...） */
  events: string[];
  /** 行为类别（评估集 op+kinds 断言用） */
  kinds: string[];
  /** 优先级（同事件多候选取高者） */
  priority: number;
  /** 同优先级候选中的采样权重（缺省 1；§14.3-2 资产权重/随机选择） */
  weight?: number;
  /** JSONL 行（字符串或按事件/上下文生成的函数）——"IR 出" */
  lines: (string | ((event: DriverEvent, ctx: Context) => string))[];
  /** 附加匹配条件（可选） */
  match?: (event: DriverEvent, ctx: Context) => boolean;
}

/**
 * 确定性加权随机选择（§14.3-2）：按权重采样一项；权重全为 0/非法时回退最后一项。
 * rng 注入种子化随机源（mulberry32）以保证同序同种子同结果。
 */
export function pickWeighted<T>(items: readonly T[], weightOf: (t: T) => number, rng: () => number): T {
  if (items.length === 0) throw new Error("pickWeighted: 空候选");
  const ws = items.map((t) => {
    const w = weightOf(t);
    return Number.isFinite(w) && w > 0 ? w : 0;
  });
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[items.length - 1]!;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]!;
    if (r < 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/** 行为库索引：登记 → pick（最高优先匹配者，同优先级按 weight 种子加权随机） */
export class BehaviorIndex {
  private readonly items: BehaviorItem[] = [];
  private readonly rng: SeededRandom;

  constructor(seed = 0x9e3779b9) {
    this.rng = mulberry32(seed >>> 0);
  }

  register(b: BehaviorItem): void {
    this.items.push(b);
  }

  /** 最高优先的匹配行为（无匹配返回 null → 第二跳 LLM）；同最高优先级间按 weight 加权随机（种子化确定性）。 */
  pick(event: DriverEvent, ctx: Context): BehaviorItem | null {
    let bestPriority = -Infinity;
    for (const b of this.items) {
      if (!b.events.includes(event.type)) continue;
      if (b.match !== undefined && !b.match(event, ctx)) continue;
      if (b.priority > bestPriority) bestPriority = b.priority;
    }
    if (bestPriority === -Infinity) return null;
    const candidates = this.items.filter((b) => {
      if (b.priority !== bestPriority) return false;
      if (!b.events.includes(event.type)) return false;
      return b.match === undefined || b.match(event, ctx);
    });
    if (candidates.length === 1) return candidates[0]!;
    return pickWeighted(candidates, (b) => b.weight ?? 1, () => this.rng.next());
  }

  list(): BehaviorItem[] {
    return [...this.items];
  }

  /** play 资产 → kinds（评估集 op+kinds 断言：由登记行为的行静态提取） */
  kindsOfAsset(asset: string): string[] {
    const out = new Set<string>();
    for (const b of this.items) {
      for (const line of b.lines) {
        if (typeof line !== "string") continue;
        try {
          const d = JSON.parse(line) as { op?: string; asset?: string };
          if (d.op === "play" && d.asset === asset) {
            for (const k of b.kinds) out.add(k);
          }
        } catch {
          // 非 JSON 行跳过
        }
      }
    }
    return [...out];
  }
}

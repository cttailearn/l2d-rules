// twohop/types.ts —— 事件 + 行为库索引（第一跳"目录进、IR 出"）—— DEVELOPMENT-SPEC §6.8

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
  /** JSONL 行（字符串或按事件/上下文生成的函数）——"IR 出" */
  lines: (string | ((event: DriverEvent, ctx: Context) => string))[];
  /** 附加匹配条件（可选） */
  match?: (event: DriverEvent, ctx: Context) => boolean;
}

/** 行为库索引：登记 → pick（最高优先匹配者） */
export class BehaviorIndex {
  private readonly items: BehaviorItem[] = [];

  register(b: BehaviorItem): void {
    this.items.push(b);
  }

  /** 最高优先的匹配行为（无匹配返回 null → 第二跳 LLM） */
  pick(event: DriverEvent, ctx: Context): BehaviorItem | null {
    let best: BehaviorItem | null = null;
    for (const b of this.items) {
      if (!b.events.includes(event.type)) continue;
      if (b.match !== undefined && !b.match(event, ctx)) continue;
      if (best === null || b.priority > best.priority) best = b;
    }
    return best;
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

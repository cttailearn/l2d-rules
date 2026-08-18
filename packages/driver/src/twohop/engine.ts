// twohop/engine.ts —— 两跳架构（第一跳本地规则 <50ms，第二跳 LLM 异步）—— §6.8 / §9.3
//   dispatch(event)：
//     第一跳（同步）：BehaviorIndex.pick → 命中 → 逐行 feedLine（不进 LLM，<50ms）
//     第二跳（异步）：未命中 → provider.createCompletion → fallback 提取 JSONL → 逐行 feedLine
//   危险动作（自定义重写/非常规覆盖）→ 等待 LLM 慢路径（M7 占位：needsSlowPath 恒 false）
//
//   feed 的行全部记入 audit（评估集 op 断言 + 未来 AuditSink 消费）；坏行由 ingestor 隔离。

import type { StreamIngestor } from "../stream/ingestor.ts";
import type { RuntimeProvider } from "../provider/types.ts";
import { extractJsonLines } from "../provider/fallback.ts";
import { BehaviorIndex, type BehaviorItem, type Context, type DriverEvent } from "./types.ts";

export interface DriverEngineOpts {
  index: BehaviorIndex;
  provider: RuntimeProvider;
  ing: StreamIngestor;
  /** 决策提示词（第二跳）；缺省给最小指令 */
  systemPrompt?: string;
}

export class DriverEngine {
  private readonly index: BehaviorIndex;
  private readonly provider: RuntimeProvider;
  private readonly ing: StreamIngestor;
  private readonly systemPrompt: string;

  /** 已投喂行审计：{ tMs, line }（评估集断言 + AuditSink 消费） */
  readonly audit: { tMs: number; line: string }[] = [];
  /** 第二跳调用计数（测试断言：第一跳命中时不增加） */
  llmCalls = 0;
  private tMs = 0;

  constructor(opts: DriverEngineOpts) {
    this.index = opts.index;
    this.provider = opts.provider;
    this.ing = opts.ing;
    this.systemPrompt = opts.systemPrompt ??
      "你是 Live2D 角色驱动决策器。输出 JSONL 指令行（每行一个完整 JSON），可用的动作资产见上下文。只输出 JSONL，不要解释。";
  }

  /** 帧推进（同步宿主时钟；两跳 feed 的接收时刻由内部 tMs 推进） */
  onFrame(dtMs: number): void {
    this.tMs += Math.max(0, dtMs);
  }

  /** 事件驱动：第一跳同步，第二跳异步（await 仅在需要 LLM 决策时阻塞）。 */
  async dispatch(event: DriverEvent, ctx: Context): Promise<{ hop: 1 | 2; behaviorId?: string; lines: string[] }> {
    // ---- 第一跳：本地规则（<50ms，不进 LLM）----
    const behavior = this.index.pick(event, ctx);
    if (behavior !== null) {
      const lines = this.renderLines(behavior, event, ctx);
      this.feed(lines);
      return { hop: 1, behaviorId: behavior.id, lines };
    }

    // ---- 第二跳：LLM 决策（异步；危险动作慢路径占位：needsSlowPath 恒 false）----
    if (this.needsSlowPath(event, ctx)) {
      // 慢路径（M7 占位）：语义抽查/人工复核落地后在此等待，当前直通
    }
    const result = await this.provider.createCompletion(
      { system: this.systemPrompt, messages: [{ role: "user", content: this.eventToPrompt(event, ctx) }] },
    );
    this.llmCalls += 1;
    const lines = extractJsonLines(result.text);
    this.feed(lines);
    return { hop: 2, lines };
  }

  /** 危险动作判定（M7 占位：自定义重写/非常规覆盖 → 慢路径；当前恒 false） */
  needsSlowPath(_event: DriverEvent, _ctx: Context): boolean {
    return false;
  }

  private renderLines(b: BehaviorItem, event: DriverEvent, ctx: Context): string[] {
    return b.lines.map((l) => (typeof l === "function" ? l(event, ctx) : l));
  }

  private feed(lines: string[]): void {
    for (const line of lines) {
      this.audit.push({ tMs: this.tMs, line });
      this.ing.feedLine(line, this.tMs);
    }
  }

  private eventToPrompt(event: DriverEvent, ctx: Context): string {
    const mood = ctx.mood !== undefined ? ` 情绪: ${JSON.stringify(ctx.mood)}` : "";
    switch (event.type) {
      case "user_text": return `用户说: "${event.text}"。请决策角色动作。${mood}`;
      case "user_voice": return `用户正在说话。请决策倾听姿态。${mood}`;
      case "emote": return `情绪信号: ${JSON.stringify({ valence: event.valence, arousal: event.arousal })}。请决策动作。`;
      default: return `事件: ${event.type}。请决策动作。${mood}`;
    }
  }
}

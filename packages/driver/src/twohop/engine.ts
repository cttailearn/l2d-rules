// twohop/engine.ts —— 两跳架构（第一跳本地规则 <50ms，第二跳 LLM 异步）—— §6.8 / §9.3
//   dispatch(event)：
//     第一跳（同步）：BehaviorIndex.pick → 命中 → 逐行 feedLine（不进 LLM，<50ms）
//     第二跳（异步）：未命中 → provider.createCompletion → fallback 提取 JSONL → 逐行 feedLine
//   危险动作（自定义重写/非常规覆盖）→ 语义抽查慢路径（R-P1-2｜§11.2）：
//     needsSlowPath 命中 → 逐条 spotCheck（宿主注入：LLM 复核或确定性核对）→ 仅投喂通过行，
//     全部被拒 → blocked:true（不增加首跳延迟：复核在第二跳提交后后台进行）。
//
//   feed 的行全部记入 audit（评估集 op 断言 + 未来 AuditSink 消费）；坏行由 ingestor 隔离。

import type { StreamIngestor } from "../stream/ingestor.ts";
import type { RuntimeProvider } from "../provider/types.ts";
import { extractJsonLines } from "../provider/fallback.ts";
import type { DriverClock } from "../clock.ts";
import { BehaviorIndex, type BehaviorItem, type Context, type DriverEvent } from "./types.ts";

export interface DriverEngineOpts {
  index: BehaviorIndex;
  provider: RuntimeProvider;
  ing: StreamIngestor;
  /** 决策提示词（第二跳）；缺省给最小指令 */
  systemPrompt?: string;
  /**
   * 语义抽查（R-P1-2｜§11.2）：入参第二跳产出的指令行，返回通过复核的行
   * （丢弃危险/越界行）。缺省 = 全量放行（等价"无慢路径"）。
   */
  spotCheck?: (lines: string[], event: DriverEvent, ctx: Context) => string[] | Promise<string[]>;
  /**
   * 统一时钟（O-1｜SPEC §5）：事件发生的 wall/audio 时间源。
   * 缺省 = 内部 onFrame 累加 tMs（向后兼容）；注入后 feed/audit 使用 clock.now()，
   * 避免宿主帧时钟与内部 tMs 双时间轴漂移（说话用 audioClock，其余 wallClock）。
   */
  clock?: DriverClock;
}

export class DriverEngine {
  private readonly index: BehaviorIndex;
  private readonly provider: RuntimeProvider;
  private readonly ing: StreamIngestor;
  private readonly systemPrompt: string;
  private readonly spotCheck?: DriverEngineOpts["spotCheck"];

  /** 已投喂行审计：{ tMs, line }（评估集断言 + AuditSink 消费） */
  readonly audit: { tMs: number; line: string }[] = [];
  /** 第二跳调用计数（测试断言：第一跳命中时不增加） */
  llmCalls = 0;
  /** 语义抽查累计拒绝行数（R-P1-2 审计） */
  spotBlocked = 0;
  private tMs = 0;
  private readonly clock?: DriverClock;

  constructor(opts: DriverEngineOpts) {
    this.index = opts.index;
    this.provider = opts.provider;
    this.ing = opts.ing;
    this.spotCheck = opts.spotCheck;
    this.clock = opts.clock;
    this.systemPrompt = opts.systemPrompt ??
      "你是 Live2D 角色驱动决策器。输出 JSONL 指令行（每行一个完整 JSON），可用的动作资产见上下文。只输出 JSONL，不要解释。";
  }

  /** 时间源（O-1）：注入 clock 用 clock.now()，否则回退内部 tMs */
  private now(): number {
    return this.clock !== undefined ? this.clock.now() : this.tMs;
  }

  /** 帧推进（同步宿主时钟；两跳 feed 的接收时刻由内部 tMs 推进） */
  onFrame(dtMs: number): void {
    this.tMs += Math.max(0, dtMs);
  }

  /** 事件驱动：第一跳同步，第二跳异步（await 仅在需要 LLM 决策时阻塞）。 */
  async dispatch(event: DriverEvent, ctx: Context): Promise<{ hop: 1 | 2; behaviorId?: string; lines: string[]; blocked?: boolean; spotChecked?: boolean }> {
    // ---- 第一跳：本地规则（<50ms，不进 LLM）----
    const behavior = this.index.pick(event, ctx);
    if (behavior !== null) {
      const lines = this.renderLines(behavior, event, ctx);
      this.feed(lines);
      return { hop: 1, behaviorId: behavior.id, lines };
    }

    // ---- 第二跳：LLM 决策（异步）----
    const result = await this.provider.createCompletion(
      { system: this.systemPrompt, messages: [{ role: "user", content: this.eventToPrompt(event, ctx) }] },
    );
    this.llmCalls += 1;
    let lines = extractJsonLines(result.text);

    // 危险动作 → 语义抽查慢路径（R-P1-2｜§11.2）：只喂通过复核的行
    let blocked = false;
    if (this.needsSlowPath(event, ctx) && this.spotCheck !== undefined && lines.length > 0) {
      const approved = await this.spotCheck(lines, event, ctx);
      this.spotBlocked += lines.length - approved.length;
      if (approved.length === 0) blocked = true;
      lines = approved;
    }
    if (!blocked) this.feed(lines);
    return { hop: 2, lines, blocked, spotChecked: true };
  }

  /**
   * 危险动作判定（R-P1-2｜§11.2）：自定义重写 / 非常规 override / 未知减速 等语义抽查触发条件。
   * 实现：ctx.slowPath 显式置位 或 用户文本含原生命令/覆盖意图（"重写/覆盖/自定义/op:…/PARAM_"）→ true。
   * 两跳 <50ms 断言不受影响：本判定仅决定第二跳提交后是否追加复核。
   */
  needsSlowPath(event: DriverEvent, ctx: Context): boolean {
    if (ctx.slowPath === true) return true;
    if (event.type !== "user_text") return false;
    return /重写|覆盖|自定义|override|PARAM_|"op"\s*:/.test(event.text);
  }

  private renderLines(b: BehaviorItem, event: DriverEvent, ctx: Context): string[] {
    return b.lines.map((l) => (typeof l === "function" ? l(event, ctx) : l));
  }

  private feed(lines: string[]): void {
    const ts = this.now();
    for (const line of lines) {
      this.audit.push({ tMs: ts, line });
      this.ing.feedLine(line, ts);
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

// clock.ts —— 统一时钟契约（O-1；SPEC §5）
// 时间轴原则：说话用 audioClock（playhead 单调推进），其余 wallClock；一条时间轴内不混用，
// 避免宿主帧时钟 vs 内部 tMs 双时间轴漂移。所有时钟均从注入起点确定性推进。

/** 时钟：只承诺单调递增的 now()。driver 内部时间全部来自注入（确定性强）。 */
export interface DriverClock {
  /** 当前时间（ms）；同一时钟实例后续调用 >= 先前调用 */
  now(): number;
  /** 时钟标识（审计/调试区分时间轴） */
  readonly kind: "wall" | "audio" | "custom";
}

/** wallClock：宿主帧时钟——由宿主 onFrame(dtMs) 单调推进（与 Evaluator/环境层同源）。 */
export class WallClock implements DriverClock {
  readonly kind = "wall" as const;
  private t: number = 0;
  constructor(base = 0) { this.t = base; }
  advance(dtMs: number): void { this.t += Math.max(0, dtMs); }
  now(): number { return this.t; }
}

/** audioClock：语音播放入口时钟（playhead 语义）。时间轴独立，不与 wall 混用。 */
export class AudioClock implements DriverClock {
  readonly kind = "audio" as const;
  private t: number = 0;
  private readonly wallBase: number = 0;
  constructor(wallBase = 0, playhead = 0) {
    this.wallBase = wallBase;
    this.t = playhead;
  }
  /** 播放头绝对时间（ms，自注入起点） */
  now(): number { return this.t; }
  /** audio 事件发生在其 wall 时刻的偏移（审计用） */
  wallOffset(): number { return this.wallBase; }
  /** 音频推进多少毫秒（播放头单调前进，绝不倒带） */
  advancePlayhead(ms: number): void { this.t += Math.max(0, ms); }
}

/** 便捷：默认 wall 时钟（测试/宿主缺省用） */
export function defaultClock(): DriverClock { return new WallClock(); }
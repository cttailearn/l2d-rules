// 动作/表情播放引擎（规格 10.3）：驱动 ParamSet，供预览与编辑器共用
import type { MotionDef, MotionCurve } from "./anim.ts";
import { sampleMotion } from "./anim.ts";
import { ParamSet, type Expression } from "./params.ts";

export interface MotionPlayerOptions { fps?: number; }

export class MotionPlayer {
  private clockMs = 0;
  private playing = false;
  private speed = 1;
  private current: MotionDef | null = null;
  private expression: Expression | null = null;
  private fps: number;
  private params: ParamSet;
  private motions: Map<string, MotionDef>;
  private listeners = new Set<(t: number, values: Record<string, number>) => void>();

  constructor(params: ParamSet, motions: MotionDef[] = [], opts: MotionPlayerOptions = {}) {
    this.params = params;
    this.fps = opts.fps ?? 30;
    this.motions = new Map(motions.map(m => [mName(m), m]));
  }

  setMotionList(motions: MotionDef[]): void { this.motions = new Map(motions.map(m => [mName(m), m])); }
  list(): string[] { return [...this.motions.keys()]; }

  play(name?: string): void {
    if (name && this.motions.has(name)) this.current = this.motions.get(name)!;
    if (this.current) this.playing = true;
  }
  pause(): void { this.playing = false; }
  seek(ms: number): void { this.clockMs = Math.max(0, ms); this.sampleNow(); }
  setSpeed(s: number): void { this.speed = Math.max(0.1, Math.min(8, s)); }
  applyExpression(expr: Expression | null): void { this.expression = expr; this.sampleNow(); }

  // 步进一帧（编辑器循环调用）
  tick(dtMs: number): Record<string, number> {
    if (this.playing && this.current) this.clockMs += dtMs * this.speed;
    return this.sampleNow();
  }

  private sampleNow(): Record<string, number> {
    if (this.current) this.params.setMotionMany(sampleMotion(this.current, this.clockMs));
    this.params.applyExpression(this.expression);
    const values = this.params.values();
    for (const fn of this.listeners) fn(this.clockMs, values);
    return values;
  }

  onChange(fn: (t: number, values: Record<string, number>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get timeMs(): number { return this.clockMs; }
  get isPlaying(): boolean { return this.playing; }
  get currentMotion(): string | null { return this.current ? mName(this.current) : null; }
  get durationMs(): number { return this.current ? this.current.meta.duration * 1000 : 0; }
}

function mName(m: MotionDef): string {
  return (m as MotionDef & { name?: string }).name ?? m.curves[0]?.id ?? "motion";
}

// 便捷：由 motion3 JSON 构造 MotionDef（浏览器/Node 通用）
export type NamedMotion = MotionDef & { name: string };
export function motionFromJson(raw: { Meta?: { Duration: number; Fps: number; Loop: boolean }; Curves?: { Target: string; Id: string; Segments: number[] }[] }, name?: string): NamedMotion {
  const meta = raw.Meta ?? { Duration: 1, Fps: 30, Loop: true };
  const curves: MotionCurve[] = (raw.Curves ?? []).map(c => ({ target: "Parameter", id: c.Id, segments: c.Segments }));
  return { name: name ?? "imported", meta: { duration: meta.Duration, fps: meta.Fps, loop: meta.Loop }, curves };
}

// tts/viseme.ts —— 视素时间轴合成（TTS 升级，P6）—— DEVELOPMENT-SPEC §7
// 三级口型第一级：visemes（60–80ms 入出混合）。把离散视素事件合成为带渐入/渐出权重的
// 平滑口型轨迹；确定性纯函数，同输入同输出。

import type { VisemeId } from "./types.ts";

export interface VisemeEvent {
  tMs: number;
  viseme: VisemeId;
  /** 峰值权重（0..1；缺省 0.9） */
  weight?: number;
}

export interface BlendOpts {
  /** 入/出渐变时长（SPEC：60–80ms；缺省 70） */
  rampMs?: number;
  /** 事件之间的最小采样步长（缺省 16ms = 一帧） */
  stepMs?: number;
}

/**
 * 视素混合：每段以 ramp 线性渐入/渐出，重叠区相邻视素按权重叠加包络（叠高封顶 1）。
 * 输出含采样时间点上的合成权重（供口型参数每帧直接消费）。
 */
export function blendVisemes(events: readonly VisemeEvent[], opts: BlendOpts = {}): { tMs: number; visemes: { viseme: VisemeId; weight: number }[] }[] {
  const ramp = opts.rampMs ?? 70;
  const step = opts.stepMs ?? 16;
  const sorted = [...events].sort((a, b) => a.tMs - b.tMs);
  if (sorted.length === 0) return [];

  let t = sorted[0]!.tMs;
  let end = sorted[sorted.length - 1]!.tMs + ramp;
  const out: { tMs: number; visemes: { viseme: VisemeId; weight: number }[] }[] = [];
  while (t <= end) {
    const active: { viseme: VisemeId; weight: number }[] = [];
    for (const e of sorted) {
      const w = Math.max(0, Math.min(1, (ramp - Math.abs(t - e.tMs)) / ramp));
      if (w > 0) active.push({ viseme: e.viseme, weight: (e.weight ?? 0.9) * w });
    }
    // silence 事件覆盖：无活动段但有静音标点 → 口型闭合
    if (active.length === 0) active.push({ viseme: "silence", weight: 1 });
    out.push({ tMs: t, visemes: active });
    t += step;
  }
  return out;
}

/**
 * 音素段（含 viseme 或 phoneme）→ 平滑视素时间轴。
 * 直接消费 phonemes.ts 的输出；已是 VisemeEvent 时可直接用 blendVisemes。
 */
export function visemeTimeline(
  events: readonly VisemeEvent[],
  opts: BlendOpts = {},
): { tMs: number; visemes: { viseme: VisemeId; weight: number }[] }[] {
  return blendVisemes(events, opts);
}

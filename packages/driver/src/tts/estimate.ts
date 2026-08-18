// tts/estimate.ts —— 无 TTS 降级：简谐口型 + 预设时长（确定性，不阻塞）—— DEVELOPMENT-SPEC §7
// 口型 = 说话段口开合简谐（A 视素）交替静音；prosody = 恒定能量/音高（无音频时的中性脊梁）。
// 时长估计：按文本长度（~6 字/秒）+ 标点停顿。同 (text, voice, lang) → 同输出（可回归）。

import type { SpeechTimeline, VisemeId } from "./types.ts";

const CHARS_PER_SECOND = 6;
const VOWEL_SET = new Set(["a", "e", "i", "o", "u"]);

/** 文本 → 音段序列（ASCII 元音判定；中文整体按元音节奏近似） */
function phonemes(text: string): { viseme: VisemeId; ms: number }[] {
  const units: { viseme: VisemeId; ms: number }[] = [];
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    const lower = ch.toLowerCase();
    const v: VisemeId = VOWEL_SET.has(lower) ? (lower.toUpperCase() as VisemeId) : "A";
    units.push({ viseme: v, ms: Math.round(1000 / CHARS_PER_SECOND) });
  }
  return units;
}

/**
 * 降级时间轴：无 TTS 时估计口型与时长（预设语速），供口型通道消费；不阻塞。
 * 宿主有真 TTS 时用 TtsProvider.synthesize 替换本函数。
 */
export function estimateSpeechTimeline(text: string, opts: { voice?: string; lang?: string } = {}): SpeechTimeline {
  const lang = opts.lang ?? "zh";
  const units = phonemes(text);
  const totalMs = units.reduce((a, u) => a + u.ms, 0) + (units.length > 0 ? 120 : 0); // 尾部静音

  // 简谐口型：说话段 A/E/I/O/U 交替 + 句首尾静音（120ms）
  const visemes: { tMs: number; viseme: VisemeId; weight?: number }[] = [];
  let t = 120;
  for (const u of units) {
    visemes.push({ tMs: t, viseme: u.viseme, weight: 0.8 });
    t += u.ms;
  }
  if (units.length > 0) visemes.push({ tMs: t, viseme: "silence", weight: 1 });

  // 中性音频脊梁（能量/音高恒定；宿主接真 TTS 后由 prosody 替换）
  const prosody: { tMs: number; energy: number; pitch: number }[] = [
    { tMs: 0, energy: 0.05, pitch: 0.5 },
    { tMs: Math.max(1, totalMs - 1), energy: 0.05, pitch: 0.5 },
  ];

  return { text, lang, durationMs: totalMs, visemes, prosody };
}

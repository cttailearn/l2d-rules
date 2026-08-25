// tts/estimate.ts —— 无 TTS 降级：音节级口型 + 韵律包络（确定性，不阻塞）—— DEVELOPMENT-SPEC §7
// 口型 = 拉丁文本按元音取真实视素（a/e/i/o/u→A/E/I/O/U），CJK 按音节 A 视素 + 韵律调制；
// 韵律 = 语调包络（句首起、重读增能、句末降/问句升），替代旧版恒定中性脊梁。
// 时长估计：CJK ~6 字/秒、拉丁按字母簇；同 (text, voice, lang) → 同输出（可回归）。

import type { SpeechTimeline, VisemeId } from "./types.ts";

const CHARS_PER_SECOND = 6;
const SYLLABLE_MS = Math.round(1000 / CHARS_PER_SECOND); // ~167ms

// CJK 音节字符（不含全角标点 U+FF00–FFEF：让 ？！，。 落到标点分支做韵律修饰）
const CJK_RE = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
const LETTER_RE = /[a-zäöüß]/i;

/** 拉丁元音 → 视素（扁唇 E/I、圆唇 O/U、开口 A）。 */
function vowelViseme(ch: string): VisemeId {
  switch (ch.toLowerCase()) {
    case "a": case "ä": return "A";
    case "e": return "E";
    case "i": case "y": return "I";
    case "o": return "O";
    case "u": case "ü": case "ö": return "U";
    default: return "A";
  }
}

interface Syllable {
  /** 视素（拉丁按元音，CJK 恒 A） */
  viseme: VisemeId;
  ms: number;
  /** 是否句尾（其后为终止标点或结尾） */
  terminal: boolean;
  /** 标点能量/音高修饰（! 升能、? 升调） */
  energyBoost?: number;
  question?: boolean;
}

/** 文本 → 音节序列（确定性；标点驱动韵律修饰）。 */
function syllablesOf(text: string): Syllable[] {
  const units: Syllable[] = [];
  let i = 0;
  const n = text.length;
  let buffer: string[] = [];
  const flush = (): void => {
    if (buffer.length === 0) return;
    const s = buffer.join("");
    const viseme = vowelViseme(s.split("").find((c) => /[aeiouyäöü]/i.test(c)) ?? s.charAt(0));
    units.push({ viseme, ms: Math.round(SYLLABLE_MS * (s.length <= 3 ? 1 : s.length / 3)), terminal: false });
    buffer = [];
  };
  while (i < n) {
    const ch = text.charAt(i);
    if (LETTER_RE.test(ch)) {
      buffer.push(ch);
      i++;
      continue;
    }
    flush();
    if (/\s/.test(ch)) { i++; continue; }
    if (CJK_RE.test(ch)) {
      units.push({ viseme: "A", ms: SYLLABLE_MS, terminal: false });
      i++;
      continue;
    }
    // 标点：置句尾标记/修饰（! 增能、? 升调），句号/逗号/分隔符不单独成音节
    if (ch === "!" || ch === "?") {
      const q = ch === "?";
      if (units.length > 0) {
        units[units.length - 1]!.terminal = true;
        units[units.length - 1]!.energyBoost = q ? 0.25 : 0.5;
        units[units.length - 1]!.question = q;
      } else {
        units.push({ viseme: "A", ms: SYLLABLE_MS, terminal: true, energyBoost: q ? 0.25 : 0.5, question: q });
      }
    } else if (/[.;:;！？，。、…\n]/.test(ch)) {
      if (units.length > 0) units[units.length - 1]!.terminal = true;
      if (/[！？]/.test(ch)) {
        const q = ch === "？";
        units[units.length - 1]!.energyBoost = q ? 0.25 : 0.5;
        units[units.length - 1]!.question = q;
      }
    }
    i++;
  }
  flush();
  if (units.length > 0) units[units.length - 1]!.terminal = true;
  return units;
}

/**
 * 韵律包络（确定性语调）：句首升、句中中性、句末降（问句升调）、叹词增能。
 * 产出逐音节的 energy（0..1）与 pitch（0..1，可作手势/微表情调制脊梁）。
 */
export function estimateProsody(
  text: string,
  opts: { lang?: string } = {},
): { tMs: number; energy: number; pitch: number }[] {
  void opts;
  const units = syllablesOf(text);
  const out: { tMs: number; energy: number; pitch: number }[] = [];
  let t = 120;
  let pitch = 0.46;
  const rise = units.length > 0 ? 0.18 / Math.max(1, units.length) : 0;
  for (const u of units) {
    // 句首抬升 + 逐音节缓升，句末随语气折返
    pitch = Math.min(0.75, pitch + rise);
    if (u.terminal) pitch = u.question ? Math.min(1, pitch + 0.2) : Math.max(0.2, pitch - 0.3);
    const energy = 0.28 + (u.energyBoost ?? 0) + (u.terminal && !u.question ? -0.08 : 0);
    out.push({ tMs: t, energy: Math.min(1, Math.max(0.05, energy)), pitch: Math.min(1, Math.max(0.05, pitch)) });
    t += u.ms;
  }
  if (out.length === 0) {
    out.push({ tMs: 0, energy: 0.05, pitch: 0.5 });
  }
  // 尾部静音脊梁点（供口型闭合/手势回落）
  out.push({ tMs: Math.max(1, t), energy: 0.05, pitch: 0.46 });
  return out;
}

/**
 * 降级时间轴：无 TTS 时估计口型与时长（音节级视素 + 语调韵律）。
 * 宿主有真 TTS 时用 TtsProvider.synthesize（可复用 phonemes.ts/viseme.ts 做真实音素口型）。
 */
export function estimateSpeechTimeline(text: string, opts: { voice?: string; lang?: string } = {}): SpeechTimeline {
  const lang = opts.lang ?? "zh";
  const units = syllablesOf(text);
  const totalMs = units.reduce((a, u2) => a + u2.ms, 0) + (units.length > 0 ? 120 : 0);

  // 音节级口型（含句首/尾静音 120ms）
  const visemes: { tMs: number; viseme: VisemeId; weight?: number }[] = [];
  let t = 120;
  for (const unit of units) {
    visemes.push({ tMs: t, viseme: unit.viseme, weight: unit.terminal ? 0.75 : 0.85 });
    t += unit.ms;
  }
  if (units.length > 0) visemes.push({ tMs: t, viseme: "silence", weight: 1 });

  const prosody = estimateProsody(text, { lang });

  return { text, lang, durationMs: totalMs, visemes, prosody };
}

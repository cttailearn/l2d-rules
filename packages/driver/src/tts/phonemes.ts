// tts/phonemes.ts —— 音素 → viseme 映射（TTS 升级，P6）—— DEVELOPMENT-SPEC §7
// 真实口型需要"音素级"输入（宿主 TTS 的 phoneme 时间戳或 pinyin 分段）；
// 本模块提供确定性映射表 + 查询函数，供宿主/降级管线的 visemeTimeline 消费。
// 视素仅 6 档（silence/A/I/U/E/O），与 engine 口型参数一一对应。

import type { VisemeId } from "./types.ts";

/** 英式 ARPABET 常用音素 → 视素（辅音归中性 A；元音按开口/圆唇/扁唇细分）。 */
export const EN_VISEME: Readonly<Record<string, VisemeId>> = {
  aa: "A", ae: "A", ah: "A", ao: "O", aw: "O", ax: "A", ay: "A",
  eh: "E", er: "E", ey: "E",
  ih: "I", iy: "I",
  uh: "U", uw: "U", ux: "U",
  ow: "O", oy: "O",
  m: "A", n: "A", ng: "A", em: "A", en: "A", eng: "A",
  p: "A", b: "A", t: "A", d: "A", k: "A", g: "A", ch: "A", jh: "A",
  f: "A", v: "A", th: "A", dh: "A", s: "A", z: "A", sh: "A", zh: "A", hh: "A",
  l: "A", r: "A", w: "U", y: "I",
};

/** 汉语拼音韵母 → 视素（开口/齐齿/合口/撮口按口形）。 */
export const ZH_FINAL_VISEME: Readonly<Record<string, VisemeId>> = {
  a: "A", o: "O", e: "E", i: "I", u: "U", v: "U", ü: "U", ê: "E", er: "E",
  ai: "I", ei: "E", ui: "U", ao: "O", ou: "O", iu: "U", ie: "E", ue: "U", üe: "U", ye: "E",
  an: "A", en: "E", in: "I", un: "U", ün: "U", uen: "E", uin: "I",
  ang: "A", eng: "E", ing: "I", ong: "O", iong: "O",
  ia: "A", iao: "O", ian: "A", iang: "A", ua: "A", uo: "O", uai: "I", uan: "A", uang: "A", üan: "A",
};

/**
 * 音素 → 视素（小写匹配；未知音素回退中性 "A"——不要抛错：降级管线要求永不失败）。
 */
export function phonemeToViseme(phoneme: string): VisemeId {
  const p = phoneme.toLowerCase().trim();
  if (p === "" || p === "sil" || p === "sp" || p === "_") return "silence";
  return (ZH_FINAL_VISEME[p] ?? EN_VISEME[p] ?? "A") as VisemeId;
}

/**
 * 离散 "音素段" → 视素名（每段一条；opts.phonemeField 指定用哪个字段，缺省 `phoneme`）。
 * 供宿主把真实 TTS 的 phoneme 时间戳转成口型段。
 */
export function phonemeSegmentsToVisemes(
  segments: readonly { tMs: number; [k: string]: unknown }[],
  opts: { phonemeField?: string } = {},
): { tMs: number; viseme: VisemeId; weight?: number }[] {
  const field = opts.phonemeField ?? "phoneme";
  const out: { tMs: number; viseme: VisemeId; weight?: number }[] = [];
  for (const s of segments) {
    const raw = s[field];
    const viseme = typeof raw === "string" ? phonemeToViseme(raw) : "A";
    out.push({ tMs: s.tMs, viseme, weight: 0.9 });
  }
  return out;
}

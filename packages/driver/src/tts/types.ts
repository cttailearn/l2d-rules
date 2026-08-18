// tts/types.ts —— 语音与口型 —— DEVELOPMENT-SPEC §7
// 三级口型：visemes（60–80ms 入出混合）→ RMS（音量包络）→ 简谐（无音频降级）。
// 时钟：说话用 audioClock（playhead），其余 wallClock；一条时间轴内不混用。

export type VisemeId = "silence" | "A" | "I" | "U" | "E" | "O";

export interface SpeechTimeline {
  text: string;
  lang: string;
  audio?: Uint8Array;
  durationMs: number;
  /** 口型关键帧（绝对时间戳） */
  visemes?: { tMs: number; viseme: VisemeId; weight?: number }[];
  /** 音频脊梁（能量/音高 → 环境层手势/微表情调制，跨通道相关性） */
  prosody?: { tMs: number; energy: number; pitch: number }[];
}

export interface TtsProvider {
  synthesize(text: string, opts?: { voice?: string; lang?: string }): Promise<SpeechTimeline>;
  capabilities(): { visemes: boolean };
}

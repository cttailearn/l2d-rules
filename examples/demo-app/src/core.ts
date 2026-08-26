// core.ts —— demo-app 应用核心（无 DOM）：角色大脑 + 两跳决策 + 说话口型 + 场景合成
// 浏览器（main.ts）、无头 CLI（scripts/run.mjs）、无头测试（test/app.test.ts）共用同一核心。
//
// 一条消息的处理链路（每步都是 SDK 能力）：
//   用户文本 → ① 两跳决策（@l2dp/driver DriverEngine：第一跳本地 BehaviorIndex 规则，
//              第二跳 Provider（模拟/真实 LLM）输出 JSONL）
//   → ② 确定性应答器产出台词
//   → ③ 台词经 estimateSpeechTimeline/blendVisemes 取样 → 驱动口型参数（说话张嘴）
//   → ④ StreamIngestor/LayerStack/EnvironmentLayer/Evaluator 算出每帧参数 → L2dmPlayer
//   → ⑤ SceneStage（背景 + 相机 + 多角色 z-order）合成到 RenderSink（软件/WebGL2）。
import {
  BehaviorIndex,
  DriverEngine,
  EnvironmentLayer,
  Evaluator,
  LayerStack,
  StreamIngestor,
  blendVisemes,
  estimateSpeechTimeline,
  outfitLines,
  type EnvParamDef,
  type IngestResult,
  type MotionLike,
  type RuntimeProvider,
} from "@l2dp/driver";
import {
  loadL2dm,
  L2dmPlayer,
  SceneStage,
  type L2dmModel,
  type RenderSink,
  type Tex2D,
} from "@l2dp/engine";
import {
  AppProvider,
  matchEmotion,
  pickResponse,
  pickSound,
  REACTION_LINES,
  type AppCharacter,
  type Emotion,
} from "./chars.ts";

// ---------------------------------------------------------------- 计数 ingestor
class CountingIngestor extends StreamIngestor {
  applied = 0;
  skipped = 0;
  override feedLine(line: string, tMs: number): IngestResult {
    const r = super.feedLine(line, tMs);
    this.applied += r.applied.length;
    this.skipped += r.skipped.length;
    return r;
  }
}

export interface SpeakNotice {
  text: string;
  sound?: string;
  speechMs: number;
}

export interface ReplyOutcome {
  replyText: string;
  emotion: Emotion;
  lines: readonly string[];
  hop: 1 | 2;
  behaviorId?: string;
  speechMs: number;
  usedSound?: string;
  applied: number;
  skipped: number;
}

export interface AppCoreOptions {
  /** .l2dm 文本 */
  modelJson: string;
  /** 已解码纹理（浏览器走 fflate；无头可空 = 纯色） */
  atlas?: Map<string, Tex2D>;
  /** 渲染接收器（软件/WebGL2） */
  sink: RenderSink;
  character: AppCharacter;
  /** 第二跳 Provider；缺省 AppProvider（确定性，离线/CI 可用） */
  provider?: RuntimeProvider;
  /** 每种情绪的动作行表（创作角色用自身动作资产）；缺省用 REACTION_LINES[character.kind] */
  reactionLines?: Record<Emotion, string[]>;
  seed?: number;
  /** 舞台画布（逻辑尺寸；渲染按此缩放适配） */
  stage?: { width: number; height: number };
  background?: [number, number, number, number];
  /** 同伴模型（可选；启动即带同伴，见 enableCompanion） */
  companionModelJson?: string;
  companionAtlas?: Map<string, Tex2D>;
  /** 每句台词的回调（浏览器播声音、无头记录） */
  onSpeak?: (o: SpeakNotice) => void;
}

/** 视素强度（非 silence 的峰值权重）→ 口型开合 0..1 */
function visemeIntensity(
  sample: { tMs: number; visemes: { viseme: string; weight: number }[] } | undefined,
): number {
  if (!sample) return 0;
  let m = 0;
  for (const v of sample.visemes) {
    if (v.viseme !== "silence" && v.weight > m) m = v.weight;
  }
  return Math.min(1, m);
}

interface SpeakState {
  startT: number;
  durationMs: number;
  samples: { tMs: number; visemes: { viseme: string; weight: number }[] }[];
}

// 同伴的循环尾巴摇动作（demo 骨架用）
const COMPANION_TAIL: MotionLike = {
  durationMs: 1200,
  loop: true,
  curves: [{ id: "尾巴摆", segments: [0, 0.2, 0, 1, 1] }],
};

export class AppCore {
  readonly model: L2dmModel;
  readonly player: L2dmPlayer;
  readonly stage: SceneStage;
  readonly sink: RenderSink;
  readonly ing: CountingIngestor;
  readonly brain: DriverEngine;
  readonly character: AppCharacter;
  readonly provider: RuntimeProvider;
  readonly onSpeak?: (o: SpeakNotice) => void;

  private readonly evaluator: Evaluator;
  private readonly stageW: number;
  private readonly stageH: number;
  private tMs = 0;
  private speak: SpeakState | null = null;
  private companion: { player: L2dmPlayer; evaluator: Evaluator } | null = null;

  constructor(opts: AppCoreOptions) {
    const loaded = loadL2dm(opts.modelJson);
    if (!loaded.ok) throw new Error(`.l2dm 加载失败: ${loaded.error}`);
    if (!loaded.model) throw new Error(".l2dm 加载失败：模型为空");
    this.model = loaded.model;
    this.character = opts.character;
    this.sink = opts.sink;
    this.onSpeak = opts.onSpeak;
    const reactionLines: Record<Emotion, string[]> =
      opts.reactionLines ?? REACTION_LINES[opts.character.kind];
    this.provider = opts.provider ?? new AppProvider(opts.reactionLines ? reactionLines.neutral : opts.character.kind);
    const seed = opts.seed ?? 42;

    // ---- 参数面 + 环境层定义（官方参数 → 环境分组的 manifest 映射覆盖）----
    const overrides = opts.character.envOverrides ?? {};
    const playerParams = this.model.parameters.map((p) => ({
      id: p.id,
      min: p.min,
      max: p.max,
      def: p.def ?? 0,
      group: overrides[p.id] ?? p.group ?? "Custom",
    }));
    const env = new EnvironmentLayer(playerParams, { seed });
    const stack = new LayerStack(playerParams);
    this.ing = new CountingIngestor({
      manifest: {
        sems: playerParams.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })),
      },
      library: {
        motions: Object.keys(opts.character.motions ?? {}).map((name) => ({ name })),
        expressions: Object.keys(opts.character.expressions ?? {}).map((name) => ({ name })),
        behaviors: [],
      },
      assets: {
        motions: new Map<string, MotionLike>(Object.entries(opts.character.motions ?? {})),
        expressions: new Map(Object.entries(opts.character.expressions ?? {})),
      },
      stack,
      env,
      seed,
    });

    // ---- 两跳决策：第一跳本地规则 + 第二跳 provider ----
    const index = new BehaviorIndex(seed);
    for (const emotion of Object.keys(reactionLines) as Emotion[]) {
      if (emotion === "neutral") continue;
      index.register({
        id: emotion,
        events: ["user_text"],
        kinds: [],
        priority: 10,
        lines: reactionLines[emotion],
        match: (e) => e.type === "user_text" && matchEmotion(e.text) === emotion,
      });
    }
    this.brain = new DriverEngine({ index, provider: this.provider, ing: this.ing });

    // ---- 引擎播放器：Evaluator 每帧把分层求值结果写回参数面 ----
    this.player = new L2dmPlayer(this.model, opts.atlas ?? new Map());
    const heroPlayer = this.player;
    this.evaluator = new Evaluator(stack, env, playerParams, {
      apply(_ch: string, params: Record<string, number>): void {
        for (const [k, v] of Object.entries(params)) heroPlayer.params.set(k, v);
      },
    });

    // ---- 舞台 ----
    this.stageW = opts.stage?.width ?? 560;
    this.stageH = opts.stage?.height ?? 720;
    this.stage = new SceneStage({ width: this.stageW, height: this.stageH }, { background: opts.background ?? [0, 0, 0, 0] });
    this.layoutHero();

    // ---- 同伴（可选）----
    if (opts.companionModelJson !== undefined) {
      const cl = loadL2dm(opts.companionModelJson);
      if (cl.ok && cl.model) this.buildCompanion(cl.model, opts.companionAtlas ?? new Map());
    }
  }

  // ---------------------------------------------------------------- 布局
  /** 主角色适配到舞台（居中、等比缩放） */
  private layoutHero(): void {
    const mw = Math.max(1, this.model.canvas.width);
    const mh = Math.max(1, this.model.canvas.height);
    const scale = Math.min(this.stageW / mw, this.stageH / mh) * 0.94;
    const x = (this.stageW - mw * scale) / 2;
    const y = (this.stageH - mh * scale) / 2;
    this.stage.setChild({ id: "hero", player: this.player, x, y, scale, z: 2 });
  }

  /** 构造同伴（演示骨架：循环尾巴摇 + 自己的环境层） */
  private buildCompanion(m: L2dmModel, atlas: Map<string, Tex2D>): void {
    const defs: EnvParamDef[] = m.parameters.map((p) => ({
      id: p.id,
      min: p.min,
      max: p.max,
      def: p.def ?? 0,
      group: p.group ?? "Custom",
    }));
    const env = new EnvironmentLayer(defs, { seed: 7 });
    const stack = new LayerStack(defs);
    const player = new L2dmPlayer(m, atlas);
    const evaluator = new Evaluator(stack, env, defs, {
      apply(_c: string, params: Record<string, number>): void {
        for (const [k, v] of Object.entries(params)) player.params.set(k, v);
      },
    });
    this.companion = { player, evaluator };
    if (m.parameters.some((p) => p.id === "尾巴摆")) player.play(COMPANION_TAIL);
    const scale =
      Math.min(this.stageW / Math.max(1, m.canvas.width), this.stageH / Math.max(1, m.canvas.height)) * 0.3;
    this.stage.setChild({
      id: "companion",
      player,
      x: this.stageW - m.canvas.width * scale - 8,
      y: this.stageH - m.canvas.height * scale - 8,
      scale,
      z: 1,
    });
  }

  get hasCompanion(): boolean {
    return this.companion !== null;
  }

  // ---------------------------------------------------------------- 交互入口
  /** 用户输入一句话 → 两跳决策 + 台词 + 说话动作。 */
  async handleUserText(text: string): Promise<ReplyOutcome> {
    const emotion = matchEmotion(text) ?? "neutral";
    const r = await this.brain.dispatch({ type: "user_text", text }, { mood: { valence: 0.6, arousal: 0.5 } });
    const lines = r.lines;
    const replyText = pickResponse(text, (r.behaviorId ?? emotion) as Emotion);
    const speechMs = estimateSpeechTimeline(replyText).durationMs;
    const usedSound = this.character.sounds ? pickSound(text, this.character.sounds) : undefined;
    if (this.character.mouthParam !== null) this.startSpeak(replyText, speechMs);
    this.onSpeak?.({ text: replyText, sound: usedSound, speechMs });
    return {
      replyText,
      emotion,
      lines,
      hop: r.hop,
      behaviorId: r.behaviorId,
      speechMs,
      usedSound,
      applied: this.ing.applied,
      skipped: this.ing.skipped,
    };
  }

  /** 直接投喂 JSONL 行（控制条预置/换装用），返回生效统计。 */
  feedLines(lines: string[]): { applied: number; skipped: number } {
    for (const line of lines) this.ing.feedLine(line, this.tMs);
    return { applied: this.ing.applied, skipped: this.ing.skipped };
  }

  /** 换装：目标服装组 → SDK outfitLines 生成 set 行 → 逐行生效。 */
  setOutfit(group: number): string[] {
    const costumes = this.character.costumes;
    if (!costumes) return [];
    const lines = outfitLines(costumes, group);
    this.feedLines(lines);
    return lines;
  }

  /** 参数面复位到缺省值（“重置”预置用） */
  reset(): void {
    this.player.params.reset();
    this.ing.applied = 0;
    this.ing.skipped = 0;
  }

  // ---------------------------------------------------------------- 说话口型
  private startSpeak(text: string, speechMs: number): void {
    const tl = estimateSpeechTimeline(text);
    const samples = blendVisemes(
      (tl.visemes ?? []).map((v) => ({ tMs: v.tMs, viseme: v.viseme, weight: v.weight ?? 0.9 })),
      { rampMs: 60, stepMs: 16 },
    );
    const lastSampleT = samples.length > 0 ? samples[samples.length - 1]!.tMs + 60 : 0;
    this.speak = { startT: this.tMs, durationMs: Math.max(speechMs, lastSampleT), samples };
  }

  isSpeaking(): boolean {
    return this.speak !== null;
  }

  speechRemainMs(): number {
    if (!this.speak) return 0;
    return Math.max(0, this.speak.durationMs - (this.tMs - this.speak.startT));
  }

  private applySpeak(): void {
    const s = this.speak;
    if (!s) return;
    const t = this.tMs - s.startT;
    if (t >= s.durationMs) {
      this.speak = null;
      return;
    }
    const param = this.character.mouthParam!;
    let sample: { tMs: number; visemes: { viseme: string; weight: number }[] } | undefined;
    for (const sm of s.samples) {
      if (sm.tMs <= t) sample = sm;
      else break;
    }
    const open = Math.min(1, visemeIntensity(sample) * (this.character.mouthScale ?? 0.8));
    this.player.params.set(param, open);
  }

  // ---------------------------------------------------------------- 帧推进 + 渲染
  onFrame(dtMs: number): void {
    this.tMs += Math.max(0, dtMs);
    this.brain.onFrame(dtMs);
    this.evaluator.onFrame(dtMs);
    this.companion?.evaluator.onFrame(dtMs);
    this.player.tick(dtMs);
    this.companion?.player.tick(dtMs);
    this.applySpeak();
    this.stage.tick(dtMs);
    this.stage.render(this.sink);
  }

  /** 当前参数快照（UI 读数面板） */
  params(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.model.parameters) out[p.id] = this.player.params.get(p.id);
    return out;
  }

  /** 背景 = SceneStage 纯色（alpha=0 → 透明棋盘由宿主 CSS 呈现） */
  setBackground(bg: [number, number, number, number]): void {
    this.stage.background = bg;
  }

  /** 相机缓动（SceneStage.zoomTo 演示） */
  zoomTo(z: number, durMs = 400): void {
    this.stage.zoomTo(z, durMs);
  }

  get nowMs(): number {
    return this.tMs;
  }
}

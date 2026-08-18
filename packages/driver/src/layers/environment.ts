// EnvironmentLayer —— 环境层（程序化常驻，"活着"的底座）—— DEVELOPMENT-SPEC §6.4
// 控制器：Breath(呼吸) / Blink(眨眼) / GazeDrift(视线微动) / WeightShift(重心微移)
// 信号源：正弦 + Voss-McCartney 1/f 粉噪声（种子化）——1/f 是"生命签名"（§6.2）。
//
// 纪律（§6.4）：
//   - 只写管辖组参数：呼吸→"Ambient"/"Breath"、眨眼→"EyeBlink"、视线→"Head"、重心→"Body"
//   - 不写 Custom 组（防与显式动作/表情冲突）
//   - 输出 = 参数值单位偏移（signal × maxAmp × 范围 × α_ambient），由 LayerStack 加到 base
//   - 眼睛不许静止：GazeDrift 恒有微动（固视微动）
//   - 确定性：无 Date.now，所有随机来自注入种子；同 (参数, seed, tick 序列) 同输出
//
// 注：环境层"只写 Ambient 或显式管辖参数"——"Breath 组"在引擎组枚举里不存在，
// 故呼吸控制器接收 group:"Ambient"（引擎合法组）或 "Breath"（规格字面组）二者其一。

import { mulberry32, type SeededRandom } from "@l2dp/engine";

/** 环境层幅度系数（§6.4：α_ambient 默认 0.3） */
export const ALPHA_AMBIENT = 0.3;

/** 环境层消费的参数定义（结构型：与 .l2dm parameter / manifest sem 兼容） */
export interface EnvParamDef {
  id: string;
  min: number;
  max: number;
  group?: string;
  def?: number;
}

export interface EmoteSignal {
  /** [-1,1] */
  valence: number;
  /** [0,1] */
  arousal: number;
}

const BLINK_DURATION_MS = 140;
const EMOTE_TAU_MS = 500; // emote 平滑时间常数（确定性指数平滑）

/** Voss-McCartney 1/f 粉噪声：octave k 每 2^k 步重采样，输出 = 各 octave 均值（∈[-1,1]）。 */
function vossNoise(seed: number, octaves: number): () => number {
  const rngs: SeededRandom[] = Array.from({ length: octaves }, (_, k) => mulberry32((seed + k * 2654435761) >>> 0));
  const vals: number[] = rngs.map((r) => r.next() * 2 - 1);
  let n = 0;
  return () => {
    n += 1;
    for (let k = 0; k < rngs.length; k++) {
      if (n % (1 << k) === 0) vals[k] = rngs[k].next() * 2 - 1;
    }
    let s = 0;
    for (const v of vals) s += v;
    return s / vals.length;
  };
}

function sine(freqHz: number, phase: number, tMs: number): number {
  return Math.sin(2 * Math.PI * freqHz * (tMs / 1000) + phase);
}

export class EnvironmentLayer {
  private readonly breath: EnvParamDef[];
  private readonly blinkParams: EnvParamDef[];
  private readonly gaze: EnvParamDef[];
  private readonly weight: EnvParamDef[];
  private readonly allParams: Map<string, EnvParamDef>;
  private readonly maxAmp: Record<string, number>;

  private readonly rng: SeededRandom;
  private readonly baseFreqHz: number;
  private readonly breathPhase0: number;

  // emote（目标 + 平滑后的当前值；确定性过渡）
  private emoteTarget: EmoteSignal = { valence: 0, arousal: 0 };
  private emoteCur: EmoteSignal = { valence: 0, arousal: 0 };
  private lastT = 0;
  private hasT = false;

  // Blink 状态机
  private blinking = false;
  private blinkEndAt = 0;
  private nextBlinkAt = 0;
  private blinkIntervalOverride: number | null = null; // blink op 一次性覆盖
  private forceBlink = false;
  private readonly defaultBlinkMin = 2000;
  private readonly defaultBlinkMax = 5000;

  // drift：sem → { amplitude, period, phase0 }
  private readonly drifts = new Map<string, { amplitude: number; period: number; phase0: number }>();

  private readonly gazeNoise: () => number;
  private readonly weightNoise: () => number;

  constructor(params: EnvParamDef[], opts: { seed: number; freqHz?: number }) {
    const pick = (groups: string[]): EnvParamDef[] => params.filter((p) => groups.includes(p.group ?? ""));
    this.breath = pick(["Ambient", "Breath"]);
    this.blinkParams = pick(["EyeBlink"]);
    this.gaze = pick(["Head"]);
    this.weight = pick(["Body"]);
    // 全部参数（含 Custom）——drift 是显式例外，允许写任意已声明 sem
    this.allParams = new Map(params.map((p) => [p.id, p]));
    this.maxAmp = { breath: 0.5, blink: 1.0, gaze: 0.15, weight: 0.1 };

    this.rng = mulberry32(opts.seed >>> 0);
    this.baseFreqHz = opts.freqHz ?? 0.25;
    this.breathPhase0 = this.rng.next() * Math.PI * 2;
    // 首个眨眼时刻（种子决定）
    this.nextBlinkAt = this.randomBlinkInterval();

    this.gazeNoise = vossNoise(opts.seed + 101, 8);
    this.weightNoise = vossNoise(opts.seed + 202, 8);
  }

  /** 控制器管辖的参数列表（测试断言用） */
  owned(): string[] {
    return [...this.breath, ...this.blinkParams, ...this.gaze, ...this.weight].map((p) => p.id);
  }

  /** emote 调制（写入单一"当前环境状态"，覆盖先前；确定性平滑过渡） */
  setEmote(e: EmoteSignal | null): void {
    this.emoteTarget = e ?? { valence: 0, arousal: 0 };
  }

  /** blink 指令：立即强制眨眼；interval 给定则覆盖下一次眨眼间隔（一次性，用后交还控制器） */
  feedBlink(intervalMs?: number): void {
    this.forceBlink = true;
    if (intervalMs !== undefined) this.blinkIntervalOverride = Math.max(0, intervalMs);
  }

  /** drift 指令：对 sem 施加持续正弦漂移（amplitude 归一化 0..1；同 sem 后者覆盖） */
  setDrift(sem: string, amplitude: number, period: number): void {
    this.drifts.set(sem, { amplitude, period: Math.max(0.001, period), phase0: this.rng.next() * Math.PI * 2 });
  }

  /** 每帧调用：返回本层贡献（参数值单位偏移，已含 α_ambient 与 maxAmp）。 */
  tick(tMs: number): Record<string, number> {
    const dt = this.hasT ? Math.max(0, tMs - this.lastT) : 0;
    this.lastT = tMs;
    this.hasT = true;

    // emote 平滑（时间常数 EMOTE_TAU_MS）
    const k = dt === 0 ? 0 : 1 - Math.exp(-dt / EMOTE_TAU_MS);
    const e = this.emoteCur;
    e.valence += (this.emoteTarget.valence - e.valence) * k;
    e.arousal += (this.emoteTarget.arousal - e.arousal) * k;

    const out: Record<string, number> = {};
    const add = (params: EnvParamDef[], sem: string, signal: number): void => {
      if (params.length === 0) return;
      const span = params[0]!.max - params[0]!.min;
      const contrib = signal * this.maxAmp[sem]! * span * ALPHA_AMBIENT;
      for (const p of params) out[p.id] = (out[p.id] ?? 0) + contrib;
    };

    // 呼吸：arousal↑ → 浅快（freq↑ amp↑）；valence↓ → 深缓（freq↓ amp↑）
    const breathFreq = this.baseFreqHz * (1 + 0.5 * e.arousal + 0.3 * e.valence);
    const breathAmp = 1 + 0.5 * e.arousal + 0.4 * Math.max(0, -e.valence);
    add(this.breath, "breath", sine(breathFreq, this.breathPhase0, tMs) * breathAmp);

    // 眨眼状态机（种子化随机间隔；blink 指令可一次性覆盖）
    if (this.forceBlink) {
      this.forceBlink = false;
      this.blinking = true;
      this.blinkEndAt = tMs + BLINK_DURATION_MS;
      this.nextBlinkAt = tMs + this.randomBlinkInterval();
    }
    if (this.blinking && tMs >= this.blinkEndAt) this.blinking = false;
    if (!this.blinking && tMs >= this.nextBlinkAt) {
      this.blinking = true;
      this.blinkEndAt = tMs + BLINK_DURATION_MS;
      this.nextBlinkAt = tMs + this.randomBlinkInterval();
    }
    add(this.blinkParams, "blink", this.blinking ? 1 : 0);

    // 视线微动：1/f 粉噪声，恒动（固视微动，防视觉适应）
    add(this.gaze, "gaze", this.gazeNoise());

    // 重心微移：慢周期 + 1/f
    const w = 0.6 * sine(0.08, 0, tMs) + 0.4 * this.weightNoise();
    add(this.weight, "weight", w);

    // drift：显式持续漂移（例外写任意 sem——用户显式要求）
    for (const [sem, d] of this.drifts) {
      const p = this.allParams.get(sem);
      if (!p) continue;
      const contrib = sine(1000 / d.period, d.phase0, tMs) * d.amplitude * (p.max - p.min) * ALPHA_AMBIENT;
      out[sem] = (out[sem] ?? 0) + contrib;
    }
    return out;
  }

  /** 下一次眨眼间隔（一次性 override 用后即还） */
  private randomBlinkInterval(): number {
    const min = this.defaultBlinkMin;
    const max = this.defaultBlinkMax;
    let iv = min + this.rng.next() * (max - min);
    if (this.blinkIntervalOverride !== null) {
      iv = this.blinkIntervalOverride;
      this.blinkIntervalOverride = null;
    }
    return iv;
  }
}

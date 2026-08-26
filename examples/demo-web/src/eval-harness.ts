// eval-harness.ts —— 评估集执行台（eval-drive 与测试共用）—— DEVELOPMENT-SPEC §10
// 全链路：demo 模型 → 参数面/manifest/资产 → BehaviorIndex + MockProvider + DriverEngine
// → 事件 dispatch（两跳）→ 确定性求值（固定 dt）→ expectedSemEffect 逐断言评分。
//
// 断言语义（P2-3 定案）：断言语义效果而非字节 IR——
//   windowMs[0]=-1 表示从流开始；sem+min/max 为参数值断言；op+kinds 为行为断言（匹配库索引 kinds）。

import {
  StreamIngestor,
  LayerStack,
  EnvironmentLayer,
  Evaluator,
  BehaviorIndex,
  DriverEngine,
  MockProvider,
  type RuntimeProvider,
  type ManifestLike,
  type AssetIndex,
  type AssetStore,
  type MotionLike,
  type EnvParamDef,
  type DriverEvent,
  type Context,
  type BehaviorItem,
} from "@l2dp/driver";
import { loadL2dm, type L2dmModel } from "@l2dp/engine";
import { DEMO_MOTIONS, DEMO_EXPRESSIONS } from "./scene.ts";

export interface EvalCase {
  id: string;
  scenario: {
    event: DriverEvent["type"];
    userText?: string;
    mood?: { valence: number; arousal: number };
    context?: Context;
    seed?: number;
    /** P1-2：true = 用 native 结构化输出 provider（走 P0-1 修复后的 structured 链路） */
    structured?: boolean;
  };
  expectedSemEffect: {
    windowMs: [number, number];
    sem?: string;
    min?: number;
    max?: number;
    op?: string;
    kinds?: string[];
    /** op 断言的可选载荷值（如 camera 的 zoom） */
    zoom?: number;
  }[];
}

export interface EvalResult {
  id: string;
  pass: boolean;
  failures: string[];
  hop?: 1 | 2;
  behaviorId?: string;
}

export interface EvalReport {
  version: number;
  clock: string;
  total: number;
  passed: number;
  failed: number;
  results: EvalResult[];
}

/** demo 行为库（两跳第一跳本地规则；kinds 供 op 断言） */
export function demoBehaviorIndex(): BehaviorIndex {
  const index = new BehaviorIndex();
  const reg = (b: BehaviorItem): void => index.register(b);
  reg({
    id: "greeting", events: ["user_text"], kinds: ["greeting"], priority: 10,
    lines: ['{"op":"play","asset":"微笑点头"}', '{"op":"play","asset":"尾巴摇"}'],
    match: (e) => e.type === "user_text" && /你好|hello|嗨|hi/i.test(e.text),
  });
  reg({
    id: "nod", events: ["user_text"], kinds: ["ack"], priority: 8,
    lines: ['{"op":"play","asset":"微笑点头"}'],
    match: (e) => e.type === "user_text" && /点头|嗯|同意/.test(e.text),
  });
  reg({
    id: "shy", events: ["user_text"], kinds: ["shy"], priority: 8,
    lines: ['{"op":"play","asset":"害羞低头"}'],
    match: (e) => e.type === "user_text" && /害羞|脸红/.test(e.text),
  });
  reg({ id: "listen", events: ["user_voice"], kinds: ["listen"], priority: 5, lines: [] });
  reg({
    id: "emote_follow", events: ["emote"], kinds: ["affirm"], priority: 3,
    lines: [
      (e) => JSON.stringify({ op: "emote", emote: e.type === "emote" ? { valence: e.valence, arousal: e.arousal } : { valence: 0, arousal: 0 } }),
      '{"op":"play","asset":"微笑点头"}',
    ],
  });
  reg({ id: "idle", events: ["idle"], kinds: ["idle"], priority: 1, lines: ['{"op":"play","asset":"微笑点头"}'] });
  // P1-2：camera / outfit 宿主 op 行为（评估集覆盖——校验可表达且审计可见）
  reg({
    id: "camera_pan", events: ["user_text"], kinds: ["camera"], priority: 9,
    lines: ['{"op":"camera","zoom":1.2,"pan":[10,0]}'],
    match: (e) => e.type === "user_text" && /镜头|camera|推近|拉近/i.test(e.text),
  });
  reg({
    id: "outfit_switch", events: ["user_text"], kinds: ["outfit"], priority: 9,
    lines: ['{"op":"outfit","outfit":"衣装组2"}'],
    match: (e) => e.type === "user_text" && /换装|outfit|衣装/i.test(e.text),
  });
  return index;
}

/** P1-2：native 结构化输出 provider（P0-1 修复后的 structured 链路评估覆盖）。 */
class StructuredEvalProvider implements RuntimeProvider {
  capabilities(): { structured: "native" } {
    return { structured: "native" };
  }
  async createCompletion(): Promise<{ text: string; structured: unknown }> {
    return {
      text: "",
      structured: {
        v: 2,
        directives: [
          { op: "play", asset: "微笑点头" },
          { op: "play", asset: "尾巴摇" },
        ],
      },
    };
  }
}

export interface EvalHarness {
  stack: LayerStack;
  env: EnvironmentLayer;
  index: BehaviorIndex;
  provider: RuntimeProvider;
  engine: DriverEngine;
  ev: Evaluator;
  /** 参数采样（每帧） */
  frames: { t: number; params: Record<string, number> }[];
  paramAt(t: number): Record<string, number>;
}

export function createEvalHarness(modelJson: string, seed = 42, opts: { structured?: boolean } = {}): EvalHarness {
  const loaded = loadL2dm(modelJson);
  if (!loaded.ok) throw new Error(`demo.l2dm 加载失败: ${loaded.error}`);
  const model: L2dmModel = loaded.model;
  const defs: EnvParamDef[] = model.parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, group: p.group, def: p.def }));
  const manifest: ManifestLike = { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, group: d.group, def: d.def })) };
  const library: AssetIndex = {
    motions: Object.keys(DEMO_MOTIONS).map((name) => ({ name })),
    expressions: Object.keys(DEMO_EXPRESSIONS).map((name) => ({ name })),
    behaviors: [],
  };
  const assets: AssetStore = {
    motions: new Map(Object.entries(DEMO_MOTIONS)),
    expressions: new Map(Object.entries(DEMO_EXPRESSIONS)),
  };

  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed });
  const ing = new StreamIngestor({ manifest, library, assets, stack, env, seed });
  const index = demoBehaviorIndex();
  const provider: RuntimeProvider = opts.structured === true ? new StructuredEvalProvider() : new MockProvider();
  const engine = new DriverEngine({ index, provider, ing });

  const frames: EvalHarness["frames"] = [];
  const ev = new Evaluator(stack, env, defs, {
    apply(_c: string, params: Record<string, number>, tMs: number): void {
      frames.push({ t: tMs, params: { ...params } });
    },
  });
  const paramAt = (t: number): Record<string, number> => {
    // 最接近 t 的采样帧
    let best = frames[0];
    for (const f of frames) if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    return best?.params ?? {};
  };
  return { stack, env, index, provider, engine, ev, frames, paramAt };
}

const DT_MS = 16;

/** 单 case：dispatch → 确定性求值到断言窗口末端 → 逐断言评分。 */
export async function runCase(harness: EvalHarness, c: EvalCase): Promise<EvalResult> {
  const failures: string[] = [];
  const event = scenarioToEvent(c.scenario);
  const ctx: Context = { ...(c.scenario.context ?? {}), mood: c.scenario.mood ?? c.scenario.context?.mood };
  const disp = await harness.engine.dispatch(event, ctx);

  const maxWindow = Math.max(1000, ...c.expectedSemEffect.map((a) => a.windowMs[1]));
  const frameCount = Math.ceil(maxWindow / DT_MS);
  for (let i = 0; i < frameCount; i++) harness.ev.onFrame(DT_MS);

  for (const a of c.expectedSemEffect) {
    const [t0Raw, t1] = a.windowMs;
    const t0 = t0Raw === -1 ? 0 : t0Raw;
    if (a.sem !== undefined) {
      const inWindow = harness.frames.filter((f) => f.t >= t0 && f.t <= t1);
      const maxV = inWindow.reduce((m, f) => Math.max(m, f.params[a.sem!] ?? 0), -Infinity);
      if (a.min !== undefined && !(maxV >= a.min)) {
        failures.push(`窗口 [${t0},${t1}] sem '${a.sem}' 峰值 ${fmt(maxV)} 未达 min ${a.min}`);
      }
      if (a.max !== undefined && !(maxV <= a.max)) {
        failures.push(`窗口 [${t0},${t1}] sem '${a.sem}' 峰值 ${fmt(maxV)} 超过 max ${a.max}`);
      }
    }
    if (a.op !== undefined) {
      const inWindow = harness.engine.audit.filter((e) => e.tMs >= t0 && e.tMs <= t1);
      let hit = false;
      for (const e of inWindow) {
        try {
          const d = JSON.parse(e.line) as { op?: string; asset?: string; zoom?: number; outfit?: string };
          if (d.op !== a.op) continue;
          if (a.op === "play" && a.kinds !== undefined) {
            const kinds = harness.index.kindsOfAsset(d.asset ?? "");
            if (!a.kinds.some((k) => kinds.includes(k))) continue;
          } else if (a.op === "camera" && a.zoom !== undefined) {
            if (Number(d.zoom) !== a.zoom) continue;
          }
          hit = true;
          break;
        } catch {
          // 非 JSON / 解析失败行忽略
        }
      }
      if (!hit) {
        const extra = a.op === "camera" && a.zoom !== undefined ? ` zoom=${a.zoom}` : a.kinds ? ` kinds=${a.kinds.join("/")}` : "";
        failures.push(`窗口 [${t0},${t1}] 无 op '${a.op}'${extra}`);
      }
    }
  }
  return { id: c.id, pass: failures.length === 0, failures, hop: disp.hop, behaviorId: disp.behaviorId };
}

/** 批量执行全部 golden cases → 报告。 */
export async function runAllCases(modelJson: string, cases: EvalCase[]): Promise<EvalReport> {
  const results: EvalResult[] = [];
  for (const c of cases) {
    const harness = createEvalHarness(modelJson, c.scenario.seed ?? 42, { structured: c.scenario.structured });
    results.push(await runCase(harness, c));
  }
  const passed = results.filter((r) => r.pass).length;
  return { version: 1, clock: "fixed", total: results.length, passed, failed: results.length - passed, results };
}

function scenarioToEvent(s: EvalCase["scenario"]): DriverEvent {
  switch (s.event) {
    case "user_text": return { type: "user_text", text: s.userText ?? "" };
    case "user_voice": return { type: "user_voice", text: s.userText };
    case "emote": return { type: "emote", valence: s.mood?.valence ?? 0, arousal: s.mood?.arousal ?? 0 };
    default: return { type: s.event };
  }
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : String(v);
}

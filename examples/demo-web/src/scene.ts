// scene.ts —— demo 核心：JSONL → driver（StreamIngestor/LayerStack/EnvironmentLayer/Evaluator）
// → engine（L2dmPlayer 物理/形变）→ SoftwareRenderer（像素）。
// 无 DOM 依赖：浏览器（main.ts）与 Node 无头测试（test/demo.test.ts）共用同一核心。
//
// 演示动作集（语义曲线，motion3 Segments）：
//   微笑点头  —— 微笑 0→1→0（1s loop）
//   尾巴摇    —— 尾巴摆 0→1→0（1s loop）
//   害羞低头  —— 头转向 0→-20（0.8s 非 loop）
// 表情：开心（微笑 Add 0.3）

import {
  StreamIngestor,
  LayerStack,
  EnvironmentLayer,
  Evaluator,
  type ManifestLike,
  type AssetIndex,
  type AssetStore,
  type MotionLike,
  type EnvParamDef,
  type IngestResult,
} from "@l2dp/driver";
import {
  loadL2dm,
  L2dmPlayer,
  SoftwareRenderer,
  type L2dmModel,
} from "@l2dp/engine";

export interface DemoScene {
  /** 逐行注入 JSONL（在线流式）；返回坏行 reason（空 = 生效） */
  ingest(line: string, tMs: number): { ok: boolean; reason?: string };
  /** 推进一帧：driver 求值 → player 物理/形变 → 渲染 */
  onFrame(dtMs: number): void;
  /** 当前参数快照 */
  params(): Record<string, number>;
  /** 软件渲染器（readPixels 输出像素；浏览器端 putImageData） */
  renderer: SoftwareRenderer;
  /** 无头便捷：当前帧与基线是否不同（端到端断言用） */
  pixelsChanged(against: Uint8Array): boolean;
  stack: LayerStack;
  env: EnvironmentLayer;
}

export const DEMO_MOTIONS: Record<string, MotionLike> = {
  微笑点头: {
    durationMs: 1000, loop: true,
    curves: [{ id: "微笑", segments: [0, 0, 0, 0.5, 1, 0, 1, 0] }],
  },
  尾巴摇: {
    durationMs: 1000, loop: true,
    curves: [{ id: "尾巴摆", segments: [0, 0, 0, 0.5, 1, 0, 1, 0] }],
  },
  害羞低头: {
    durationMs: 800, loop: false,
    curves: [{ id: "头转向", segments: [0, 0, 0, 1, -20] }],
  },
};

export const DEMO_EXPRESSIONS = {
  开心: { parameters: [{ id: "微笑", value: 0.3, blend: "Add" as const }] },
};

export function createDemoScene(modelJson: string, seed = 42): DemoScene {
  const loaded = loadL2dm(modelJson);
  if (!loaded.ok) throw new Error(`demo.l2dm 加载失败: ${loaded.error}`);
  const model: L2dmModel = loaded.model;

  const defs: EnvParamDef[] = model.parameters.map((p) => ({
    id: p.id, min: p.min, max: p.max, group: p.group, def: p.def,
  }));
  const manifest: ManifestLike = {
    sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, group: d.group, def: d.def })),
  };
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
  const player = new L2dmPlayer(model, new Map());
  const renderer = new SoftwareRenderer();
  const evaluator = new Evaluator(stack, env, defs, {
    apply(_character: string, params: Record<string, number>): void {
      for (const [k, v] of Object.entries(params)) player.params.set(k, v);
    },
  });

  return {
    ingest(line: string, tMs: number): { ok: boolean; reason?: string } {
      const r: IngestResult = ing.feedLine(line, tMs);
      return r.skipped.length > 0 ? { ok: false, reason: r.skipped[0]!.reason } : { ok: true };
    },
    onFrame(dtMs: number): void {
      evaluator.onFrame(dtMs);
      player.tick(dtMs);
      player.render(renderer);
    },
    params(): Record<string, number> {
      const out: Record<string, number> = {};
      for (const d of model.parameters) out[d.id] = player.params.get(d.id);
      return out;
    },
    renderer,
    pixelsChanged(against: Uint8Array): boolean {
      const cur = renderer.readPixels();
      if (!cur || cur.length !== against.length) return true;
      for (let i = 0; i < cur.length; i++) if (cur[i] !== against[i]) return true;
      return false;
    },
    stack,
    env,
  };
}

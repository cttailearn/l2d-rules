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
  WebGL2Renderer,
  type L2dmModel,
  type RenderSink,
  type Tex2D,
  type TextureFilter,
} from "@l2dp/engine";

export interface DemoScene {
  /** 逐行注入 JSONL（在线流式）；返回坏行 reason（空 = 生效） */
  ingest(line: string, tMs: number): { ok: boolean; reason?: string };
  /** 推进一帧：driver 求值 → player 物理/形变 → 渲染 */
  onFrame(dtMs: number): void;
  /** 当前参数快照 */
  params(): Record<string, number>;
  /** 活动渲染器（软件光栅 或 WebGL2；readPixels 仅软件后端可用） */
  renderer: RenderSink;
  /** 渲染后端标识（UI 展示） */
  rendererKind: "software" | "webgl2";
  /** 纹理过滤（nearest=确定性基准，linear=官方平滑效果） */
  textureFilter: TextureFilter;
  /** 当前模型（UI：参数/部件/纹理统计） */
  model: L2dmModel;
  /** 非透明像素数（软件渲染器统计；WebGL2 返回 0） */
  countNonTransparent(): number;
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

export interface DemoSceneOptions {
  /** 已解码的纹理表（来自 .l2dm 内嵌 atlas / 外部文件）；缺省 = 纯色路径 */
  atlas?: Map<string, Tex2D>;
  seed?: number;
  /** 纹理过滤：nearest（默认，确定性/parity 基准）｜linear（浏览器展示「官方平滑效果」） */
  filter?: TextureFilter;
  /** 宿主传入的活动渲染器（如 WebGL2Renderer，直接渲到显示的 canvas）；缺省创建 SoftwareRenderer */
  sink?: RenderSink;
}

/** 兼容旧调用 createDemoScene(json, seedNumber)。 */
export function createDemoScene(modelJson: string, opts: number | DemoSceneOptions = {}): DemoScene {
  const o: DemoSceneOptions = typeof opts === "number" ? { seed: opts } : opts;
  const seed = o.seed ?? 42;
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
  const player = new L2dmPlayer(model, o.atlas ?? new Map());
  const renderer: RenderSink =
    o.sink ??
    new SoftwareRenderer(o.filter && o.filter !== "nearest" ? { filter: o.filter } : undefined);
  const rendererKind: "software" | "webgl2" =
    renderer instanceof WebGL2Renderer ? "webgl2" : "software";
  const textureFilter: TextureFilter =
    o.filter ?? (renderer instanceof SoftwareRenderer || renderer instanceof WebGL2Renderer
      ? renderer.textureFilter
      : "nearest");
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
    rendererKind,
    textureFilter,
    model,
    countNonTransparent(): number {
      return renderer instanceof SoftwareRenderer ? renderer.countNonTransparent() : 0;
    },
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

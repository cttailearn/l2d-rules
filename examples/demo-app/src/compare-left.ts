// compare-left.ts —— 左侧：当前项目自研引擎渲染（.l2dm + 软件光栅）
// 复用 `@l2dp/engine` 的 loadL2dm / L2dmPlayer / SoftwareRenderer；
// 用官方 motion3 的曲线（与 .l2dm.parameters 同 id 的 camelCase PARAM_*）驱动参数。
// 无 DOM 依赖；浏览器端（compare.ts）喂帧与读取像素。
import {
  loadL2dm,
  L2dmPlayer,
  SoftwareRenderer,
  sampleSegments,
  type L2dmModel,
  type Tex2D,
} from "@l2dp/engine";

export interface CompareMotionCurve {
  id: string;
  segments: number[];
}

export interface LeftCompare {
  model: L2dmModel;
  player: L2dmPlayer;
  renderer: SoftwareRenderer;
  /** 当前应用到模型（motion 曲线求值）的参数快照（id → 值） */
  driveCurves(curves: CompareMotionCurve[], tMs: number): void;
  /** 推进物理/形变并渲染一帧 */
  onFrame(dtMs: number): void;
  pixels(): Uint8Array | null;
  canvas: { width: number; height: number };
  /** 释放渲染资源（可选） */
  destroy?(): void;
}

/** 由 .l2dm JSON 构造左侧自研引擎并排实例。 */
export function createLeftCompare(modelJson: string, atlas?: Map<string, Tex2D>): LeftCompare {
  const loaded = loadL2dm(modelJson);
  if (!loaded.ok) throw new Error(`.l2dm 加载失败: ${loaded.error}`);
  const model: L2dmModel = loaded.model;

  const player = new L2dmPlayer(model, atlas ?? new Map());
  // linear：浏览器并排与官方右侧的平滑观感对齐（compare 页面；Node 确定性测试不受影响）
  const renderer = new SoftwareRenderer({ filter: "linear" });

  const paramSet = new Set(model.parameters.map((p) => p.id));

  return {
    model,
    player,
    renderer,
    canvas: { width: model.canvas.width, height: model.canvas.height },
    driveCurves(curves, tMs) {
      const tS = tMs / 1000;
      for (const c of curves) {
        if (!paramSet.has(c.id)) continue; // 只驱动本模型已有的参数
        player.params.set(c.id, sampleSegments(c.segments, tS));
      }
    },
    onFrame(dtMs) {
      player.tick(dtMs);
      player.render(renderer);
    },
    pixels() {
      return renderer.readPixels();
    },
  };
}

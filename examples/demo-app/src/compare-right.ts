// compare-right.ts —— 右侧：官方 Cubism SDK 渲染（pixi-live2d-display + Cubism 4 core）
// 通过 CDN 的全局 UMD（compare.html 中的 <script>）访问：PIXI（pixi.min.js）、
// PIXI.live2d（pixi-live2d-display）、Live2DModel。
// 官方 runtime 自行解析 .moc3 二进制 → 真实几何/形变，与左侧自研引擎形成对照基准。
// 本文件只做加载/播放封装，不复制官方 SDK 代码（运行时 CDN 加载，模型为本地合法文件）。

// ---- 全局类型声明（来自 CDN UMD，非本地依赖；宽松声明以容忍 UMD 无类型）----
interface PIXIApplication {
  view: HTMLCanvasElement;
  stage: { addChild(c: unknown): void };
  ticker: { add(fn: (deltaMs?: number) => void): void; stop(): void };
  destroy(removeView?: boolean, stageOptions?: unknown): void;
}
interface PIXIAppCtor {
  new (opts: Record<string, unknown>): PIXIApplication;
}

interface Live2DModelHandle {
  scale: { set(x: number, y: number): void };
  x: number;
  y: number;
  anchor: { set(x: number, y: number): void };
  internalModel?: {
    motionManager?: {
      startMotionPriority?(group: string, no: number, priority: number): object | null;
      play?(motion: unknown, priority: number): void;
    };
  };
  update?(dt: number): void;
  destroy?(opts?: { children?: boolean; texture?: boolean; baseTexture?: boolean }): void;
}

declare global {
  interface Window {
    PIXI?: {
      Application?: PIXIAppCtor;
      live2d?: {
        Live2DModel: {
          from(urlOrModel: string, opts?: Record<string, unknown>): Promise<Live2DModelHandle>;
        };
        MotionPriority?: { NORMAL?: number; FORCE?: number; IDLE?: number };
      };
    };
    Live2DModel?: {
      from(urlOrModel: string, opts?: Record<string, unknown>): Promise<Live2DModelHandle>;
    };
  }
}

export interface RightCompare {
  ready: boolean;
  error: string | null;
  playMotion(group: string, no: number): boolean;
  update(): void;
  destroy(): void;
}

const OFFICIAL_MODEL_URL = "/official-haru/Haru.model3.json"; // 预置回退（本页以上传 blob URL 驱动）

/**
 * 初始化右侧官方渲染：在 canvas 上创建 Pixi WebGL Application 并加载官方模型。
 * @param model3Url 官方 model3 的 blob/URL 地址（上传后重写的）；缺省用预置 /official-haru。
 * 加载/初始化失败 → 返回 { ready:false, error }，调用方显示 fallback（左侧不受影响）。
 */
export async function createRightCompare(canvas: HTMLCanvasElement, model3Url?: string): Promise<RightCompare> {
  const PIXI = window.PIXI;
  const Live2DModel = PIXI?.live2d?.Live2DModel ?? window.Live2DModel;

  if (!PIXI?.Application || !Live2DModel) {
    return {
      ready: false,
      error: "官方 Cubism runtime 未就绪（CDN 不可达/被拦截）——右侧仅显示提示，左侧自研引擎不受影响。",
      playMotion: () => false,
      update: () => {},
      destroy: () => {},
    };
  }

  let model: Live2DModelHandle | null = null;
  let app: PIXIApplication | null = null;
  const target = model3Url ?? OFFICIAL_MODEL_URL;

  try {
    model = await Live2DModel.from(target, { autoInteract: false });
    model.scale.set(1, 1);

    app = new PIXI.Application({ view: canvas, width: canvas.width, height: canvas.height, backgroundAlpha: 0 });
    app.stage.addChild(model);
    app.ticker.add(() => {
      try { model?.update?.((app?.ticker as unknown as { deltaMS?: number }).deltaMS ?? 16 / 1000); } catch { /* 忽略 */ }
    });

    return {
      ready: true,
      error: null,
      playMotion(group, no) {
        try {
          const mgr = model?.internalModel?.motionManager;
          const prio = PIXI?.live2d?.MotionPriority?.NORMAL ?? 2;
          const r = mgr?.startMotionPriority?.(group, no, prio);
          if (r === null && mgr?.play) mgr.play({ group, no }, prio);
          return true;
        } catch {
          return false;
        }
      },
      update() {
        // 正式渲染由 Application.ticker 驱动；此方法保留给需要手动 tick 的场景
      },
      destroy() {
        try { model?.destroy?.({ children: true }); } catch { /* 忽略 */ }
        try { app?.destroy(true); } catch { /* 忽略 */ }
      },
    };
  } catch (e) {
    try { model?.destroy?.(); } catch { /* 忽略 */ }
    try { app?.destroy(true); } catch { /* 忽略 */ }
    return {
      ready: false,
      error: `官方模型/SDK 加载失败: ${(e as Error).message}（请先运行 npm run prepare:official）`,
      playMotion: () => false,
      update: () => {},
      destroy: () => {},
    };
  }
}

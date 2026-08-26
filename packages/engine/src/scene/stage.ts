// scene/stage.ts —— 场景舞台（P6「scene 舞台」）：多角色 + 相机(pan/zoom) + 背景合成
// 把多个 L2dmPlayer 合成到同一 RenderSink（软件/WebGL2 皆可）：
//   sink.begin(stageW,H) → 背景全屏区 → 逐子级按 z 排序 renderFrame(view) → sink.end。
// 相机 = 世界坐标视心 + zoom：stage = (world - camera.x/y) * zoom；子级另有自身 x/y(世界位置)/scale。
// 确定性：合成顺序固定（z 排序 + 插入序），view 为仿射，无随机。

import { L2dmPlayer, type ViewTransform } from "../player/player.ts";
import type { RenderSink, Tex2D } from "../render/sink.ts";

export interface StageChild {
  id: string;
  player: L2dmPlayer;
  /** 角色纹理（model.atlas 引用；缺省空图集 = 纯色件） */
  atlas?: Map<string, Tex2D>;
  /** 子级在世界坐标的左上角位置（缺省 0,0） */
  x?: number;
  y?: number;
  /** 子级缩放（相对模型画布；缺省 1） */
  scale?: number;
  /** 绘制层级（越大越后绘制、越靠前；缺省 0） */
  z?: number;
}

export interface StageCamera {
  /** 视心（世界坐标）；stage = (world - x/y) * zoom */
  x: number;
  y: number;
  zoom: number;
}

export interface SceneStageOptions {
  camera?: StageCamera;
  /** 背景纯色 RGBA 0..255（缺省透明黑 [0,0,0,0]） */
  background?: [number, number, number, number];
}

const DEFAULT_CAMERA: StageCamera = { x: 0, y: 0, zoom: 1 };

interface CameraAnim {
  from: StageCamera;
  to: StageCamera;
  startMs: number;
  durMs: number;
}

/** 平滑步进缓动（确定性，无外部随机）。 */
function ease01(t: number): number {
  return t * t * (3 - 2 * t); // smoothstep
}

/** 场景舞台：多角色编排合成器（SDK 侧最小实现；宿主 UI/多角色布局仍属宿主前端）。 */
export class SceneStage {
  private readonly children = new Map<string, StageChild>();
  private readonly width: number;
  private readonly height: number;
  camera: StageCamera;
  background: [number, number, number, number];

  /** 内部时钟（供 panTo/zoomTo 缓动；宿主每帧调 tick(dt) 推进；确定性受 dt 序列约束） */
  private clockMs = 0;
  private anim: CameraAnim | null = null;

  constructor(canvas: { width: number; height: number }, opts: SceneStageOptions = {}) {
    this.width = canvas.width;
    this.height = canvas.height;
    this.camera = opts.camera ?? { ...DEFAULT_CAMERA };
    this.background = opts.background ?? [0, 0, 0, 0];
  }

  /** 推进内部时钟并插值相机动画（宿主每帧调用；不调 = 相机静止/无动画推进）。 */
  tick(dtMs: number): void {
    this.clockMs += Math.max(0, dtMs);
    if (this.anim === null) return;
    const a = this.anim;
    const t = Math.min(1, Math.max(0, (this.clockMs - a.startMs) / Math.max(1, a.durMs)));
    const k = ease01(t);
    this.camera = {
      x: a.from.x + (a.to.x - a.from.x) * k,
      y: a.from.y + (a.to.y - a.from.y) * k,
      zoom: a.from.zoom + (a.to.zoom - a.from.zoom) * k,
    };
    if (t >= 1) {
      this.camera = { ...a.to };
      this.anim = null;
    }
  }

  /** 立即设置相机（中止动画）。 */
  setCamera(cam: StageCamera): void {
    this.camera = { ...cam };
    this.anim = null;
  }

  /** 相机缓动到目标位置（世界坐标视心）。durMs<=0 立即落位。 */
  panTo(x: number, y: number, durMs = 300): void {
    const to: StageCamera = { x, y, zoom: this.camera.zoom };
    if (durMs <= 0) {
      this.camera = to;
      this.anim = null;
      return;
    }
    this.anim = { from: { ...this.camera }, to, startMs: this.clockMs, durMs };
  }

  /** 相机缓动缩放（zoom>0）。durMs<=0 立即落位。 */
  zoomTo(z: number, durMs = 300): void {
    const to: StageCamera = { x: this.camera.x, y: this.camera.y, zoom: z > 0 ? z : 1 };
    if (durMs <= 0) {
      this.camera = to;
      this.anim = null;
      return;
    }
    this.anim = { from: { ...this.camera }, to, startMs: this.clockMs, durMs };
  }

  /** 当前相机（测试/宿主读取用）。 */
  currentCamera(): StageCamera {
    return { ...this.camera };
  }

  /** 设置/替换子级（同 id 覆盖）。 */
  setChild(child: StageChild): void {
    this.children.set(child.id, child);
  }

  removeChild(id: string): boolean {
    return this.children.delete(id);
  }

  childIds(): string[] {
    return [...this.children.keys()];
  }

  /** 合成一帧到 sink（begin/end 由本方法管理）。 */
  render(sink: RenderSink): void {
    sink.begin(this.width, this.height);

    // 背景（非透明时画全屏纯色区）
    const [br, bg, bb, ba] = this.background;
    if (ba > 0) {
      sink.draw({
        verts: new Float32Array([0, 0, this.width, 0, this.width, this.height, 0, this.height]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: [0, 1, 2, 0, 2, 3],
        texId: null,
        color: [br, bg, bb, ba],
      });
    }

    const sorted = [...this.children.values()].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    for (const c of sorted) {
      const zoom = this.camera.zoom > 0 ? this.camera.zoom : 1;
      const scale = (c.scale ?? 1) * zoom;
      const view: ViewTransform = {
        offsetX: ((c.x ?? 0) - this.camera.x) * zoom,
        offsetY: ((c.y ?? 0) - this.camera.y) * zoom,
        scale,
      };
      c.player.renderFrame(sink, scale !== 1 || view.offsetX !== 0 || view.offsetY !== 0 ? view : undefined);
    }

    sink.end();
  }
}

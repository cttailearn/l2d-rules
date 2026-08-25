// L2dmPlayer —— 加载→逐帧 PLAYER（DEVELOPMENT-SPEC §5.8）
// 职责：持有模型 + 参数面；tick 逐帧（动作采样 → 物理 → pose/层级/形变在 render 计算）；
// render 把当前帧输出到 RenderSink。
//
// 坐标契约（本文件为唯一权威）：
//   - Part.mesh.vertices 为 **画布像素坐标**（y 向下，绝对），warp 偏移同空间
//   - part.parent（deformer）若有：顶点经 deformer 世界矩阵变换（画布空间内 TRS）
//   - Part.texture → atlas 键；mesh.uvs（0..1）经 uvRect 重映射到图集子矩形
//   - Part.color 为 **0..1** RGBA（与格式 fixture 一致；渲染前转 0..255）
//   - pose 联动组（L2dmPose.groups）：组内互斥——仅 opacity 最高者可见
//
// 确定性：physics 固定子步、motion 采样纯函数、无 Date.now；同 (模型, 动作, dt 序列) 同输出。

import type { L2dmModel, L2dmPart } from "../format/types.ts";
import type { RenderSink, Tex2D } from "../render/sink.ts";
import { ParameterStore } from "../runtime/parameter-store.ts";
import { resolveDeformerMatrices, applyAffine } from "../runtime/hierarchy.ts";
import { accumulateKeyforms, accumulateKeyforms2D } from "../runtime/deform.ts";
import { PendulumSim } from "../runtime/physics.ts";
import type { SeededRandom } from "../runtime/random.ts";
import { applyMotion, type EngineMotion } from "./motion.ts";

export interface ViewTransform {
  /** 舞台/相机平移（画布像素，y 向下） */
  offsetX: number;
  offsetY: number;
  /** 统一缩放（>0） */
  scale: number;
}

export class L2dmPlayer {
  /** 参数面：外部驱动（LLM/环境层/动作）每帧写入；引擎每帧读取。 */
  readonly params: ParameterStore;
  private readonly model: L2dmModel;
  private readonly atlas: Map<string, Tex2D>;
  private readonly physics: PendulumSim;
  private motion: EngineMotion | null = null;
  private motionT = 0;

  constructor(model: L2dmModel, atlas: Map<string, Tex2D>) {
    this.model = model;
    this.atlas = atlas;
    this.params = new ParameterStore(model.parameters);
    this.physics = new PendulumSim(model.physics?.pendulums ?? []);
  }

  /** 播放动作（null 停止并从 0 计时）。 */
  play(motion: EngineMotion | null): void {
    this.motion = motion;
    this.motionT = 0;
  }

  get playing(): boolean {
    return this.motion !== null;
  }

  /**
   * 推进一帧：动作采样 → 物理（pose/层级/形变由 render 纯函数计算）。
   * seed 预留（§5.8 签名契约；M5 环境层噪声注入用，当前引擎路径确定性无随机）。
   */
  tick(dtMs: number, _seed?: SeededRandom): void {
    if (this.motion !== null) {
      this.motionT += dtMs;
      if (this.motionT >= this.motion.durationMs) {
        if (this.motion.loop) {
          this.motionT %= this.motion.durationMs;
          applyMotion(this.motion, this.motionT, this.params);
        } else {
          applyMotion(this.motion, this.motion.durationMs, this.params); // 停在末帧
          this.motion = null;
        }
      } else {
        applyMotion(this.motion, this.motionT, this.params);
      }
    }
    this.physics.step(dtMs, this.params);
  }

  /** 输出当前帧到 RenderSink（uploadTexture 幂等 → begin → 逐 part 绘制 → end）。 */
  render(out: RenderSink, view?: ViewTransform): void {
    const { width, height } = this.model.canvas;
    out.begin(width, height);
    this.renderFrame(out, view);
    out.end();
  }

  /**
   * 只绘制本帧部件（uploadTexture + 逐 part draw），不调用 begin/end。
   * 供 SceneStage 把多角色合成到同一舞台 sink；view 施加舞台/相机变换。
   */
  renderFrame(out: RenderSink, view?: ViewTransform): void {
    for (const [id, tex] of this.atlas) out.uploadTexture(id, tex);
    const worlds = resolveDeformerMatrices(this.model.deformers ?? [], this.params);
    const parts = [...this.model.parts].sort((a, b) => a.order - b.order);
    const visibility = this.poseVisibility(parts);
    for (const part of parts) {
      if (!this.partVisible(part, visibility)) continue;
      const mesh = part.mesh;
      if (!mesh || mesh.indices.length === 0) continue;

      // 1) 网格形变：rest 拷贝 + 1D/2D warp 累加偏移（同空间）
      const verts = new Float32Array(mesh.vertices.length);
      verts.set(mesh.vertices);
      for (const warp of mesh.warps ?? []) {
        accumulateKeyforms(warp.keyforms, this.params.get(warp.parameter), verts);
      }
      for (const w2 of mesh.warp2d ?? []) {
        const [px, py] = w2.parameters;
        accumulateKeyforms2D(w2.valuesX, w2.valuesY, w2.keyforms, this.params.get(px), this.params.get(py), verts);
      }

      // 2) 层级变换（若有父 deformer）
      if (part.parent !== undefined) {
        const w = worlds.get(part.parent);
        if (w) {
          for (let i = 0; i < verts.length; i += 2) {
            const [x, y] = applyAffine(w, verts[i]!, verts[i + 1]!);
            verts[i] = x;
            verts[i + 1] = y;
          }
        }
      }

      // 2.5) 舞台/相机变换（SceneStage 合成；缺省恒等）
      if (view !== undefined && (view.scale !== 1 || view.offsetX !== 0 || view.offsetY !== 0)) {
        const s = view.scale;
        for (let i = 0; i < verts.length; i += 2) {
          verts[i] = verts[i]! * s + view.offsetX;
          verts[i + 1] = verts[i + 1]! * s + view.offsetY;
        }
      }

      // 3) UV（uvRect 重映射）
      const uvs = new Float32Array(mesh.uvs.length);
      const r = part.uvRect;
      for (let i = 0; i < uvs.length; i += 2) {
        let u = mesh.uvs[i]!;
        let v = mesh.uvs[i + 1]!;
        if (r) {
          u = r.x + u * r.width;
          v = r.y + v * r.height;
        }
        uvs[i] = u;
        uvs[i + 1] = v;
      }

      // 4) 颜色：part.color 0..1 → 渲染 0..255；alpha × opacity
      const c = part.color ?? [1, 1, 1, 1];
      const opacity = this.partOpacity(part);
      const color: [number, number, number, number] = [
        Math.round(c[0]! * 255),
        Math.round(c[1]! * 255),
        Math.round(c[2]! * 255),
        Math.round(c[3]! * opacity * 255),
      ];

      out.draw({
        verts,
        uvs,
        indices: mesh.indices,
        texId: part.texture ?? null,
        color,
      });
    }
  }

  private partOpacity(part: L2dmPart): number {
    if (part.opacityParam === undefined) return 1;
    return this.params.normalized(part.opacityParam);
  }

  private partVisible(part: L2dmPart, visibility: Map<string, boolean>): boolean {
    if (visibility.get(part.id) === false) return false;
    return this.partOpacity(part) > 0;
  }

  /** pose 联动组：组内互斥（仅 opacity 最高者可见）；无 pose 时全部可见。 */
  private poseVisibility(parts: L2dmPart[]): Map<string, boolean> {
    const vis = new Map<string, boolean>();
    for (const g of this.model.pose?.groups ?? []) {
      let best: string | null = null;
      let bestOp = -1;
      for (const id of g.ids) {
        const p = parts.find((pp) => pp.id === id);
        const op = p ? this.partOpacity(p) : 0;
        if (op > bestOp) {
          bestOp = op;
          best = id;
        }
      }
      for (const id of g.ids) vis.set(id, id === best);
    }
    return vis;
  }
}

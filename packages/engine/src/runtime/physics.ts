// 摆锤物理 pendulum —— DEVELOPMENT-SPEC §5.6
// 输入参数 → 延迟+加速 → 输出参数（发丝/部件跟随）。固定子步阻尼弹簧，确定性。
// 从 renderer/physics.ts 迁移并适配 L2dmPhysics 格式，按 §5.6 契约式积分：
//   next = cur + (input - cur)·accel·h - cur·delay·DAMP·h   （一阶阻尼弹簧）
// 固定子步（16ms 基准，dt 均匀切分取整）保证：同 (dt 序列, 输入) → 同输出；收敛、无振荡发散。

import type { L2dmPhysics } from "../format/types.ts";
import type { ParameterStore } from "./parameter-store.ts";

const FIXED_DT = 16; // 子步基准 ms
const DAMP = 0.5; // 阻尼缩放常量（§5.6 公式内的 damping 系数）

export class PendulumSim {
  /** outputParam → 当前归一化位置 0..1（内部统一空间，写出时映射到参数范围） */
  private state = new Map<string, number>();
  private defs: L2dmPhysics["pendulums"];

  constructor(defs: L2dmPhysics["pendulums"]) {
    this.defs = defs;
  }

  /** 一步积分：以固定子步推进；结果写入 params（参数面 = 物理输出，钳制在参数范围）。 */
  step(dtMs: number, params: ParameterStore): void {
    // ponytail: 子步数取整、均匀切分；同 dt 序列 → 同输出。若需可变帧率抖动，加插值层即可。
    const steps = Math.max(1, Math.round(dtMs / FIXED_DT));
    const h = dtMs / steps / FIXED_DT;
    for (let s = 0; s < steps; s++) {
      for (const p of this.defs) {
        const input = params.normalized(p.input); // 输入参数归一化位置 0..1
        for (const outId of p.outputParams) {
          const cur = this.state.get(outId) ?? input;
          const accel = p.acceleration;
          const delay = p.delay;
          const next = cur + (input - cur) * accel * h - cur * delay * DAMP * h;
          this.state.set(outId, next);
          const r = params.range(outId);
          if (r !== null) params.set(outId, r.min + next * (r.max - r.min));
        }
      }
    }
  }

  /** 读内部归一化状态（测试辅助） */
  get(id: string): number | undefined {
    return this.state.get(id);
  }

  /** 直接设定状态（测试辅助/接续） */
  setPos(id: string, v: number): void {
    this.state.set(id, v);
  }

  reset(): void {
    this.state.clear();
  }
}

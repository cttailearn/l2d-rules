// ParameterStore —— 引擎参数面 = ParameterSink 目标（DEVELOPMENT-SPEC §5.3）
// 参照 Iki parameter-store：set 钳制、未知 id 忽略、get/normalized/reset/list。
// 确定性：不持有 Date.now，纯状态读写。

import type { L2dmParameter } from "../format/types.ts";

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * 持有模型每个参数的实时值（钳制在其声明范围）。
 * 外部驱动面（LLM JSONL / 环境层 / 动作采样）每帧写入 set(id, value)；
 * 引擎（形变/physics）每帧读 get(id)。
 */
export class ParameterStore {
  private readonly defs = new Map<string, L2dmParameter>();
  private readonly values = new Map<string, number>();

  constructor(parameters: L2dmParameter[]) {
    for (const p of parameters) {
      this.defs.set(p.id, p);
      const d = p.def ?? 0;
      this.values.set(p.id, clamp(d, p.min, p.max));
    }
  }

  /** 设置参数值（钳制到范围）；未知 id 忽略（安全，多部位任意模型友好）。 */
  set(id: string, value: number): boolean {
    const def = this.defs.get(id);
    if (!def) return false;
    this.values.set(id, clamp(value, def.min, def.max));
    return true;
  }

  /** 当前值；未知 id 返回 0。 */
  get(id: string): number {
    return this.values.get(id) ?? 0;
  }

  /** 参数在自身范围内的位置 0..1（min==max 时返回 0）。 */
  normalized(id: string): number {
    const def = this.defs.get(id);
    if (!def || def.max === def.min) return 0;
    return (this.get(id) - def.min) / (def.max - def.min);
  }

  /** 参数声明范围；未知 id 返回 null。 */
  range(id: string): { min: number; max: number } | null {
    const d = this.defs.get(id);
    return d !== undefined ? { min: d.min, max: d.max } : null;
  }

  /** 全部重置为声明默认值（或 0）。 */
  reset(): void {
    for (const def of this.defs.values()) {
      const d = def.def ?? 0;
      this.values.set(def.id, clamp(d, def.min, def.max));
    }
  }

  /** 遍历所有参数定义。 */
  list(): L2dmParameter[] {
    return [...this.defs.values()];
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }
}

// Evaluator —— 每帧聚合 → ParameterSink —— DEVELOPMENT-SPEC §6.5
// onFrame(dtMs)：
//   t += dtMs → env.tick(t)（环境层贡献）→ stack.tick(env, t)（分层合成）
//   → 默认值打底 + 全量 clamp → sink.apply("main", params, t)
//
// 确定性：不持有 Date.now，全部时间来自 dtMs 累加；同 (指令序列, dtMs 序列) 同轨迹。

import type { EnvParamDef } from "../layers/environment.ts";
import type { LayerStack } from "../layers/layer-stack.ts";
import type { EnvironmentLayer } from "../layers/environment.ts";

/** 每帧参数写入：只写不回读（ARCHITECTURE §2）。宿主实现渲染器/VTube/无头录像器。 */
export interface ParameterSink {
  apply(character: string, params: Record<string, number>, tMs: number): void;
}

export class Evaluator {
  private t = 0;
  private readonly stack: LayerStack;
  private readonly env: EnvironmentLayer;
  private readonly defs: Map<string, EnvParamDef>;
  private readonly sink: ParameterSink;

  constructor(
    stack: LayerStack,
    env: EnvironmentLayer,
    defs: EnvParamDef[],
    sink: ParameterSink,
  ) {
    this.stack = stack;
    this.env = env;
    this.defs = new Map(defs.map((d) => [d.id, d]));
    this.sink = sink;
  }

  onFrame(dtMs: number): void {
    this.t += Math.max(0, dtMs);
    const envContrib = this.env.tick(this.t);
    const merged = this.stack.tick(envContrib, this.t);
    const out: Record<string, number> = {};
    for (const d of this.defs.values()) out[d.id] = d.def ?? 0;
    for (const [k, v] of Object.entries(merged)) {
      const def = this.defs.get(k);
      out[k] = def ? clamp(v, def.min, def.max) : v;
    }
    this.sink.apply("main", out, this.t);
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// physics3 简易摆锤积分：输入参数加权 → 输出参数（阻尼弹簧），确定性可测
export interface PendulumDef {
  id: string;
  input: { sourceParamId: string; weight: number; type: "X" | "Angle"; reflect: boolean }[];
  output: { destinationParamId: string; vertexIndex: number; scale: number; weight: number; type: "X" | "Angle"; reflect: boolean }[];
  vertices: { mobility: number; delay: number; acceleration: number; radius: number }[];
  normalization: { position: { min: number; def: number; max: number }; angle: { min: number; def: number; max: number } };
}

export class PendulumSim {
  private vel = new Map<string, number>();
  private pos = new Map<string, number>();
  private dtMs: number;
  private defs: PendulumDef[];

  constructor(defs: PendulumDef[], dtMs = 16) { this.defs = defs; this.dtMs = dtMs; }

  // 一步积分：输入参数 → 目标角速度 → 弹簧收敛
  step(inputs: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const def of this.defs) {
      let drive = 0;
      for (const inp of def.input) {
        const v = inputs[inp.sourceParamId] ?? 0;
        drive += v * (inp.weight / 100);
      }
      for (const o of def.output) {
        const key = o.destinationParamId;
        const cur = this.pos.get(key) ?? 0;
        const target = drive * (o.scale ?? 1);
        const stiff = def.vertices[o.vertexIndex]?.acceleration ?? 1;
        const damp = def.vertices[o.vertexIndex]?.delay ?? 1;
        const accel = (target - cur) * stiff * (this.dtMs / 1000) * 60;
        const nextVel = (this.vel.get(key) ?? 0) + accel;
        const damped = nextVel * Math.max(0, 1 - damp * (this.dtMs / 1000) * 10);
        const next = cur + damped * (this.dtMs / 1000) * 60;
        this.vel.set(key, damped);
        this.pos.set(key, next);
        out[key] = next;
      }
    }
    return out;
  }

  // 确定性测试辅助：直接设定状态
  setPos(key: string, v: number): void { this.pos.set(key, v); }
  reset(): void { this.vel.clear(); this.pos.clear(); }
}

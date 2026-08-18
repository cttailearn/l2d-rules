// 参数集与求值管线（规格 10.3 T4）：唯一求值实现
export interface ParamDef { id: string; min: number; max: number; def: number; }
export type ExprBlend = "Add" | "Multiply" | "Overwrite";

export interface Expression { name: string; values: { id: string; value: number; blend: ExprBlend }[]; }

export class ParamSet {
  private defs = new Map<string, ParamDef>();
  private base = new Map<string, number>();      // 动作曲线结果
  private userOverride = new Map<string, number>();
  private physicsOut = new Map<string, number>();

  constructor(defs: ParamDef[]) { for (const d of defs) { this.defs.set(d.id, d); this.base.set(d.id, d.def); } }

  setMotion(id: string, v: number): void { this.base.set(id, clampV(v, this.defs.get(id))); }
  setMotionMany(values: Record<string, number>): void { for (const [k, v] of Object.entries(values)) this.setMotion(k, v); }
  setOverride(id: string, v: number): void { this.userOverride.set(id, clampV(v, this.defs.get(id))); }
  setOverrideMany(values: Record<string, number>): void { for (const [k, v] of Object.entries(values)) this.setOverride(k, v); }
  setPhysicsOut(id: string, v: number): void { this.physicsOut.set(id, clampV(v, this.defs.get(id))); }

  has(id: string): boolean { return this.defs.has(id); }

  // 应用表情（Add/Multiply/Overwrite 语义与 exp3 一致），作用于 base
  applyExpression(expr: Expression | null): void {
    if (!expr) return;
    for (const p of expr.values) {
      if (!this.defs.has(p.id)) continue;
      const cur = this.base.get(p.id) ?? 0;
      let next: number;
      if (p.blend === "Add") next = cur + p.value;
      else if (p.blend === "Multiply") next = cur * p.value;
      else next = p.value; // Overwrite
      this.base.set(p.id, clampV(next, this.defs.get(p.id)));
    }
  }

  // 最终求值：物理输出覆盖位移类参数（若未定义），用户 override 最高
  final(id: string): number {
    if (this.userOverride.has(id)) return this.userOverride.get(id)!;
    if (this.physicsOut.has(id)) return this.physicsOut.get(id)!;
    return this.base.get(id) ?? 0;
  }

  values(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of this.defs.keys()) out[id] = this.final(id);
    return out;
  }
}

export function clampV(v: number, def?: ParamDef): number {
  if (!def) return v;
  return Math.min(def.max, Math.max(def.min, v));
}

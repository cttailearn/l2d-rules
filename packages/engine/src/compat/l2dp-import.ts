// compat —— DSL 编译产物 → 引擎资产（DEVELOPMENT-SPEC §5.9 / C11）
// 入参必须是 semantic:true 编译产物（曲线/参数 id 已是语义名，与 .l2dm.parameters 直接对应）。
// 若收到非语义产物（PARAM_* 官方 id 轨道）→ 拒绝并报错，**不做隐式反向映射**（运行时猜谜）。
// 引擎 parse 语义：motion3/exp3 结构形状不变，仅 id 值域不同（§8 C11）。

import { isStandardParam } from "@l2dp/l2dp";
import type { Expression as Expression3, Motion as Motion3 } from "@l2dp/l2dp";
import type { EngineMotion } from "../player/motion.ts";

export type ImportResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 校验语义 id：官方 PARAM_* 白名单参数 = 非语义产物。 */
function semanticId(id: string): boolean {
  return !isStandardParam(id);
}

/** motion3 → EngineMotion（语义产物）；非语义轨道拒绝。 */
export function importMotion3(m: Motion3): ImportResult<EngineMotion> {
  for (const c of m.curves) {
    if (!semanticId(c.id)) {
      return {
        ok: false,
        error: `motion 含非语义轨道 '${c.id}'（官方 PARAM id）——需 semantic:true 编译产物重生成`,
      };
    }
  }
  return {
    ok: true,
    value: {
      durationMs: Math.round((m.meta.duration ?? 0) * 1000),
      loop: m.meta.loop ?? false,
      curves: m.curves.map((c) => ({ id: c.id, segments: c.segments })),
    },
  };
}

export interface EngineExpression {
  /** 表情参数（语义 id；值域 = 参数自身范围） */
  parameters: { id: string; value: number; blend: "Add" | "Multiply" | "Overwrite" }[];
}

/** exp3 → 引擎表情；非语义参数拒绝。 */
export function importExpression3(e: Expression3): ImportResult<EngineExpression> {
  for (const p of e.parameters) {
    if (!semanticId(p.id)) {
      return {
        ok: false,
        error: `expression 含非语义参数 '${p.id}'（官方 PARAM id）——需 semantic:true 编译产物重生成`,
      };
    }
  }
  return {
    ok: true,
    value: {
      parameters: e.parameters.map((p) => ({ id: p.id, value: p.value, blend: p.blend })),
    },
  };
}

/** 应用表情到参数面（blend 语义：Add 在基础值上相加 / Multiply 相乘 / Overwrite 直接覆盖）。 */
export function applyExpression(
  exp: EngineExpression,
  params: { get(id: string): number; set(id: string, v: number): boolean },
): void {
  for (const p of exp.parameters) {
    const base = params.get(p.id);
    switch (p.blend) {
      case "Add": params.set(p.id, base + p.value); break;
      case "Multiply": params.set(p.id, base * (p.value / 100)); break;
      case "Overwrite": params.set(p.id, p.value); break;
      default: params.set(p.id, p.value); break; // 未知 blend 按覆盖处理（防御）
    }
  }
}

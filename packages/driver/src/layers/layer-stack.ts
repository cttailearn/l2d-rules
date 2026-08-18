// LayerStack —— 分层求值（每帧合成）—— DEVELOPMENT-SPEC §6.3
// L1 行为层：play（动作曲线；interrupt: target|supersede|queue）
// L2 表达层：face（表情 Add/Mult/Overwrite，weight 混合）——单前层（新 face 覆盖旧）
// L3 override 层：set（恒定目标，最高优先；同 sem 后者胜）
// L0 环境层由 EnvironmentLayer 提供贡献，经 tick(env) 注入（规格 §6.3 合成顺序）。
//
// 合成顺序（规格 6.3，唯一权威）：
//   base = 动作层曲线（时间缩放 t'=t/speed；同层同 sem → 最近层胜出——最小集 §4.4）
//   base = 表情层 blend 应用
//   val  = clamp(base + 环境层贡献 × α_ambient)
//        —— override 层：命中 sem → val = override 值（最高）
//   最终 = clamp(val, param.min, param.max)
//
// 确定性：不持有 Date.now；全部时间来自注入 tMs。同 (指令序列, tMs 序列) 同输出。
//
// 实现注：每个 target 至多一个活动 play（interrupt 语义天然单前层），
// 故"同层同 sem 冲突"只发生在 play vs 后续层（face/set/env），由合成顺序保证。
// loop 动作永不结束——其后的 queue/supersede 恢复不会触发（文档化）。

import { sampleSegments } from "@l2dp/engine";
import type { Directive, ExpressionLike, MotionLike, ResolvedDirective } from "../ir/types.ts";
import type { EnvParamDef } from "./environment.ts";

export type { ExpressionLike, MotionLike } from "../ir/types.ts";

interface PlayLayer {
  target: string;
  motion: MotionLike;
  startMs: number;
  speed: number;
  /** 被 supersede 时记录的现场（已缩放 elapsed ms）；恢复时重建 startMs */
  suspendedElapsed?: number;
}

interface FaceLayer {
  target: string;
  params: ExpressionLike["parameters"];
  weight: number;
}

interface TargetState {
  active: PlayLayer | null;
  queue: PlayLayer[];
  suspended: PlayLayer | null;
}

function targetState(states: Map<string, TargetState>, target: string): TargetState {
  let s = states.get(target);
  if (!s) {
    s = { active: null, queue: [], suspended: null };
    states.set(target, s);
  }
  return s;
}

export class LayerStack {
  private readonly defs = new Map<string, EnvParamDef>();
  private readonly states = new Map<string, TargetState>();
  private readonly faces = new Map<string, FaceLayer>();
  private readonly overrides = new Map<string, number>();

  constructor(params: EnvParamDef[]) {
    for (const p of params) this.defs.set(p.id, p);
  }

  /** 分层路由入口：play→动作层 / face→表达层 / set→override 层（其余 op 由 ingestor 分发给 env/宿主）。 */
  push(d: ResolvedDirective, startMs: number): void {
    const target = d.target ?? "main";
    switch (d.op) {
      case "play": {
        const st = targetState(this.states, target);
        const layer: PlayLayer = {
          target,
          motion: d._motion!,
          startMs,
          speed: d.speed ?? 1,
        };
        const mode = d.interrupt ?? "target";
        if (mode === "queue") {
          if (st.active) {
            st.queue.push(layer);
            return;
          }
          st.active = layer;
          return;
        }
        if (mode === "supersede" && st.active) {
          st.suspended = {
            ...st.active,
            suspendedElapsed: (startMs - st.active.startMs) / st.active.speed,
          };
        }
        st.active = layer;
        return;
      }
      case "face":
        this.faces.set(target, {
          target,
          params: d._expression!.parameters,
          weight: d.weight ?? 1,
        });
        return;
      case "set":
        // 同 sem 后者胜（override 层）
        this.overrides.set(d.sem!, d.value!);
        return;
      default:
        return; // 不属本层栈（防御；ingestor 已路由）
    }
  }

  /** 每帧合成：env 贡献注入后返回本帧参数字典（仅含被任何层命中的 sem；未命中由 Evaluator 打底默认值）。 */
  tick(env: Record<string, number>, tMs: number): Record<string, number> {
    const base: Record<string, number> = {};

    // ---- L1 动作层（含结束→接替：恢复 supersede 现场 / 启动队首）----
    for (const st of this.states.values()) {
      for (;;) {
        const l = st.active;
        if (!l) break;
        const elapsed = (tMs - l.startMs) / l.speed;
        if (l.motion.loop || elapsed < l.motion.durationMs) {
          const durMs = l.motion.durationMs;
          // loop：在时长内取模（与 engine Player 一致）；否则钳到曲线尾
          const tS = (l.motion.loop && durMs > 0 ? elapsed % durMs : elapsed) / 1000;
          for (const c of l.motion.curves) {
            base[c.id] = sampleSegments(c.segments, tS);
          }
          break;
        }
        // 动作播完（非 loop）→ 移除并接替
        st.active = null;
        if (st.suspended) {
          st.active = st.suspended;
          st.suspended = null;
          const sp = st.active.speed;
          st.active.startMs = tMs - st.active.suspendedElapsed! * sp;
        } else if (st.queue.length > 0) {
          st.active = st.queue.shift()!;
          st.active.startMs = tMs;
        } else {
          break;
        }
      }
    }

    // ---- L2 表达层（blend + weight）----
    for (const f of this.faces.values()) {
      for (const p of f.params) {
        const cur = base[p.id] ?? this.defaultOf(p.id);
        switch (p.blend) {
          case "Add":
            base[p.id] = cur + p.value * f.weight;
            break;
          case "Multiply":
            base[p.id] = cur * (1 + (p.value / 100 - 1) * f.weight);
            break;
          case "Overwrite":
            base[p.id] = cur + (p.value - cur) * f.weight;
            break;
        }
      }
    }

    // ---- L0 环境层贡献（α_ambient 已含在 env 输出内）----
    for (const [sem, contrib] of Object.entries(env)) {
      const r = this.range(sem);
      if (!r) continue;
      base[sem] = clamp((base[sem] ?? this.defaultOf(sem)) + contrib, r.min, r.max);
    }

    // ---- L3 override（最高）----
    for (const [sem, v] of this.overrides) {
      const r = this.range(sem);
      if (!r) continue;
      base[sem] = clamp(v, r.min, r.max);
    }
    return base;
  }

  /** override 层当前内容（测试断言用） */
  overrideSnapshot(): Record<string, number> {
    return Object.fromEntries(this.overrides);
  }

  private defaultOf(id: string): number {
    return this.defs.get(id)?.def ?? 0;
  }

  private range(id: string): { min: number; max: number } | null {
    const d = this.defs.get(id);
    return d ? { min: d.min, max: d.max } : null;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// StreamIngestor —— JSONL 流式驱动（在线逐行 / 离线整批）—— DEVELOPMENT-SPEC §6.2 / §7
// 语义：一行 = 一个层上的一个动作。行级原子、坏行隔离不阻塞（§7.1/7.2）。
//
// 双模式校验（§7.3，规则库一套，执行策略不同）：
//   在线 feedLine  → validate/inline 快校验（<1ms）→ 坏行 skipped+reason，流继续
//   离线 feedBatch → validate/batch 整批原子（全套 7 类 + 干跑）→ 任一坏 → 整批拒绝
//
// at 时序（P2-1 定案，§6.1）：
//   在线流式：at 缺省或 "+N" → 基准 = 接收时刻 tMs；绝对数字按模型时间轴；"+<id>" → STREAM_DEP 拒绝
//   离线批量：at 绝对 ms（相对流起点）；"+<id>" 跨行依赖（dur 指定则依赖其结束）——仅此模式允许

import type { Directive, DirectiveStream, ResolvedDirective } from "../ir/types.ts";
import { EnvironmentLayer, type EnvParamDef } from "../layers/environment.ts";
import { LayerStack } from "../layers/layer-stack.ts";
import { routeDirective } from "../layers/route.ts";
import { inlineValidate, resolveAsset } from "../validate/inline.ts";
import { batchValidate, resolveSchedule, type BatchValidateCtx } from "../validate/batch.ts";
import { parseRelativeAt, type RuleCtx } from "../validate/rules.ts";

export type { ManifestLike, AssetIndex, AssetStore } from "../ir/types.ts";

export interface IngestResult {
  applied: Directive[];
  skipped: { line: number; reason: string }[];
}

export interface IngestorCtx {
  manifest: RuleCtx["manifest"];
  library: RuleCtx["library"];
  /** 资产曲线表（缺省则 play/face 解析不到 → ASSET_UNRESOLVED 跳过） */
  assets?: RuleCtx["assets"];
  /** 注入共享 LayerStack（与 Evaluator 共用）；缺省由 manifest 构建 */
  stack?: LayerStack;
  /** 注入共享 EnvironmentLayer；缺省由 manifest 构建 */
  env?: EnvironmentLayer;
  seed?: number;
}

export class StreamIngestor {
  private readonly ruleCtx: RuleCtx;
  readonly stack: LayerStack;
  readonly env: EnvironmentLayer;
  private readonly paramDefs: EnvParamDef[];
  private readonly seed: number;

  constructor(ctx: IngestorCtx) {
    this.ruleCtx = { manifest: ctx.manifest, library: ctx.library, assets: ctx.assets };
    this.seed = ctx.seed ?? 0;
    this.paramDefs = ctx.manifest.sems.map((s) => ({
      id: s.name, min: s.min, max: s.max, group: s.group, def: s.def,
    }));
    this.stack = ctx.stack ?? new LayerStack(this.paramDefs);
    this.env = ctx.env ?? new EnvironmentLayer(this.paramDefs, { seed: this.seed });
  }

  /** 逐行（在线流式）：快校验 → 分层路由；坏行 {skipped} 不阻塞流。 */
  feedLine(line: string, tMs: number): IngestResult {
    const v = inlineValidate(line, this.ruleCtx);
    if (!v.ok) {
      return { applied: [], skipped: [{ line: 0, reason: v.issues[0]!.rule }] };
    }
    const d = v.directive!;
    // at 解析：缺省 / "+N" → 接收时刻为基准；绝对数字 → 模型时间轴；"+id" 已被快校验拒绝
    const rel = parseRelativeAt(d.at);
    const startMs = d.at !== undefined && rel === null ? (d.at as number) : tMs + (rel ?? 0);
    this.route(d, startMs);
    return { applied: [d], skipped: [] };
  }

  /** 整批（离线）：全部通过校验才 apply（原子）；任一坏行 → 整批拒绝，返回坏行清单。 */
  feedBatch(stream: DirectiveStream, tMs: number): IngestResult {
    const batchCtx: BatchValidateCtx = { ...this.ruleCtx, params: this.paramDefs, seed: this.seed };
    const v = batchValidate(stream, batchCtx);
    if (!v.ok) {
      return { applied: [], skipped: v.issues.map((i) => ({ line: i.line, reason: i.rule })) };
    }
    const sched = resolveSchedule(stream, tMs);
    if (!sched.ok) {
      return { applied: [], skipped: [{ line: sched.line, reason: sched.reason }] };
    }
    for (const { d, startMs } of sched.schedule) this.route(d, startMs);
    return { applied: sched.schedule.map((s) => s.d), skipped: [] };
  }

  /**
   * 回滚最近"已生效但慢校验失败"的行。慢校验（asyncCheck，宿主驱动）属 M6；
   * M5 无慢校验行，恒返回 false（占位契约，见 §6.2）。
   */
  undo(): boolean {
    return false;
  }

  // ---- 内部 ----

  /** 分层路由（§7.4）：play/face/set → 栈；emote/blink/drift → 环境层；其余 → 宿主（M6/M7）。 */
  private route(d: Directive, startMs: number): void {
    const resolved = { ...d, ...resolveAsset(d, this.ruleCtx) } as ResolvedDirective;
    routeDirective(resolved, startMs, this.stack, this.env);
  }
}

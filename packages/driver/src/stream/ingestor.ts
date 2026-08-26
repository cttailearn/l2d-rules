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
import { isHostOp, type HostOpHandler } from "../layers/host-ops.ts";
import { inlineValidate, resolveAsset } from "../validate/inline.ts";
import { batchValidate, resolveSchedule, type BatchValidateCtx } from "../validate/batch.ts";
import { parseRelativeAt, type RuleCtx } from "../validate/rules.ts";

export type { ManifestLike, AssetIndex, AssetStore } from "../ir/types.ts";

export interface IngestResult {
  applied: Directive[];
  skipped: { line: number; reason: string }[];
  /** 宿主路由 op（R-P1-3）：feed 中出现的 outfit/speak/look/camera/action/wait，透明上报给宿主 */
  hostOps?: { op: Directive["op"]; target?: string; tMs: number }[];
}

export interface SlowCheckEntry {
  /** 已生效行的源文本 */
  line: string;
  /** 生效时刻（feedLine/feedBatch 的 tMs） */
  tMs: number;
  /** 已解析指令 */
  directive: Directive;
  /** 0 基历史序号（用于 undo 定位） */
  index: number;
}

export interface SlowCheckResult {
  ok: boolean;
  rule?: string;
  message?: string;
}

/**
 * 慢校验器：宿主注入（内容分级 / 语义复核 / 数值干跑）。缺省 = 结构一致性恒真
 * （快校验已做，缺省慢校验不追加判定）。
 */
export type SlowChecker = (entry: SlowCheckEntry) => SlowCheckResult | Promise<SlowCheckResult>;

export interface IngestorCtx {
  manifest: RuleCtx["manifest"];
  library: RuleCtx["library"];
  /** 资产曲线表（缺省则 play/face 解析不到 → ASSET_UNRESOLVED 跳过） */
  assets?: RuleCtx["assets"];
  /** 注入共享 LayerStack（与 Evaluator 共用）；缺省由 manifest 构建 */
  stack?: LayerStack;
  /** 注入共享 EnvironmentLayer；缺省由 manifest 构建 */
  env?: EnvironmentLayer;
  /** 慢校验器（R-P1-1）；缺省恒真 */
  slowCheck?: SlowChecker;
  /** 宿主 op 处理器（R-P1-3）：outfit/speak/look/camera/action/wait 分发给宿主；缺省仅记录 hostOps 不上报 */
  host?: HostOpHandler;
  seed?: number;
}

type HistoryStatus = "pending" | "pass" | "fail";

interface HistoryEntry {
  line: string;
  tMs: number;
  directive: Directive;
  status: HistoryStatus;
}

export class StreamIngestor {
  private readonly ruleCtx: RuleCtx;
  private readonly slowCheck?: SlowChecker;
  private readonly host?: HostOpHandler;
  readonly stack: LayerStack;
  readonly env: EnvironmentLayer;
  private readonly paramDefs: EnvParamDef[];
  private readonly seed: number;
  private readonly history: HistoryEntry[] = [];

  constructor(ctx: IngestorCtx) {
    this.ruleCtx = { manifest: ctx.manifest, library: ctx.library, assets: ctx.assets };
    this.slowCheck = ctx.slowCheck;
    this.host = ctx.host;
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
    const hostOps = this.route(d, startMs);
    this.history.push({ line, tMs: startMs, directive: d, status: "pending" });
    return { applied: [d], skipped: [], ...(hostOps.length > 0 ? { hostOps } : {}) };
  }

  /** 整批（离线）：全部通过校验才 apply（原子）；任一坏行 → 整批拒绝，返回坏行清单。 */
  feedBatch(stream: DirectiveStream, tMs: number): IngestResult {
    const batchCtx: BatchValidateCtx = { ...this.ruleCtx, params: this.paramDefs, seed: this.seed };
    const v = batchValidate(stream, batchCtx);
    if (!v.ok) {
      return { applied: [], skipped: v.issues.map((i) => ({ line: i.line, reason: i.rule })) };
    }
    const sched = resolveSchedule(stream, tMs, this.ruleCtx.assets?.motions);
    if (!sched.ok) {
      return { applied: [], skipped: [{ line: sched.line, reason: sched.reason }] };
    }
    const allOps: { op: Directive["op"]; target?: string; tMs: number }[] = [];
    for (const { d, startMs } of sched.schedule) {
      const hostOps = this.route(d, startMs);
      allOps.push(...hostOps);
      this.history.push({ line: JSON.stringify(d), tMs: startMs, directive: d, status: "pending" });
    }
    return { applied: sched.schedule.map((s) => s.d), skipped: [], ...(allOps.length > 0 ? { hostOps: allOps } : {}) };
  }

  /**
   * 慢校验（R-P1-1｜SPEC §7.3/§7.5）：对全部"待复核"行执行宿主注入的 slowCheck；
   * 命中风险（!ok）→ 标记为 fail（undo 可回滚）。返回本次标记失败的行列表。
   * 缺省无 slowCheck → 全量标记 pass，恒返回空数组。
   */
  async asyncCheck(): Promise<SlowCheckEntry[]> {
    const failed: SlowCheckEntry[] = [];
    if (!this.slowCheck) {
      for (const h of this.history) h.status = "pass";
      return failed;
    }
    for (let i = 0; i < this.history.length; i++) {
      const h = this.history[i]!;
      if (h.status !== "pending") continue;
      const res = await this.slowCheck({ line: h.line, tMs: h.tMs, directive: h.directive, index: i });
      h.status = res.ok ? "pass" : "fail";
      if (!res.ok) {
        failed.push({ line: h.line, tMs: h.tMs, directive: h.directive, index: i });
        console.warn("[ingestor] 慢校验失败行 " + i + "（" + (res.rule ?? "SLOW_CHECK") + "）: " + (res.message ?? ""));
      }
    }
    return failed;
  }

  /**
   * 回滚最近"已生效但慢校验失败"的行（R-P1-1｜SPEC §7.3/§7.5）。返回是否发生回滚。
   * 实现：定位最后一个 fail 行 → 重置 LayerStack/EnvironmentLayer → 重放其余全部行（剔除失败行）。
   * 无失败行 → 返回 false（不改变状态）。
   */
  undo(): boolean {
    let failIdx = -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.status === "fail") { failIdx = i; break; }
    }
    if (failIdx === -1) return false;

    const dropped = this.history[failIdx]!.directive;
    const kept = this.history.filter((_, i) => i !== failIdx);
    // 重置
    this.stack.reset();
    this.env.reset();
    this.history.length = 0;
    // 重放（剔除失败行）
    for (const h of kept) {
      this.route(h.directive, h.tMs);
      this.history.push({ ...h, status: "pending" });
    }
    console.warn("[ingestor] undo 回滚行 " + failIdx + "（" + dropped.op + "）");
    return true;
  }

  /** 历史快照（测试/审计用）：每行的状态。 */
  historyStatus(): { line: string; op: Directive["op"]; status: HistoryStatus }[] {
    return this.history.map((h) => ({ line: h.line, op: h.directive.op, status: h.status }));
  }

  // ---- 内部 ----

  /**
   * 分层路由（§7.4）：play/face/set → 栈；emote/blink/drift → 环境层；
   * 宿主 op（outfit/speak/look/camera/action/wait，R-P1-3）→ 有 host 则分发（fire-and-forget）、
   * 否则仅返回记录（hostOps 透明上报）。返回本次出现的宿主 op 清单。
   */
  private route(d: Directive, startMs: number): { op: Directive["op"]; target?: string; tMs: number }[] {
    const resolved = { ...d, ...resolveAsset(d, this.ruleCtx) } as ResolvedDirective;
    routeDirective(resolved, startMs, this.stack, this.env);

    if (isHostOp(d.op)) {
      const record = { op: d.op, target: d.target, tMs: startMs };
      const fn = this.host?.[d.op];
      if (fn !== undefined) {
        void Promise.resolve(fn(d, startMs)).catch((e) => {
          console.warn("[ingestor] 宿主 op 处理失败 " + d.op + ": " + (e as Error).message);
        });
      }
      return [record];
    }
    return [];
  }
}

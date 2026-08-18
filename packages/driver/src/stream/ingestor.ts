// StreamIngestor —— JSONL 流式驱动（在线逐行 / 离线整批）—— DEVELOPMENT-SPEC §6.2 / §7
// 语义：一行 = 一个层上的一个动作。行级原子、坏行隔离不阻塞（§7.1/7.2）。
//
// 分层路由（§7.4）：
//   play/face/set → LayerStack      emote/blink/drift → EnvironmentLayer
//   outfit/speak/look/camera/action/wait → applied（宿主消费：TTS/换装/相机，M6/M7 接线）
//
// at 时序（P2-1 定案，§6.1）：
//   在线流式：at 缺省或 "+N" → 基准 = 接收时刻 tMs；绝对数字按模型时间轴；"+<id>" → STREAM_DEP 拒绝
//   离线批量：at 绝对 ms（相对流起点）；"+<id>" 跨行依赖（dur 指定则依赖其结束）——仅此模式允许

import { validateDirective, parseRelativeAt } from "../ir/validate.ts";
import type { Directive, DirectiveStream, ExpressionLike, MotionLike, ResolvedDirective } from "../ir/types.ts";
import { LayerStack } from "../layers/layer-stack.ts";
import { EnvironmentLayer, type EnvParamDef } from "../layers/environment.ts";

export interface ManifestLike {
  sems: { name: string; min: number; max: number; group?: string; def?: number }[];
}

export interface AssetIndex {
  motions: { name: string; group?: string }[];
  expressions: { name: string }[];
  behaviors: never[];
}

/** 同步资产表（feedLine 为同步入口；异步 AssetSource 由宿主在 M7 包装） */
export interface AssetStore {
  motions: Map<string, MotionLike>;
  expressions: Map<string, ExpressionLike>;
}

export interface IngestResult {
  applied: Directive[];
  skipped: { line: number; reason: string }[];
}

export interface IngestorCtx {
  manifest: ManifestLike;
  library: AssetIndex;
  /** 资产曲线表（缺省则 play/face 解析不到 → ASSET_UNRESOLVED 跳过） */
  assets?: AssetStore;
  /** 注入共享 LayerStack（与 Evaluator 共用）；缺省由 manifest 构建 */
  stack?: LayerStack;
  /** 注入共享 EnvironmentLayer；缺省由 manifest 构建 */
  env?: EnvironmentLayer;
  seed?: number;
}

export class StreamIngestor {
  private readonly manifest: ManifestLike;
  private readonly library: AssetIndex;
  private readonly assets: AssetStore | undefined;
  readonly stack: LayerStack;
  readonly env: EnvironmentLayer;
  private readonly paramDefs: EnvParamDef[];

  constructor(ctx: IngestorCtx) {
    this.manifest = ctx.manifest;
    this.library = ctx.library;
    this.assets = ctx.assets;
    this.paramDefs = ctx.manifest.sems.map((s) => ({
      id: s.name, min: s.min, max: s.max, group: s.group, def: s.def,
    }));
    this.stack = ctx.stack ?? new LayerStack(this.paramDefs);
    this.env = ctx.env ?? new EnvironmentLayer(this.paramDefs, { seed: ctx.seed ?? 0 });
  }

  /** 逐行（在线流式）：快校验 → 引用校验 → 分层路由；坏行 {skipped} 不阻塞流。 */
  feedLine(line: string, tMs: number): IngestResult {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { applied: [], skipped: [{ line: 0, reason: "JSON_PARSE" }] };
    }
    const v = validateDirective(raw, false);
    if (!v.ok) {
      return { applied: [], skipped: [{ line: 0, reason: v.issues[0]!.rule }] };
    }
    const ref = this.checkRefs(v.directive);
    if (ref !== null) {
      return { applied: [], skipped: [{ line: 0, reason: ref }] };
    }
    // at 解析：缺省 / "+N" → 接收时刻为基准；绝对数字 → 模型时间轴；"+id" 已被快校验拒绝
    const rel = parseRelativeAt(v.directive.at);
    const startMs = v.directive.at !== undefined && rel === null
      ? (v.directive.at as number)
      : tMs + (rel ?? 0);
    this.route(v.directive, startMs);
    return { applied: [v.directive], skipped: [] };
  }

  /** 整批（离线）：全部通过校验才 apply（原子）；任一坏行 → 整批拒绝，返回坏行清单。 */
  feedBatch(stream: DirectiveStream, tMs: number): IngestResult {
    const skipped: IngestResult["skipped"] = [];
    const resolved: ResolvedDirective[] = [];

    // 阶段 1：逐条快校验 + 引用校验（语义/资产）
    for (let i = 0; i < stream.directives.length; i++) {
      const v = validateDirective(stream.directives[i], true);
      if (!v.ok) {
        skipped.push({ line: i, reason: v.issues[0]!.rule });
        continue;
      }
      const ref = this.checkRefs(v.directive);
      if (ref !== null) {
        skipped.push({ line: i, reason: ref });
        continue;
      }
      resolved.push(v.directive as ResolvedDirective);
    }
    if (skipped.length > 0) return { applied: [], skipped };

    // 阶段 2：at 排程（绝对 ms 相对流起点；"+N" 相对上一条；"+id" 依赖前序行开始/结束）
    const schedule: { d: ResolvedDirective; startMs: number }[] = [];
    const idTimes = new Map<string, { start: number; end: number }>();
    let prev = tMs;
    for (const d of resolved) {
      let start: number;
      const at = d.at;
      if (at === undefined) start = prev;
      else if (typeof at === "number") start = tMs + at;
      else {
        const rel = parseRelativeAt(at);
        if (rel !== null) start = prev + rel;
        else {
          const base = idTimes.get(at.slice(1));
          if (base === undefined) {
            skipped.push({ line: resolved.indexOf(d), reason: "AT_DEP_MISSING" });
            break;
          }
          start = d.dur !== undefined ? base.start + d.dur : base.start;
        }
      }
      schedule.push({ d, startMs: start });
      if (d.id) idTimes.set(d.id, { start, end: start + (d.dur ?? 0) });
      prev = start;
    }
    if (skipped.length > 0) return { applied: [], skipped };

    // 阶段 3：全部排程成功 → 原子 apply
    for (const { d, startMs } of schedule) this.route(d, startMs);
    return { applied: schedule.map((s) => s.d), skipped: [] };
  }

  /**
   * 回滚最近"已生效但慢校验失败"的行。慢校验（asyncCheck，宿主驱动）属 M6；
   * M5 无慢校验行，恒返回 false（占位契约，见 §6.2）。
   */
  undo(): boolean {
    return false;
  }

  // ---- 内部 ----

  /** 引用校验：sem 存在 / 资产存在；通过返回 null，否则返回 reason。 */
  private checkRefs(d: Directive): string | null {
    switch (d.op) {
      case "play": {
        if (!this.library.motions.some((m) => m.name === d.asset)) return "ASSET_NOT_FOUND";
        if (!this.assets?.motions.has(d.asset!)) return "ASSET_UNRESOLVED";
        return null;
      }
      case "face": {
        if (!this.library.expressions.some((e) => e.name === d.expression)) return "ASSET_NOT_FOUND";
        if (!this.assets?.expressions.has(d.expression!)) return "ASSET_UNRESOLVED";
        return null;
      }
      case "set": case "drift": {
        const sem = this.manifest.sems.find((s) => s.name === d.sem);
        if (!sem) return "SEM_NOT_FOUND";
        if (d.op === "set" && d.value !== undefined && (d.value < sem.min || d.value > sem.max)) return "RANGE";
        return null;
      }
      default:
        return null;
    }
  }

  /** 分层路由（§7.4）：play/face/set → 栈；emote/blink/drift → 环境层；其余 → 宿主（M6/M7）。 */
  private route(d: Directive, startMs: number): void {
    const resolved = d as ResolvedDirective;
    switch (d.op) {
      case "play":
        resolved._motion = this.assets!.motions.get(d.asset!)!;
        this.stack.push(resolved, startMs);
        return;
      case "face":
        resolved._expression = this.assets!.expressions.get(d.expression!)!;
        this.stack.push(resolved, startMs);
        return;
      case "set":
        this.stack.push(resolved, startMs);
        return;
      case "emote":
        this.env.setEmote(d.emote ?? null);
        return;
      case "blink":
        this.env.feedBlink(d.interval);
        return;
      case "drift":
        this.env.setDrift(d.sem!, d.amplitude!, d.period!);
        return;
      default:
        // outfit/speak/look/camera/action/wait：宿主消费（M6/M7）；流式仅确认接收
        return;
    }
  }
}

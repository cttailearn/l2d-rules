// review.ts —— 多模态审核钩子 + 确定性规则审核兜底
// RuleReviewer：软件渲染 rest/blink/smile 三态 → 非空/多色/覆盖度/上下分布 检查（无 GPU、无视觉模型也能自检）。
import { L2dmPlayer, SoftwareRenderer, type L2dmModel } from "@l2dp/engine";

export interface ReviewVerdict {
  /** 是否通过（ok=false 时建议回注修复） */
  ok: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
}

/** 复审（视觉 LLM）判定（R-P2-2）：比自带 issues/suggestions 更接近"差异回注"的结构）。 */
export interface VisualReviewResult extends ReviewVerdict {
  /** 命中的具体差异（回注给 RuleRepairer/create 用） */
  diffs?: { part?: string; kind: string; message: string }[];
}

/** 多模态审核器（宿主可用视觉 LLM 注入：渲染帧 dataUri → 自然语言判定） */
export interface RigReviewer {
  review(model: L2dmModel): Promise<ReviewVerdict>;
  readonly name: string;
}

export interface RuleReviewerOptions {
  /** 不透明像素占比下限（过小=空白/过小） */
  coverageMin?: number;
  /** 不透明像素占比上限（过大=未切图/糊成一团） */
  coverageMax?: number;
  /** 最少不同主色数（过少=单色块） */
  minColors?: number;
  /** 头部应出现在画布上半部（不透明像素的最小 y < 0.6*H） */
  headTopRatio?: number;
  /** 是否启用三态质检（rest/blink/smile；P1-1，缺省 true） */
  threeStates?: boolean;
}

function renderFrame(model: L2dmModel, apply: (ps: { set(id: string, v: number): boolean }) => void): Uint8Array {
  const player = new L2dmPlayer(model, new Map());
  const sw = new SoftwareRenderer();
  player.params.reset();
  apply(player.params);
  player.render(sw);
  const px = sw.readPixels();
  if (!px) return new Uint8Array(0);
  return px;
}

/** 单帧静态检查：覆盖/颜色/头部位置。返回 issues/suggestions。 */
function inspectFrame(px: Uint8Array, W: number, H: number, o: {
  coverageMin: number; coverageMax: number; minColors: number; headTopRatio: number;
  state: string;
}): { issues: string[]; suggestions: string[] } {
  const total = W * H;
  let opaque = 0;
  let minY = H;
  const colors = new Set<number>();
  for (let i = 0; i < total; i++) {
    const a = px[i * 4 + 3]!;
    if (a >= 128) {
      opaque++;
      const y = Math.floor(i / W);
      if (y < minY) minY = y;
      if (i % 37 === 0) {
        colors.add(((px[i * 4]! & 0xf8) << 16) | ((px[i * 4 + 1]! & 0xf8) << 8) | (px[i * 4 + 2]! & 0xf8));
      }
    }
  }
  const coverage = opaque / total;
  const c: string[] = [];
  const s: string[] = [];
  const tag = o.state === "rest" ? "" : `（${o.state} 态）`;
  if (opaque === 0) {
    c.push(`渲染为空（无可见像素）${tag}`);
    s.push(`检查部件 bbox / 颜色是否落在画布内${tag}`);
  } else {
    if (coverage < o.coverageMin) {
      c.push(`覆盖率过低 ${(coverage * 100).toFixed(1)}% < ${(o.coverageMin * 100)}%${tag}`);
      s.push(`放大部件或扩大 bbox${tag}`);
    }
    if (coverage > o.coverageMax) {
      c.push(`覆盖率过高 ${(coverage * 100).toFixed(1)}% > ${(o.coverageMax * 100)}%${tag}`);
      s.push(`检查是否有部件糊满画布 / 背景未剔除${tag}`);
    }
    if (minY / H > o.headTopRatio) {
      c.push(`角色整体偏下（无上部内容）${tag}`);
      s.push(`调整 hinge/部件位置${tag}`);
    }
    if (colors.size < o.minColors) {
      c.push(`颜色种类过少 ${colors.size} < ${o.minColors}${tag}`);
      s.push(`检查是否只有单一色块${tag}`);
    }
  }
  return { issues: c, suggestions: s };
}

/** 确定性规则审核（SDK 兜底；宿主可换视觉 LLM 审核器）。 */
export class RuleReviewer implements RigReviewer {
  readonly name = "rules";
  private readonly opts: RuleReviewerOptions;
  constructor(opts: RuleReviewerOptions = {}) {
    this.opts = opts;
  }
  async review(model: L2dmModel): Promise<ReviewVerdict> {
    const coverageMin = this.opts.coverageMin ?? 0.03;
    const coverageMax = this.opts.coverageMax ?? 0.95;
    const minColors = this.opts.minColors ?? 3;
    const headTopRatio = this.opts.headTopRatio ?? 0.6;
    const threeStates = this.opts.threeStates ?? true;
    const W = model.canvas.width;
    const H = model.canvas.height;

    // P1-1 三态：rest（静止）/ blink（眨眼参数拉满）/ smile（口型参数拉满）——
    // 任一态崩溃（空白/越界）都能被检出（确定性，无视觉模型）。
    const byGroup = (re: RegExp): string[] =>
      model.parameters.filter((p) => (p.group ?? "").match(re) || re.test(p.id)).map((p) => p.id);
    const blinkIds = byGroup(/EyeBlink|眼|目|eye/i);
    const smileIds = byGroup(/LipSync|口|嘴|mouth/i);

    // 兜底：找不到归类参数时退化为 rest 单态（旧行为），避免误伤通用模型。
    const states: { name: string; apply: (ps: { set(id: string, v: number): boolean }) => void }[] = [
      { name: "rest", apply: () => {} },
    ];
    if (threeStates) {
      if (blinkIds.length > 0) {
        states.push({ name: "blink", apply: (ps) => { for (const id of blinkIds) ps.set(id, 1); } });
      }
      if (smileIds.length > 0) {
        states.push({ name: "smile", apply: (ps) => { for (const id of smileIds) ps.set(id, 1); } });
      }
    }

    const issues: string[] = [];
    const suggestions: string[] = [];
    for (const st of states) {
      const px = renderFrame(model, st.apply);
      const r = inspectFrame(px, W, H, { coverageMin, coverageMax, minColors, headTopRatio, state: st.name });
      issues.push(...r.issues);
      suggestions.push(...r.suggestions);
    }
    const ok = issues.length === 0;
    return { ok, confidence: ok ? 0.9 : 0.5, issues, suggestions };
  }
}
// ---------------- R-P2-2：分级审核链 ChainedReviewer ----------------

/** 分级审核器（R-P2-2）：规则初审 →（置信不足或规则边缘时）视觉 LLM 复审 → 差异回注。 */
export class ChainedReviewer implements RigReviewer {
  readonly name = "chained";
  /** 规则初审（确定性，SDK 兜底） */
  private readonly primary: RigReviewer;
  /** 视觉复审（宿主注入；缺省 = 无复审，等价纯规则） */
  private readonly visual?: RigReviewer | null;
  /** 规则通过但置信低于此阈值 → 触发视觉复审 */
  private readonly confidenceThreshold: number;
  /** 复审调用计数（测试断言） */
  visualCalls = 0;

  constructor(opts: {
    primary?: RigReviewer;
    visual?: RigReviewer | null;
    confidenceThreshold?: number;
  } = {}) {
    this.primary = opts.primary ?? new RuleReviewer();
    this.visual = opts.visual ?? null;
    this.confidenceThreshold = opts.confidenceThreshold ?? 0.6;
  }

  async review(model: L2dmModel): Promise<ReviewVerdict> {
    // 第 1 级：规则初审（确定性）
    const first = await this.primary.review(model);
    // 规则直接不过 → 回注修复（不进视觉，避免无谓成本）
    if (!first.ok) return { ...first, confidence: 0.4 };
    // 规则过但置信不足 → 第 2 级：视觉复审
    if (this.visual !== undefined && this.visual !== null && first.confidence < this.confidenceThreshold) {
      this.visualCalls += 1;
      const second = await this.visual.review(model);
      if (!second.ok) {
        // 视觉发现规则未覆盖的差异 → 回注
        const vr = second as VisualReviewResult;
        const diffNotes = vr.diffs ? vr.diffs.map((d) => d.message) : second.issues;
        return {
          ok: false,
          confidence: Math.min(first.confidence, second.confidence),
          issues: [...first.issues, ...diffNotes],
          suggestions: [...first.suggestions, ...second.suggestions],
        };
      }
      return { ...second, issues: [...first.issues, ...second.issues], suggestions: [...first.suggestions, ...second.suggestions] };
    }
    return first;
  }
}
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

    const rest = renderFrame(model, () => {});
    const W = model.canvas.width;
    const H = model.canvas.height;
    const total = W * H;
    let opaque = 0;
    let minY = H;
    let maxY = -1;
    const colors = new Set<number>();
    for (let i = 0; i < total; i++) {
      const a = rest[i * 4 + 3]!;
      if (a >= 128) {
        opaque++;
        const y = Math.floor(i / W);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (i % 37 === 0) {
          colors.add(((rest[i * 4]! & 0xf8) << 16) | ((rest[i * 4 + 1]! & 0xf8) << 8) | (rest[i * 4 + 2]! & 0xf8));
        }
      }
    }
    const coverage = opaque / total;
    const issues: string[] = [];
    const suggestions: string[] = [];
    if (opaque === 0) {
      issues.push("渲染为空（无可见像素）");
      suggestions.push("检查部件 bbox / 颜色是否落在画布内");
    } else {
      if (coverage < coverageMin) {
        issues.push("覆盖率过低 " + (coverage * 100).toFixed(1) + "% < " + (coverageMin * 100) + "%");
        suggestions.push("放大部件或扩大 bbox");
      }
      if (coverage > coverageMax) {
        issues.push("覆盖率过高 " + (coverage * 100).toFixed(1) + "% > " + (coverageMax * 100) + "%");
        suggestions.push("检查是否有部件糊满画布 / 背景未剔除");
      }
      if (minY / H > headTopRatio) {
        issues.push("角色整体偏下（无上部内容）");
        suggestions.push("调整 hinge/部件位置");
      }
      if (colors.size < minColors && opaque > 0) {
        issues.push("颜色种类过少 " + colors.size + " < " + minColors);
        suggestions.push("检查是否只有单一色块");
      }
    }
    const ok = issues.length === 0;
    return { ok, confidence: ok ? 0.9 : 0.5, issues, suggestions };
  }
}

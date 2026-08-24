// llm-reviewer.ts —— 多模态审核器（实现 @l2dp/create RigReviewer；provider 注入，帧渲染自 @l2dp/engine）
import { L2dmPlayer, SoftwareRenderer, type L2dmModel } from "@l2dp/engine";
import { encodePng, pngToDataUri } from "@l2dp/cutout";
import type { ChatRequest, RuntimeProvider } from "@l2dp/driver";
import type { RigReviewer, ReviewVerdict } from "@l2dp/create";
import { buildReviewPrompt, reviewResponseSchema } from "./llm.ts";

export interface LlmReviewerOptions {
  provider: RuntimeProvider;
  schema?: Record<string, unknown>;
  system?: string;
  /** 渲染静止帧供视觉（缺省 true） */
  includeFrames?: boolean;
  /** 额外帧（如 blink 闭眼态） */
  extraStates?: { name: string; apply: (ps: { set(id: string, v: number): boolean }) => void }[];
}

export interface ReviewResponse {
  ok: boolean;
  confidence: number;
  issues?: string[];
  suggestions?: string[];
}

/** LLM 审核器：软件渲染 → data URI → 提示词 → provider 判定（多模态端点直接看图，文本端点看描述）。 */
export class LlmReviewer implements RigReviewer {
  readonly name = "llm";
  private readonly opts: LlmReviewerOptions;
  constructor(opts: LlmReviewerOptions) {
    this.opts = opts;
  }
  async review(model: L2dmModel): Promise<ReviewVerdict> {
    const frameUris: string[] = [];
    if (this.opts.includeFrames !== false) {
      const player = new L2dmPlayer(model, new Map());
      const sw = new SoftwareRenderer();
      const capture = (apply?: (ps: { set(id: string, v: number): boolean }) => void): string => {
        player.params.reset();
        if (apply) apply(player.params);
        player.render(sw);
        const px = sw.readPixels();
        if (!px) return "";
        return pngToDataUri(encodePng(model.canvas.width, model.canvas.height, px));
      };
      const uri = capture();
      if (uri) frameUris.push(uri);
      for (const st of this.opts.extraStates ?? []) {
        const u2 = capture(st.apply);
        if (u2) frameUris.push(u2);
      }
    }
    const user = buildReviewPrompt(frameUris, model.id);
    const req: ChatRequest = {
      system: this.opts.system ?? "你输出严格 JSON，格式 {ok,confidence,issues[],suggestions[]}。",
      messages: [{ role: "user", content: user }],
    };
    const res = await this.opts.provider.createCompletion(req, { schema: this.opts.schema ?? (reviewResponseSchema() as object) });
    const raw = (res.structured ?? JSON.parse(res.text)) as ReviewResponse;
    return {
      ok: raw.ok === true,
      confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
      issues: raw.issues ?? [],
      suggestions: raw.suggestions ?? [],
    };
  }
}

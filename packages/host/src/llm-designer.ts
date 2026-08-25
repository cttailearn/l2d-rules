// llm-designer.ts —— P4 few-shot：切图结果 → LLM 结构生成整条 CreationDirective（@l2dp/create Designer）
import type { CutoutPart } from "@l2dp/cutout";
import { type CreationDirective, type Designer, type DesignContext } from "@l2dp/create";
import { creationDirectiveSchema } from "@l2dp/create";
import type { ChatRequest, RuntimeProvider } from "@l2dp/driver";
import { buildDesignPrompt, dominantColorOfPart, sanitizeCreationDirective } from "./llm-directive.ts";

export interface LlmDesignerOptions {
  provider: RuntimeProvider;
  schema?: Record<string, unknown>;
  system?: string;
  vocabHint?: string[];
}

/**
 * LLM 设计器（P4）：候选 → 提示词(few-shot) → provider 结构化输出 → 清洗 → CreationDirective。
 * LLM 产物只进结构化指令（不进像素）；颜色/bbox 缺失时由主色/语义调色板确定性兜底。
 */
export class LlmDesigner implements Designer {
  readonly name = "llm";
  private readonly opts: LlmDesignerOptions;
  constructor(opts: LlmDesignerOptions) {
    this.opts = opts;
  }

  async design(ctx: DesignContext): Promise<CreationDirective> {
    const colorCache = new Map<string, [number, number, number, number] | null>();
    const colorOf = (id: string): [number, number, number, number] | null => {
      if (!colorCache.has(id)) {
        const p: CutoutPart | undefined = ctx.parts.find((c) => c.id === id);
        colorCache.set(id, p ? dominantColorOfPart(p) : null);
      }
      return colorCache.get(id) ?? null;
    };
    const prompt = buildDesignPrompt(ctx, this.opts.vocabHint);
    const req: ChatRequest = {
      system: this.opts.system ?? "你输出严格 JSON，只使用给定词表语义名，不输出解释。",
      messages: [{ role: "user", content: prompt }],
    };
    const res = await this.opts.provider.createCompletion(req, { schema: this.opts.schema ?? (creationDirectiveSchema() as unknown as object) });
    const raw = res.structured ?? safeJson(res.text);
    return sanitizeCreationDirective(raw, { character: ctx.character, canvas: ctx.canvas, colorOf });
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return {}; }
}

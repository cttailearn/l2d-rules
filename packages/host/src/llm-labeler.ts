// llm-labeler.ts —— LLM 语义标注器（实现 @l2dp/cutout Labeler；RuntimeProvider 注入）
import { type CandidateRegion, type CutoutPart, type Labeler, type RgbaImage, cutoutMasked, encodePng, pngToDataUri } from "@l2dp/cutout";
import type { ChatRequest, RuntimeProvider } from "@l2dp/driver";
import { buildLabelPrompt, labelResponseSchema } from "./llm.ts";

export interface LlmLabelerOptions {
  provider: RuntimeProvider;
  schema?: Record<string, unknown>;
  system?: string;
  /** 是否在提示词附整图 data URI（供多模态端点） */
  includeImage?: boolean;
  vocabHint?: string[];
}

export interface LabelAssignmentResponse {
  assignments: { candidateId: string; semantic: string; side?: "left" | "right"; confidence?: number }[];
}

/** LLM 标注器：候选 → 提示词 → provider 结构化输出 → CutoutPart（目录进、IR 出）。 */
export class LlmLabeler implements Labeler {
  readonly name = "llm";
  private readonly opts: LlmLabelerOptions;
  constructor(opts: LlmLabelerOptions) {
    this.opts = opts;
  }
  async label(candidates: CandidateRegion[], image: RgbaImage): Promise<CutoutPart[]> {
    const dataUri = this.opts.includeImage ? pngToDataUri(encodePng(image.width, image.height, image.data)) : undefined;
    const user = buildLabelPrompt(candidates, { imageDataUri: dataUri, vocabHint: this.opts.vocabHint });
    const req: ChatRequest = {
      system: this.opts.system ?? "你输出严格 JSON。只使用给定词表里的语义名。",
      messages: [{ role: "user", content: user }],
    };
    const res = await this.opts.provider.createCompletion(req, { schema: this.opts.schema ?? (labelResponseSchema() as object) });
    const raw = (res.structured ?? JSON.parse(res.text)) as LabelAssignmentResponse;
    const masked: { region: { mask: Uint8Array; pixels?: number; color?: [number, number, number] }; semantic: string; side?: "left" | "right" }[] = [];
    for (const a of raw.assignments ?? []) {
      const cand = candidates.find((c2) => c2.id === a.candidateId);
      if (!cand || !cand.mask) continue;
      masked.push({ region: { mask: cand.mask, pixels: cand.pixels, color: cand.color }, semantic: a.semantic, side: a.side });
    }
    return cutoutMasked(image, masked as never);
  }
}

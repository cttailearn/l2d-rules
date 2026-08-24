// host.ts —— P4c 装配：把桥接组件组装成 createWithSelfRepair 需要的 Segmenter/Labeler/Reviewer 三件套
import type { Labeler, RgbaImage, Segmenter } from "@l2dp/cutout";
import type { RigReviewer } from "@l2dp/create";
import { HttpSegmenter } from "./http-segmenter.ts";
import { LlmLabeler } from "./llm-labeler.ts";
import { LlmReviewer } from "./llm-reviewer.ts";
import type { RuntimeProvider } from "@l2dp/driver";

export interface P4cBridges {
  segmenter: Segmenter;
  labeler: Labeler;
  reviewer: RigReviewer | null;
}

export interface P4cBridgeOptions {
  /** 分割来源：http 服务端点 或 comfyui baseUrl（二者选一；都不给则报错） */
  segment?: { url: string; authToken?: string } | { comfyui: string };
  llm: { provider: RuntimeProvider };
  /** 是否启用 LLM 视觉审核（缺省 true） */
  review?: boolean;
  labelVocabHint?: string[];
  segmentFetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** 装配 P4c 三件套（HTTP 分割服务或 ComfyUI + LLM 标注器 + LLM 审核器）。 */
export function buildP4cBridges(opts: P4cBridgeOptions): P4cBridges {
  let segmenter: Segmenter;
  if (opts.segment && "url" in opts.segment) {
    segmenter = new HttpSegmenter({ url: opts.segment.url, authToken: opts.segment.authToken, fetchImpl: opts.segmentFetch });
  } else if (opts.segment && "comfyui" in opts.segment) {
    // ComfyUI 桥本身返回图片而非候选——宿主需提供从图片到候选的适配；此骨架给一个显式抛错 + 文档指引
    throw new Error("buildP4cBridges: ComfyUI 模式需要宿主提供 mask→candidate 适配（见 @l2dp/host README）；请改用 segment.url 或自定义 Segmenter");
  } else {
    throw new Error("buildP4cBridges: 需要 segment.url 或 comfyui 配置");
  }
  const labeler = new LlmLabeler({ provider: opts.llm.provider, vocabHint: opts.labelVocabHint });
  const reviewer = opts.review === false ? null : new LlmReviewer({ provider: opts.llm.provider });
  return { segmenter, labeler, reviewer };
}

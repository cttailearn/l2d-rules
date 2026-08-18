// provider/types.ts —— LLM 通道分级抽象 —— DEVELOPMENT-SPEC §6.7 / SPEC-DSL-v1.0 §9.2
// 能力协商三级：native（structured outputs）/ grammar（XGrammar/GBNF，M7+ 可选）/ text（万能降级）。
// SDK 零网络约束：网络实现由宿主注入（fetch 可注入的 OpenAIProvider 仅为便捷实现）。

export type StructuredCapability = "native" | "grammar" | "text";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
}

export interface ChatResult {
  /** 模型输出文本（JSONL 行或任意文本；text 级经 fallback 提取） */
  text: string;
  /** native 级结构化输出（OpenAI structured outputs 的 parsed 对象） */
  structured?: unknown;
  usage?: { promptTokens?: number; completionTokens?: number };
  finishReason?: string;
}

export interface RuntimeProvider {
  capabilities(): { structured: StructuredCapability; grammarHint?: string };
  createCompletion(req: ChatRequest, opts?: { schema?: object; grammar?: string }): Promise<ChatResult>;
}

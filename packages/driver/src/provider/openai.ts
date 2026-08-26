// provider/openai.ts —— native 档便捷实现（OpenAI 兼容 structured outputs）—— §6.7
// SDK 零网络约束：fetch 可注入（默认全局 fetch），宿主可换任意端点（Ollama/vLLM 兼容层）。
// 请求成形 + 响应解析为纯函数（可测）；真实调用需要宿主提供 key/端点。

import type { ChatRequest, ChatResult, RuntimeProvider } from "./types.ts";
import { directiveStreamSchema } from "../ir/schema.ts";

export interface OpenAIProviderOpts {
  /** API 端点（默认 OpenAI）；可指 Ollama/vLLM 兼容层 */
  baseUrl?: string;
  apiKey?: string;
  model: string;
  /** 注入 fetch（测试/宿主自定义）；缺省全局 fetch */
  fetchImpl?: typeof fetch;
}

/** 请求成形：messages → OpenAI chat.completions 载荷（schema → response_format json_schema strict）。 */
export function buildOpenAIBody(req: ChatRequest, opts: { model: string; schema?: object }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: req.system !== undefined
      ? [{ role: "system", content: req.system }, ...req.messages]
      : req.messages,
  };
  if (opts.schema !== undefined) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "directive_stream",
        strict: true,
        schema: opts.schema,
      },
    };
  }
  return body;
}

export class OpenAIProvider implements RuntimeProvider {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAIProviderOpts) {
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  capabilities(): { structured: "native"; grammarHint?: undefined } {
    return { structured: "native" };
  }

  async createCompletion(req: ChatRequest, opts: { schema?: object } = {}): Promise<ChatResult> {
    // 缺省用由 IR 规则库同源生成的 directiveStreamSchema，保证 native 结构化输出路径有真实 schema 可用。
    const body = buildOpenAIBody(req, { model: this.model, schema: opts.schema ?? directiveStreamSchema() });
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey !== undefined ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      choices: { message: { content: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices[0];
    // P0-1：native 档 content 应为 JSON（strict structured outputs），但模型可能不按 schema 输出。
    // JSON.parse 失败 → 降级返回 { text: content }（由 text/fallback 提取器兜底），不向上抛。
    let structured: unknown;
    if (choice) {
      try {
        structured = JSON.parse(choice.message.content);
      } catch {
        structured = undefined;
      }
    }
    return {
      text: choice?.message.content ?? "",
      structured,
      finishReason: choice?.finish_reason,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
      },
    };
  }
}

// provider/mock.ts —— 确定性 mock provider（测试 + 评估集）—— DEVELOPMENT-SPEC §6.7
// 无网络/无随机：同请求 → 同输出。关键词 → 决策 JSONL（模拟 LLM 的枚举决策）。
// 用于：两跳第二跳全流程测试、eval-drive golden cases、无 key 的 CI。

import type { ChatRequest, ChatResult, RuntimeProvider } from "./types.ts";

/** 确定性决策：用户文本关键词 → JSONL 指令行（默认问候兜底）。 */
export function decideJsonl(userText: string): string[] {
  if (/摇|尾巴/.test(userText)) return ['{"op":"play","asset":"尾巴摇"}', '{"op":"emote","emote":{"valence":0.6,"arousal":0.5}}'];
  if (/点头|嗯|同意/.test(userText)) return ['{"op":"play","asset":"微笑点头"}'];
  if (/害羞|脸红/.test(userText)) return ['{"op":"play","asset":"害羞低头"}', '{"op":"set","sem":"头转向","value":-10}'];
  return ['{"op":"play","asset":"微笑点头"}', '{"op":"play","asset":"尾巴摇"}'];
}

export class MockProvider implements RuntimeProvider {
  /** 调用计数（测试：第一跳命中本地规则时不得增加） */
  calls = 0;

  capabilities(): { structured: "text" } {
    return { structured: "text" };
  }

  async createCompletion(req: ChatRequest): Promise<ChatResult> {
    this.calls += 1;
    const last = req.messages.at(-1);
    const userText = last?.role === "user" ? last.content : "";
    return {
      text: decideJsonl(userText).join("\n"),
      finishReason: "stop",
    };
  }
}

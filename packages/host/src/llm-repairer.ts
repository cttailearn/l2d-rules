// llm-repairer.ts —— P4 自修复：校验问题 → LLM 修正整条 CreationDirective（@l2dp/create Repairer）
import { type CreationDirective, type CreationIssue, type Repairer, type RepairResult } from "@l2dp/create";
import { creationDirectiveSchema } from "@l2dp/create";
import type { ChatRequest, RuntimeProvider } from "@l2dp/driver";
import { buildRepairPrompt, sanitizeCreationDirective } from "./llm-directive.ts";

export interface LlmRepairerOptions {
  provider: RuntimeProvider;
  schema?: Record<string, unknown>;
  system?: string;
}

/**
 * LLM 修复器（P4）：读问题清单回注 → 输出修正指令 → 确定性清洗。
 * 与 RuleRepairer（确定性钳制）互补：规则可修走规则，规则不可修（语义/结构）走本修复器。
 */
export class LlmRepairer implements Repairer {
  readonly name = "llm";
  private readonly opts: LlmRepairerOptions;
  constructor(opts: LlmRepairerOptions) {
    this.opts = opts;
  }

  async repair(d: CreationDirective, issues: CreationIssue[]): Promise<RepairResult> {
    const prompt = buildRepairPrompt(d, issues);
    const req: ChatRequest = {
      system: this.opts.system ?? "你输出严格 JSON（完整 CreationDirective），不输出解释。",
      messages: [{ role: "user", content: prompt }],
    };
    const res = await this.opts.provider.createCompletion(req, { schema: this.opts.schema ?? (creationDirectiveSchema() as unknown as object) });
    const raw = res.structured ?? safeJson(res.text);
    const fixed = sanitizeCreationDirective(raw, {
      character: d.character,
      canvas: d.canvas ?? { width: 512, height: 1024 },
      colorOf: () => null,
    });
    return { directive: fixed, fixes: issues.map((i) => "LLM 修复 " + i.rule + " @ " + i.path) };
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return {}; }
}

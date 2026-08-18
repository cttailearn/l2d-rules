// DSL 词法/语法/约束错误：携带 source 位置与稳定 code。
// 结构即传给 LLM 自修复的反馈格式（P4 创作通道直接消费）。

export const DSL_ERROR_CODES = ["LEX", "SYNTAX", "UNKNOWN_KEY", "UNSUPPORTED", "BAD_UNIT", "CONSTRAINT", "REF", "BAD_PARAM"] as const;
export type DslErrorCode = (typeof DSL_ERROR_CODES)[number];

export class DslError extends Error {
  readonly line: number;
  readonly col: number;
  readonly code: DslErrorCode;

  constructor(line: number, col: number, code: DslErrorCode, message: string) {
    super(message);
    this.line = line;
    this.col = col;
    this.code = code;
    this.name = "DslError";
  }
}

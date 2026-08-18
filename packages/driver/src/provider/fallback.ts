// provider/fallback.ts —— 健壮 JSON 提取（text 级万能降级）—— DEVELOPMENT-SPEC §6.7
// 链：围栏剥离 → 逐行解析（尾逗号修复）→ 跨行平衡花括号扫描 → 全无则 null。
// 共享跨 provider（text/grammar 输出都可能是自由文本）。

/** 尾逗号修复 + JSON.parse；可解析返回规整后的单行 JSON 字符串，否则 null。 */
function tryParseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // 修复尾逗号（如 {"a":1,} 或 [1,2,]）
    const fixed = trimmed.replace(/,\s*([}\]])/g, "$1");
    try {
      JSON.parse(fixed);
      return fixed;
    } catch {
      return null;
    }
  }
}

/** 在文本中扫描第一个平衡的 JSON 对象（跨行 pretty-print）；成功返回规整单行，否则 null。 */
function extractBalancedObject(text: string, from = 0): { json: string; end: number } | null {
  const start = text.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const raw = text.slice(start, i + 1);
        const one = raw.replace(/\s+/g, " ");
        return { json: one, end: i + 1 };
      }
    }
  }
  return null;
}

/**
 * 从 LLM 输出中提取 JSONL 行（行级原子：一行一个指令）。
 * 处理：markdown 围栏、尾逗号；全部单行都失败时跨行扫描平衡对象（pretty-print）。
 * 提取不到返回空数组（上游按"无输出"处理）。
 */
export function extractJsonLines(text: string): string[] {
  const clean = text.replace(/```(?:json)?/g, "").trim();
  const out: string[] = [];

  // 1) 逐行解析（含尾逗号修复）
  for (const rawLine of clean.split(/\r?\n/)) {
    const parsed = tryParseLine(rawLine);
    if (parsed !== null) out.push(parsed);
  }
  if (out.length > 0) return out;

  // 2) 全无单行 → 跨行 pretty-print：顺序扫描平衡对象
  let from = 0;
  for (;;) {
    const obj = extractBalancedObject(clean, from);
    if (!obj) break;
    out.push(obj.json);
    from = obj.end;
  }
  return out;
}

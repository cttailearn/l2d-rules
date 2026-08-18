// 词法器：把 .ldsl 源文本扫描为带行列号的 token 流。
// 行/列从 1 起；注释 // 到行尾被忽略；字符串支持 \" 与 \\ 转义。

import { DslError } from "./errors.ts";

export type TokKind = "ident" | "string" | "number" | "punct" | "eof";

export interface Token {
  kind: TokKind;
  text: string; // 原始文本（string 为去引号后内容）
  num?: number; // number 的数值
  unit?: string; // number 的单位后缀（ms/s/deg/px…，可能为扩展名，由解析器校验）
  line: number;
  col: number;
}

const PUNCTS = new Set(["{", "}", "[", "]", ":", ";", ",", "=", ".", "-", "->", "±"]);
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const UNIT_RE = /^[A-Za-z]+/;
const IDENT_START = /[\p{L}_]/u;
const IDENT_CHAR = /[\p{L}\p{N}_-]/u;
const WS = new Set([" ", "\t", "\r", "\n", "\f"]);

export function tokenize(source: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const here = (): { line: number; col: number } => ({ line, col });
  const bump = (s: string): void => {
    for (const ch of s) {
      if (ch === "\n") { line += 1; col = 1; } else { col += 1; }
    }
  };

  while (i < source.length) {
    const ch = source[i];

    if (WS.has(ch)) { bump(ch); i += 1; continue; }

    // 注释 // … 到行尾
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }

    const pos = here();

    // 字符串
    if (ch === '"') {
      i += 1; col += 1;
      let out = "";
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (c === "\\" && source[i + 1] === '"') { out += '"'; i += 2; col += 2; continue; }
        if (c === "\\" && source[i + 1] === "\\") { out += "\\"; i += 2; col += 2; continue; }
        if (c === '"') { closed = true; i += 1; col += 1; break; }
        if (c === "\n") throw new DslError(pos.line, pos.col, "LEX", "字符串未闭合（字符串内不得换行）");
        out += c; i += 1; col += 1;
      }
      if (!closed) throw new DslError(pos.line, pos.col, "LEX", "字符串未闭合");
      toks.push({ kind: "string", text: out, line: pos.line, col: pos.col });
      continue;
    }

    // 数字（含负号与单位后缀）
    const numM = NUM_RE.exec(source.slice(i));
    if (numM) {
      const raw = numM[0];
      i += raw.length; col += raw.length;
      let unit: string | undefined;
      const um = UNIT_RE.exec(source.slice(i));
      if (um) { unit = um[0]; i += um[0].length; col += um[0].length; }
      toks.push({ kind: "number", text: raw, num: Number(raw), unit, line: pos.line, col: pos.col });
      continue;
    }

    // 标识符（字母/下划线/中文开头，可含数字、下划线、连字符）
    if (IDENT_START.test(ch)) {
      let out = ch;
      i += 1; col += 1;
      while (i < source.length && IDENT_CHAR.test(source[i])) { out += source[i]; i += 1; col += 1; }
      toks.push({ kind: "ident", text: out, line: pos.line, col: pos.col });
      continue;
    }

    // 双字符记号 -> 优先
    if (ch === "-" && source[i + 1] === ">") {
      toks.push({ kind: "punct", text: "->", line: pos.line, col: pos.col });
      i += 2; col += 2;
      continue;
    }

    // 单字符标点
    if (PUNCTS.has(ch)) {
      toks.push({ kind: "punct", text: ch, line: pos.line, col: pos.col });
      i += 1; col += 1;
      continue;
    }

    throw new DslError(pos.line, pos.col, "LEX", `无法识别的字符 '${ch}'`);
  }

  toks.push({ kind: "eof", text: "<eof>", line, col });
  return toks;
}

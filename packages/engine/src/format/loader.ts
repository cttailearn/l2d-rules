// .l2dm 加载器 —— DEVELOPMENT-SPEC §5.1/§5.2（JSON → 模型对象 + atlas 引用校验）
// 职责分层：
//   parseL2dm      —— 结构解析：纯 JSON → L2dmModel 形状（不校验语义）
//   loadL2dm       —— 加载入口：JSON.parse + parse + validate（可带 atlas 文件名集合）
//   loadL2dmObject —— 直接加载已解析对象（同 loadL2dm 但省去 JSON.parse）

import { L2DM_FORMAT_VERSION, type L2dmModel } from "./types.ts";
import { validateL2dmModel, type L2dmValidation } from "./validate.ts";

export type LoadL2dmResult =
  | { ok: true; model: L2dmModel; validation: L2dmValidation }
  | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 结构解析：把未知 JSON 值安全地换成可进一步校验的 L2dmModel。
 * 不在此处做完整语义校验（由 validate 负责）；本层只保证类型/必需字段形状存在，
 * 并把缺失/错型归结为明确的 error，避免 validator 对 undefined 崩溃。
 */
export function parseL2dm(raw: unknown): { ok: true; model: LdmModelRaw } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "根必须是 JSON 对象" };
  if (raw.formatVersion !== L2DM_FORMAT_VERSION) {
    return { ok: false, error: `不支持的 formatVersion: ${String(raw.formatVersion)}（应为 ${L2DM_FORMAT_VERSION}）` };
  }
  if (typeof raw.id !== "string") return { ok: false, error: "id 必须为字符串" };
  if (!isObj(raw.canvas)) return { ok: false, error: "canvas 必须为对象" };
  if (!Array.isArray(raw.parameters)) return { ok: false, error: "parameters 必须为数组" };
  if (!Array.isArray(raw.parts)) return { ok: false, error: "parts 必须为数组" };

  // 结构规整：缺失的可选字段给默认（保持与类型契约一致），数组项类型由 validator 精细检查。
  const model: LdmModelRaw = {
    formatVersion: L2DM_FORMAT_VERSION,
    id: raw.id,
    canvas: raw.canvas as LdmModelRaw["canvas"],
    parameters: raw.parameters,
    parts: raw.parts,
    deformers: Array.isArray(raw.deformers) ? raw.deformers : [],
    physics: isObj(raw.physics) ? (raw.physics as LdmModelRaw["physics"]) : undefined,
    pose: isObj(raw.pose) ? (raw.pose as LdmModelRaw["pose"]) : undefined,
  };
  return { ok: true, model };
}

/** 内部类型：与 L2dmModel 同形，但字段为宽松 unknown 结构（validator 才做逐字段校验） */
interface LdmModelRaw {
  formatVersion: 1;
  id: string;
  canvas: { width: unknown; height: unknown };
  parameters: unknown[];
  parts: unknown[];
  deformers?: unknown[];
  physics?: unknown;
  pose?: unknown;
}

/** 从 JSON 字符串加载（parse + validate 一站式） */
export function loadL2dm(text: string, atlasFiles?: ReadonlySet<string>): LoadL2dmResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败: ${(e as Error).message}` };
  }
  return loadL2dmObject(raw, atlasFiles);
}

/** 从已解析对象加载（宿主可能已有 JSON.parse 结果） */
export function loadL2dmObject(raw: unknown, atlasFiles?: ReadonlySet<string>): LoadL2dmResult {
  const parsed = parseL2dm(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const validation = validateL2dmModel(parsed.model as L2dmModel, atlasFiles);
  if (!validation.ok) {
    return { ok: false, error: issuesToString(validation.issues) };
  }
  return { ok: true, model: parsed.model as L2dmModel, validation };
}

function issuesToString(issues: L2dmValidation["issues"]): string {
  return issues.map(i => `${i.path}: ${i.message}`).join("; ");
}

// llm-directive.ts —— P4「few-shot + 自修复」共用：创作指令的 LLM 提示词 / 结果清洗 / 主色提取
// LLM 幻觉只进结构化产物（CreationDirective），不进像素（架构红线 #4）——此处做确定性清洗：
//   去掉 image.dataUri（LLM 无法/不应回显大图）、保证 color 存在且 [0,1]、钳 bbox 入画布、滤非法关键帧。
import { dataUriToBytes, decodePng, type CutoutPart } from "@l2dp/cutout";
import type { CreationDirective, CreationIssue, CreationMotion, CreationPart } from "@l2dp/create";

/** 语义 → 确定性伪彩（LLM 未给 color 时的兜底；同语义同色，可复现）。 */
export function semanticPaletteColor(semantic: string): [number, number, number, number] {
  let h = 2166136261 >>> 0;
  for (const ch of semantic) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const hue = h % 360;
  // 简单 HSV(hue, .55, .9) → RGB
  const s = 0.55;
  const v = 0.9;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; } else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; } else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; } else { r = c; b = x; }
  return [r + m, g + m, b + m, 1];
}

/** 部件主色（0..1 RGBA；平均非透明像素；无像素 → null）。确定性。 */
export function dominantColorOfPart(part: CutoutPart): [number, number, number, number] | null {
  try {
    const img = decodePng(dataUriToBytes(part.image.dataUri));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let i = 0; i < img.width * img.height; i++) {
      const o = i * 4;
      const alpha = img.data[o + 3]!;
      if (alpha <= 0) continue;
      r += img.data[o]! * (alpha / 255);
      g += img.data[o + 1]! * (alpha / 255);
      b += img.data[o + 2]! * (alpha / 255);
      a += alpha / 255;
      n++;
    }
    if (n === 0) return null;
    const norm = a > 0 ? a : 1;
    return [Math.min(1, r / norm / 255), Math.min(1, g / norm / 255), Math.min(1, b / norm / 255), 1];
  } catch {
    return null;
  }
}

function clampBbox(b: unknown, canvas: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const o = (b ?? {}) as { x?: number; y?: number; width?: number; height?: number };
  const x = Math.max(0, Math.min(canvas.width - 1, Math.round(Number(o.x) || 0)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.round(Number(o.y) || 0)));
  const width = Math.min(canvas.width - x, Math.max(1, Math.round(Number(o.width) || 1)));
  const height = Math.min(canvas.height - y, Math.max(1, Math.round(Number(o.height) || 1)));
  return { x, y, width, height };
}

function finiteKeys(curve: unknown): [number, number][] {
  const keys: [number, number][] = [];
  let last = -Infinity;
  const arr = (curve as { keys?: unknown })?.keys;
  if (!Array.isArray(arr)) return keys;
  for (const k of arr) {
    if (!Array.isArray(k) || k.length < 2) continue;
    const t = Number(k[0]);
    const v = Number(k[1]);
    if (!Number.isFinite(t) || !Number.isFinite(v) || t <= last) continue;
    keys.push([t, v]);
    last = t;
  }
  return keys;
}

export interface SanitizeDefaults {
  character: string;
  canvas: { width: number; height: number };
  /** id → 兜底主色（LLM 未给 color 时） */
  colorOf?: (id: string) => [number, number, number, number] | null;
}

/**
 * 清洗 LLM 产出的 CreationDirective：确定性落地，坏字段钳制/回退而非抛错。
 * 注意不引入 image.dataUri——LLM 路径以 color 表达视觉（rig 用 color 渲染色块）。
 */
export function sanitizeCreationDirective(raw: unknown, defaults: SanitizeDefaults): CreationDirective {
  const o = (raw ?? {}) as Partial<CreationDirective> & Record<string, unknown>;
  const canvas = (o.canvas !== undefined && (o.canvas as { width?: number }).width! > 0 && (o.canvas as { height?: number }).height! > 0)
    ? o.canvas as { width: number; height: number }
    : defaults.canvas;
  const partsRaw = Array.isArray(o.parts) ? o.parts : [];
  const parts: CreationPart[] = partsRaw.map((p, i) => {
    const po = (p ?? {}) as Partial<CreationPart> & Record<string, unknown>;
    const id = typeof po.id === "string" && po.id.length > 0 ? po.id : "part-" + (i + 1);
    const semantic = (typeof po.semantic === "string" ? po.semantic : "face") as CreationPart["semantic"];
    const side = po.side === "left" || po.side === "right" ? po.side : undefined;
    const colorArr = Array.isArray(po.color) && po.color.length === 4
      && po.color.every((v) => Number.isFinite(v)) ? po.color : undefined;
    const fallback = defaults.colorOf?.(id) ?? semanticPaletteColor(semantic);
    const color: [number, number, number, number] = (colorArr
      ? (colorArr as number[]).map((v) => Math.min(1, Math.max(0, v)) as number)
      : fallback) as [number, number, number, number];
    return {
      id,
      semantic,
      ...(side !== undefined ? { side } : {}),
      bbox: clampBbox(po.bbox, canvas),
      color,
    };
  });

  const motions: CreationMotion[] = [];
  const motionsRaw: unknown = o.motions;
  if (Array.isArray(motionsRaw)) {
    for (const mRaw of motionsRaw as unknown[]) {
      if (mRaw === null || typeof mRaw !== "object") continue;
      const m = mRaw as Record<string, unknown>;
      const curvesRaw = Array.isArray(m.curves) ? m.curves : [];
      const curves = curvesRaw.map((c) => {
        const co = (c ?? {}) as Record<string, unknown>;
        const param = typeof co.param === "string" ? co.param : "微笑";
        const keys = finiteKeys(co);
        return { param, keys: keys.length > 0 ? keys : [[0, 0] as [number, number]] };
      });
      const rawKind = m.kind;
      const kind: CreationMotion["kind"] =
        rawKind === "idle" || rawKind === "blink" || rawKind === "talk" || rawKind === "surprise" ? rawKind : "idle";
      const dur = Number(m.durationMs);
      motions.push({
        name: typeof m.name === "string" && m.name.length > 0 ? m.name : "idle",
        kind,
        loop: m.loop === true,
        durationMs: Number.isFinite(dur) && dur > 0 ? dur : 4000,
        curves,
      });
    }
  }

  return {
    v: 1,
    character: typeof o.character === "string" && o.character.length > 0 ? o.character : defaults.character,
    canvas,
    parts,
    ...(o.hinge !== undefined && Number.isFinite((o.hinge as { x?: number }).x) ? { hinge: o.hinge as { x: number; y: number } } : {}),
    ...(o.physics === true || o.physics === false ? { physics: o.physics } : {}),
    ...(o.breathing === true || o.breathing === false ? { breathing: o.breathing } : {}),
    ...(motions.length > 0 ? { motions } : {}),
  };
}

/** P4 设计提示词：切图候选 → 整条 CreationDirective（few-shot）。 */
export function buildDesignPrompt(
  ctx: { character: string; canvas: { width: number; height: number }; parts: CutoutPart[] },
  vocabHint?: string[],
): string {
  const vocab = vocabHint && vocabHint.length > 0 ? vocabHint.join(",") : "hair_back,hair_side,hair_front,face,eye,eyeball,brow,mouth,nose,neck,body_upper,body_lower,arm_a,arm_b,leg,outfit_dress";
  const lines = [
    "你是 Live2D 角色创作设计器。给出切图候选（语义/bbox/主色），请产出一份【完整创作指令】CreationDirective v1。",
    "词表: " + vocab + "。语义名只能来自词表。",
    "要求：",
    "1. parts 覆盖所有候选：每个含 id、semantic、side(左右件用)、bbox(画布内)、color(RGBA 0..1)；不要 image/dataUri。",
    "2. motions 生成基础动作：idle(呼吸/眨眼循环)、blink、talk(口型)、surprise；每条含 name/kind/loop/durationMs/curves，curves 的 param 用角色语义参数名，keys 为 [t秒,值][]（t 递增）。",
    "3. 可选 hinge(重心锚点)、physics(发丝/胸摆)、breathing(true)。",
    "只输出严格 JSON 对象（含 v:1, character, canvas, parts, motions）。示例：",
    '{ "v":1, "character":"mychan", "canvas":{"width":512,"height":1024}, "parts":[ { "id":"r1", "semantic":"face", "bbox":{"x":100,"y":220,"width":200,"height":240}, "color":[1,0.9,0.85,1] }, { "id":"r2","semantic":"eye","side":"left","bbox":{"x":130,"y":260,"width":40,"height":20},"color":[0.2,0.2,0.2,1] } ], "hinge":{"x":256,"y":540}, "physics":true, "breathing":true, "motions":[ { "name":"idle","kind":"idle","loop":true,"durationMs":4000,"curves":[{"param":"胸呼吸","keys":[[0,0],[2,1],[4,0]]}] } ] }',
    "角色: " + ctx.character + "；画布: " + ctx.canvas.width + "x" + ctx.canvas.height,
    "切图候选：",
  ];
  for (const p of ctx.parts) {
    const col = dominantColorOfPart(p);
    const colStr = col ? " 主色≈[" + col.map((c) => c.toFixed(2)).join(",") + "]" : "";
    lines.push("[" + p.id + "] semantic=" + p.semantic + (p.side ? " side=" + p.side : "") + " bbox=" + JSON.stringify(p.bbox) + colStr);
  }
  return lines.join("\n");
}

/** P4 修复提示词：当前指令 + 校验问题 → 修正后的整条指令。 */
export function buildRepairPrompt(directive: CreationDirective, issues: CreationIssue[]): string {
  const digest = (() => {
    try { return JSON.stringify(directive); } catch { return "{}"; }
  })();
  const lines = [
    "你是 Live2D 创作修复器。下面是当前创作指令和【校验问题】清单。请输出修正后的完整 CreationDirective JSON。",
    "规则：语义名合法；bbox 在画布内；id 唯一；motions 的 keys 递增且有限；颜色 RGBA 0..1；只输出 JSON 对象。",
    "校验问题：",
  ];
  for (const i of issues) lines.push("- [" + i.rule + "] " + i.path + ": " + i.message);
  lines.push("当前指令(JSON):", digest);
  return lines.join("\n");
}

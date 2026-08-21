// moc/parse2.ts —— Cubism 2.x 配套解析：model.json（旧代）+ .mtn 动作（文本）
// model.json（旧代，KeySample 风格）：{ name, model, textures[], motions{}, expressions[], physics, pose, hitAreas[] }
// .mtn：# Live2D Animator Motion Data / $fps / $fadein / $fadeout / PARAM_X=v0,v1,...
//    每行一个参数 = 每帧采样值（帧率 $fps）；转换为引擎 motion3 Segments（线性逐帧）。
import type { EngineMotion } from "@l2dp/engine";

export interface Model2MotionEntry {
  file: string;
  fadeIn: number;
  fadeOut: number;
  sound?: string;
}

export interface Model2Json {
  name?: string;
  model?: string;
  textures: string[];
  physics?: string;
  pose?: string;
  expressions: { name: string; file: string }[];
  motions: Record<string, Model2MotionEntry[]>;
  hitAreas: { name: string; id: string }[];
}

export type MocParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 解析 Cubism 2 model.json（宽松只读；缺失字段友好缺省）。 */
export function parseModel2(raw: unknown): MocParseResult<Model2Json> {
  if (!isObj(raw)) return { ok: false, error: "model.json 顶层必须是对象" };
  const err = (m: string): MocParseResult<Model2Json> => ({ ok: false, error: m });
  const m = raw;
  if (typeof m.model === "string" && !/.moc$/i.test(m.model)) {
    return { ok: false, error: `model 字段非 .moc（得 "${m.model}"）` };
  }
  const textures: string[] = [];
  if (Array.isArray(m.textures)) for (const t of m.textures) if (typeof t === "string") textures.push(t);
  const motions: Model2Json["motions"] = {};
  if (isObj(m.motions)) {
    for (const [group, list] of Object.entries(m.motions)) {
      if (!Array.isArray(list)) continue;
      motions[group] = list
        .filter((e): e is Record<string, unknown> => isObj(e) && typeof e.file === "string")
        .map((e) => ({
          file: e.file as string,
          fadeIn: typeof e.fade_in === "number" ? e.fade_in : 0,
          fadeOut: typeof e.fade_out === "number" ? e.fade_out : 0,
          sound: typeof e.sound === "string" ? e.sound : undefined,
        }));
    }
  }
  const expressions: Model2Json["expressions"] = [];
  if (Array.isArray(m.expressions)) {
    for (const e of m.expressions as unknown[]) {
      if (isObj(e) && typeof e.file === "string") {
        expressions.push({ name: typeof e.name === "string" ? e.name : e.file, file: e.file });
      }
    }
  }
  const hitAreas: Model2Json["hitAreas"] = [];
  if (isObj(m.hit_areas)) {
    for (const [id, name] of Object.entries(m.hit_areas)) {
      if (typeof name === "string") hitAreas.push({ name, id });
    }
  }
  return {
    ok: true,
    value: {
      name: typeof m.name === "string" ? m.name : undefined,
      model: typeof m.model === "string" ? m.model : undefined,
      textures,
      physics: typeof m.physics === "string" ? m.physics : undefined,
      pose: typeof m.pose === "string" ? m.pose : undefined,
      expressions,
      motions,
      hitAreas,
    },
  };
}

export interface MtnMotion {
  fps: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
  /** 每参数按帧采样的值（长度=帧数） */
  curves: { id: string; values: number[] }[];
  durationMs: number;
}

export type MtnResult = MocParseResult<MtnMotion>;

/** 解析 .mtn 动作（文本）。 */
export function parseMtn(text: string): MtnResult {
  const lines = text.split(/\r?\n/);
  let fps = 30;
  let fadeIn = 0;
  let fadeOut = 0;
  let loop = true;
  const curves: MtnMotion["curves"] = [];
  let maxFrames = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key.startsWith("$")) {
      const k = key.slice(1).toLowerCase();
      if (k === "fps") fps = Number(val) || 30;
      else if (k === "fadein") fadeIn = Number(val) || 0;
      else if (k === "fadeout") fadeOut = Number(val) || 0;
      else if (k === "loop") loop = Number(val) !== 0;
      continue;
    }
    const values = val.split(",").map((s) => Number.parseFloat(s.trim())).filter((v) => Number.isFinite(v));
    if (values.length === 0) continue;
    curves.push({ id: key, values });
    if (values.length > maxFrames) maxFrames = values.length;
  }
  if (curves.length === 0) return { ok: false, error: "没有可解析的 PARAM_* 曲线" };
  if (maxFrames <= 0) maxFrames = 1;
  const durationMs = fps > 0 ? Math.max(1, Math.round(((maxFrames - 1) / fps) * 1000)) : 1;
  return { ok: true, value: { fps, fadeIn, fadeOut, loop, curves, durationMs } };
}

/** .mtn → 引擎动作（motion3 线性逐帧 Segments；时间秒）。 */
export function mtnToEngineMotion(text: string): { ok: boolean; error?: string; motion?: EngineMotion } {
  const p = parseMtn(text);
  if (!p.ok) return { ok: false, error: p.error };
  const m = p.value;
  const dt = 1 / Math.max(m.fps, 1);
  const curves: EngineMotion["curves"] = m.curves.map((c) => {
    const segs: number[] = [0, c.values[0] ?? 0];
    for (let i = 1; i < c.values.length; i++) {
      segs.push(0, i * dt, c.values[i] ?? 0); // Linear 段：type=0, t, v
    }
    return { id: c.id, segments: segs };
  });
  return { ok: true, motion: { durationMs: m.durationMs, loop: m.loop, curves } };
}
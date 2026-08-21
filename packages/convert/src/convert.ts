// convert.ts —— 官方 Live2D model3 包 → ConvertedBundle 转换主流程（Phase 1：JSON 链路）
// 步骤：parse model3 → loader 拉取 cdi3/physics3/pose3/userdata3/moc3(尺寸)/纹理(尺寸)
//       → 采集运动（motion3 → engine compat 导入）与表情（exp3 → compat）→ 组装 bundle。
// 设计要点：
//   - 真实官方 motion3/exp3 的 id 是 camelCase（ParamAngleX…），不在官方 PARAM_* 白名单，
//     故 engine compat 的语义门槛天然放行（PARAM_* 旧轨道才拒绝）。
//   - 单文件失败不阻塞整包：非致命问题进 warnings，致命（model3 不可解析）才整体失败。

import { importExpression3, importMotion3 } from "@l2dp/engine";
import { guessParamRange, mapEngineGroup } from "./map.ts";
import {
  parseCdi3, parseExp3, parseModel3, parseMotion3, parsePhysics3, parsePose3, parseUserData3, isObj,
} from "./parse.ts";
import { CONVERT_SYNTAX_VERSION, type ConvertedBundle, type ConvertOptions, type ConvertResult, type FileLoader } from "./types.ts";

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const base = i === -1 ? p : p.slice(i + 1);
  return base.replace(/\.(motion3|exp3)\.json$/i, "");
}

/** 读 JSON 文件成对象（loader 给 text → JSON.parse），失败给明确 error。 */
async function loadJson(loader: FileLoader, rel: string, what: string): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const f = await loader(rel);
  if (f.text === undefined) return { ok: false, error: `${what} '${rel}' 无法读取为文本` };
  try {
    return { ok: true, value: JSON.parse(f.text) };
  } catch (e) {
    return { ok: false, error: `${what} '${rel}' JSON 解析失败: ${(e as Error).message}` };
  }
}

export async function convertLive2dModel(
  model3Raw: unknown,
  loader: FileLoader,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const warnings: string[] = [];
  const parsed = parseModel3(model3Raw);
  if (!parsed.ok) return { ok: false, bundle: null, warnings, error: parsed.error };

  const m = parsed.value;
  const refs = m.FileReferences;
  const fail = (error: string): ConvertResult => ({ ok: false, bundle: null, warnings, error });
  /** model3 Groups 归一化为小写字段（引擎/驱动契约） */
  const groups3 = (m.Groups ?? []).map((g) => ({ target: g.Target, name: g.Name, ids: g.Ids }));

  // ---- 目录数据：cdi3（参数 / 参数分组 / 部件）----
  let paramCatalog: { Id: string; GroupId?: string; Name?: string }[] = [];
  let partCatalog: { Id: string; Name?: string }[] = [];
  if (refs.DisplayInfo) {
    const j = await loadJson(loader, refs.DisplayInfo, "cdi3(DisplayInfo)");
    if (!j.ok) return fail(j.error);
    const c = parseCdi3(j.value);
    if (!c.ok) return fail(`cdi3(${refs.DisplayInfo}): ${c.error}`);
    paramCatalog = c.value.Parameters ?? [];
    partCatalog = c.value.Parts ?? [];
  }

  // ---- 运动 / 表情 ----
  const motions: ConvertedBundle["motions"] = [];
  if (isObj(refs.Motions)) {
    for (const [group, list] of Object.entries(refs.Motions)) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!isObj(entry) || typeof entry.File !== "string") continue;
        const e = entry as { File: string; FadeInTime?: number; FadeOutTime?: number; Sound?: string };
        const j = await loadJson(loader, e.File, "motion3");
        if (!j.ok) { warnings.push(j.error); continue; }
        const mp = parseMotion3(j.value);
        if (!mp.ok || !mp.value.Curves || mp.value.Curves.length === 0) {
          warnings.push(`motion '${e.File}' 不可解析或空曲线，跳过`);
          continue;
        }
        const imported = importMotion3({
          meta: { duration: mp.value.Meta?.Duration ?? 0, fps: mp.value.Meta?.Fps ?? 30, loop: mp.value.Meta?.Loop ?? false },
          curves: mp.value.Curves.map((c) => ({ target: "Parameter", id: c.Id, segments: c.Segments })),
        });
        if (!imported.ok) {
          warnings.push(`motion '${e.File}' 非语义轨道被拒: ${imported.error}`);
          continue;
        }
        motions.push({
          group,
          file: e.File,
          name: basename(e.File),
          fadeIn: typeof e.FadeInTime === "number" ? e.FadeInTime : 0,
          fadeOut: typeof e.FadeOutTime === "number" ? e.FadeOutTime : 0,
          sound: typeof e.Sound === "string" ? e.Sound : undefined,
          motion: imported.value,
        });
      }
    }
  }

  const expressions: ConvertedBundle["expressions"] = [];
  for (const e of refs.Expressions ?? []) {
    const j = await loadJson(loader, e.File, "exp3");
    if (!j.ok) { warnings.push(j.error); continue; }
    const ep = parseExp3(j.value);
    if (!ep.ok) { warnings.push(`exp '${e.File}' 不可解析: ${ep.error}`); continue; }
    const imported = importExpression3({
      type: "Live2D Expression",
      parameters: (ep.value.Parameters ?? []).map((p) => ({ id: p.Id, value: p.Value ?? 0, blend: p.Blend ?? "Add" })),
    });
    if (!imported.ok) {
      warnings.push(`exp '${e.File}' 非语义参数被拒: ${imported.error}`);
      continue;
    }
    expressions.push({ file: e.File, name: e.Name ?? basename(e.File), expression: imported.value });
  }

  // ---- 参数面（cdi3 目录优先；无 cdi3 时退化：运动曲线 id ∪ model3 组 id）----
  const knownIds = new Set<string>();
  if (paramCatalog.length > 0) {
    for (const p of paramCatalog) knownIds.add(p.Id);
  } else {
    for (const mo of motions) for (const c of mo.motion.curves) knownIds.add(c.id);
    for (const g of groups3) for (const id of g.ids) knownIds.add(id);
  }
  const params: ConvertedBundle["params"] = [...knownIds].map((id) => {
    const cat = paramCatalog.find((p) => p.Id === id);
    const engineGroup = mapEngineGroup(id, cat?.GroupId, groups3);
    const r = opts.paramRanges?.[id] ?? guessParamRange(id);
    const def = r.def !== undefined && r.def >= r.min && r.def <= r.max ? r.def : 0;
    return { id, groupId: cat?.GroupId, displayName: cat?.Name, engineGroup, min: r.min, max: r.max, def };
  });
  params.sort((a, b) => a.id.localeCompare(b.id));

  const parts: ConvertedBundle["parts"] = partCatalog.map((p) => ({ id: p.Id, displayName: p.Name }));

  // ---- physics3 / pose3 / userdata3 ----
  let physics: ConvertedBundle["physics"] = null;
  if (refs.Physics) {
    const j = await loadJson(loader, refs.Physics, "physics3");
    if (j.ok) {
      const p = parsePhysics3(j.value);
      if (p.ok) {
        const settings: NonNullable<ConvertedBundle["physics"]>["settings"] = (p.value.PhysicsSettings ?? []).map((s) => ({
          id: String(s.Id ?? ""),
          name: p.value.Meta?.PhysicsDictionary?.find((d) => d.Id === s.Id)?.Name,
          inputs: (s.Input ?? [])
            .filter((i) => typeof i.Source?.Id === "string")
            .map((i) => ({
              param: i.Source!.Id!,
              weight: i.Weight ?? 0,
              type: i.Type === "X" || i.Type === "Y" || i.Type === "Angle" ? i.Type : "Angle",
              reflect: i.Reflect ?? false,
            })),
          outputs: (s.Output ?? [])
            .filter((o) => typeof o.Destination?.Id === "string")
            .map((o) => ({ param: o.Destination!.Id!, scale: o.Scale ?? 0, weight: o.Weight ?? 0, reflect: o.Reflect ?? false })),
          vertices: (s.Vertices ?? []).map((v) => ({
            x: v.Position?.X ?? 0,
            y: v.Position?.Y ?? 0,
            mobility: v.Mobility ?? 0,
            delay: v.Delay ?? 0,
            acceleration: v.Acceleration ?? 0,
            radius: v.Radius ?? 0,
          })),
          normalization: s.Normalization ? { position: s.Normalization.position, angle: s.Normalization.angle } : null,
        }));
        physics = {
          gravity: {
            x: p.value.Meta?.EffectiveForces?.Gravity?.X ?? 0,
            y: p.value.Meta?.EffectiveForces?.Gravity?.Y ?? 0,
          },
          wind: {
            x: p.value.Meta?.EffectiveForces?.Wind?.X ?? 0,
            y: p.value.Meta?.EffectiveForces?.Wind?.Y ?? 0,
          },
          settings,
        };
      } else warnings.push(`physics3(${refs.Physics}): ${p.error}`);
    } else warnings.push(j.error);
  }

  let pose: ConvertedBundle["pose"] = null;
  if (refs.Pose) {
    const j = await loadJson(loader, refs.Pose, "pose3");
    if (j.ok) {
      const p = parsePose3(j.value);
      if (p.ok) {
        pose = {
          groups: (p.value.Groups ?? []).map((g) => {
            const links: Record<string, string[]> = {};
            for (const e of g) links[e.Id] = e.Link;
            return { ids: g.map((e) => e.Id), links };
          }),
        };
      } else warnings.push(`pose3(${refs.Pose}): ${p.error}`);
    } else warnings.push(j.error);
  }

  let userData: ConvertedBundle["userData"] = null;
  if (refs.UserData) {
    const j = await loadJson(loader, refs.UserData, "userdata3");
    if (j.ok) {
      const p = parseUserData3(j.value);
      if (p.ok) {
        userData = (p.value.UserData ?? [])
          .filter((u) => typeof u.Id === "string")
          .map((u) => ({ target: u.Target ?? "ArtMesh", id: u.Id!, value: u.Value ?? "" }));
      } else warnings.push(`userdata3(${refs.UserData}): ${p.error}`);
    } else warnings.push(j.error);
  }

  // ---- .moc3 / 纹理尺寸（Phase 2 解析几何；这里只记录存在性与尺寸）----
  let mocSize: number | null = null;
  try { const f = await loader(refs.Moc); if (f.bytes) mocSize = f.bytes.byteLength; } catch { /* 缺省 */ }
  const textures: ConvertedBundle["fileRefs"]["textures"] = [];
  for (const t of refs.Textures) {
    let size = 0;
    try { const f = await loader(t); if (f.bytes) size = f.bytes.byteLength; } catch { /* 缺省 */ }
    textures.push({ file: t, size });
  }

  const bundle: ConvertedBundle = {
    format: "l2dp-converted",
    syntaxVersion: CONVERT_SYNTAX_VERSION,
    source: opts.name,
    version: m.Version,
    fileRefs: {
      moc: refs.Moc,
      mocSize,
      textures,
      physics: refs.Physics,
      pose: refs.Pose,
      displayInfo: refs.DisplayInfo,
      userData: refs.UserData,
    },
    params,
    parts,
    groups: groups3,
    hitAreas: (m.HitAreas ?? []).map((h) => ({ id: h.Id, name: h.Name })),
    layout: m.Layout,
    motions,
    expressions,
    physics,
    pose,
    userData,
  };

  return { ok: true, bundle, warnings };
}

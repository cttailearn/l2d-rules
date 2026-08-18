import type { Manifest, Part, Mesh, ParamDef, Groups, Motion, Expression, Physics } from "./types.ts";
import { isStandardParam, PARAM_GROUPS } from "./params.ts";
import { validatePartId } from "./naming.ts";

export interface Issue { path: string; message: string; }

export interface L2dpValidation {
  ok: boolean;
  issues: Issue[];
}

function push(issues: Issue[], path: string, message: string) { issues.push({ path, message }); }

// 校验整包清单（manifest 引用完整性 + 部件/网格/参数规则）
export function validateManifest(manifest: Manifest, parts: Part[], meshes: Mesh[], params: ParamDef[], groups?: Groups, motions: Motion[] = [], expressions: Expression[] = [], physics?: Physics): L2dpValidation {
  const issues: Issue[] = [];
  if (manifest.schemaVersion !== 2) push(issues, "manifest.schemaVersion", "schemaVersion 必须为 2");
  if (manifest.displayInfo.pixelsPerUnit <= 0) push(issues, "manifest.displayInfo.pixelsPerUnit", "pixelsPerUnit 必须 > 0");
  if (!manifest.fileManifest.textures.length) push(issues, "fileManifest.textures", "至少 1 个纹理页");
  const texCount = manifest.fileManifest.textures.length;

  const partIds = new Set<string>();
  parts.forEach((p, i) => {
    const path = `parts[${i}] (${p.id})`;
    const nv = validatePartId(p.id, p.category);
    nv.errs.forEach(e => push(issues, path, e));
    if (partIds.has(p.id)) push(issues, path, "重复部件 id");
    partIds.add(p.id);
    if (p.opacity < 0 || p.opacity > 1) push(issues, path, "opacity 须在 0..1");
    if (p.texturePage < 0 || p.texturePage >= texCount) push(issues, path, `texturePage ${p.texturePage} 越界（共 ${texCount} 页）`);
    p.diffs.forEach((d, di) => {
      const dp = `${path}.diffs[${di}]`;
      if (!d.src) push(issues, dp, "差分资源路径为空（须同时存在于 textures 声明）");
      d.paramCondition?.forEach((c, ci) => {
        if (c.min >= c.max) push(issues, `${dp}.paramCondition[${ci}]`, "差分条件区间无效（min 须 < max）");
      });
    });
  });

  meshes.forEach((m, i) => {
    const path = `meshes[${i}] (${m.id})`;
    if (!partIds.has(m.partId)) push(issues, path, `引用不存在的部件 ${m.partId}`);
    if (m.triangles.length % 3 !== 0) push(issues, path, "三角形索引数必须为 3 的倍数");
    const vLen = m.vertices.length;
    m.triangles.forEach(t => { if (t < 0 || t >= vLen) push(issues, path, `三角形索引越界 ${t}`); });
    m.vertices.forEach((v, vi) => {
      if (v.u < 0 || v.u > 1 || v.v < 0 || v.v > 1) push(issues, `${path}.vertices[${vi}]`, "UV 须在 0..1");
    });
  });

  const paramIds = new Set<string>();
  params.forEach((p, i) => {
    const path = `params[${i}] (${p.id})`;
    if (paramIds.has(p.id)) push(issues, path, "重复参数 id");
    paramIds.add(p.id);
    if (p.standard && !isStandardParam(p.id)) push(issues, path, `标准参数不在官方白名单: ${p.id}`);
    if (p.standard && p.min >= p.max) push(issues, path, "参数范围无效");
  });

  const groupIds = groups?.paramGroups.flatMap(g => g.ids) ?? [];
  groupIds.forEach(id => { if (!paramIds.has(id) && !isStandardParam(id)) push(issues, `groups`, `参数组引用不存在的参数 ${id}`); });
  Object.entries(PARAM_GROUPS).forEach(([name, ids]) => {
    ids.forEach(id => { if (!paramIds.has(id)) push(issues, "groups", `标准参数组 ${name} 缺少参数 ${id}（规范约定必须存在）`); });
  });

  const idle = motions.filter(m => m.meta && typeof m.meta.duration === "number");
  if (!idle.length) push(issues, "motions", "约定：Idle 组必须存在至少 1 条动作");

  return { ok: issues.length === 0, issues };
}

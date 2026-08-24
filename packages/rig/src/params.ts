// params.ts —— 半自动 rig 的语义参数词表 + 派生
// 引擎参数即语义名（.l2dm 惯例）；分组对齐 L2DM_PARAM_GROUPS 与 driver 环境层（Ambient/EyeBlink/Head/Body/Physics）。
import type { L2dmParamGroup } from "@l2dp/engine";
import { CLOTHING_SEMANTICS, type RigPartSpec, type RigSemantic } from "./types.ts";

export interface RigParamDef {
  min: number;
  max: number;
  def?: number;
  group?: L2dmParamGroup;
}

/** 词表：参数 → 范围/组。范围即引擎参数空间（env 层按 group 给信号，motion 按值驱动）。 */
export const RIG_PARAM_DEFS: Record<string, RigParamDef> = {
  呼吸:   { min: 0, max: 1, def: 0, group: "Ambient" },
  身转:   { min: -10, max: 10, def: 0, group: "Body" },
  头转向: { min: -30, max: 30, def: 0, group: "Head" },
  头点头: { min: -30, max: 30, def: 0, group: "Custom" },
  眼闭左: { min: 0, max: 1, def: 0, group: "EyeBlink" },
  眼闭右: { min: 0, max: 1, def: 0, group: "EyeBlink" },
  眉左升: { min: -1, max: 1, def: 0, group: "Custom" },
  眉右升: { min: -1, max: 1, def: 0, group: "Custom" },
  嘴开:   { min: 0, max: 1, def: 0, group: "LipSync" },
  嘴笑:   { min: 0, max: 1, def: 0, group: "Custom" },
  发摆:   { min: -1, max: 1, def: 0, group: "Physics" },
  脸红:   { min: 0, max: 1, def: 0, group: "Custom" },
  身摆:   { min: -1, max: 1, def: 0, group: "Body" },
  臂摆:   { min: -1, max: 1, def: 0, group: "Custom" },
  腿摆:   { min: -1, max: 1, def: 0, group: "Custom" },
  胸摆:   { min: -1, max: 1, def: 0, group: "Physics" },
  尾巴摆: { min: 0, max: 1, def: 0, group: "Custom" },
  耳朵动: { min: -1, max: 1, def: 0, group: "Custom" },
  翅膀扇: { min: -1, max: 1, def: 0, group: "Custom" },
  分级隐藏: { min: 0, max: 1, def: 0, group: "Custom" }, // B-6：成人部件默认隐藏开关（ContentPolicy 置 1 才可见）
};

const BASE = ["呼吸", "身转"] as const;
const HEAD = ["头转向", "头点头"] as const;
const EYES = ["眼闭左", "眼闭右", "眉左升", "眉右升"] as const;
const MOUTH = ["嘴开", "嘴笑"] as const;
const HEAD_TRIGGER: readonly RigSemantic[] = [
  "face", "eye", "eyeball", "brow", "mouth", "nose", "hoho", "ear_beast",
  "hair_front", "hair_side", "hair_back", "ear", "neck",
];
const BLUSH_TRIGGER: readonly RigSemantic[] = ["hoho"];

export interface DerivedParam { id: string; min: number; max: number; def?: number; group?: L2dmParamGroup }

/** 服装组 → 可见性参数名（B-3）：衣装组<N>。 */
export function costumeParamOf(group: number): string {
  return "衣装组" + group;
}

/** 服装语义判定（B-3）：只在服装层词表内。 */
function isClothingSemantic(sem: string): boolean {
  return (CLOTHING_SEMANTICS as readonly string[]).includes(sem);
}

/** 收集服装组（B-3）：仅服装语义部件的 costumeGroup 去重升序；附带组成员 id 清单（身体部件不参与换装）。 */
export function collectCostumeGroups(
  parts: RigPartSpec[],
): { group: number; param: string; partIds: string[] }[] {
  const byGroup = new Map<number, string[]>();
  for (const p of parts) {
    if (!isClothingSemantic(p.semantic as string)) continue; // 身体层/非标准部件不随服装组
    const cg = (p as { costumeGroup?: number }).costumeGroup ?? 1;
    const list = byGroup.get(cg) ?? [];
    list.push(p.id);
    byGroup.set(cg, list);
  }
  const groups = [...byGroup.keys()].sort((a, b) => a - b);
  const defaultGroup = groups[0] ?? 1;
  return groups.map((g) => ({
    group: g,
    param: costumeParamOf(g),
    partIds: byGroup.get(g) ?? [],
    ...(g === defaultGroup ? { defaultVisible: true as true | undefined } : {}),
  }));
}

/** 依据部件集合推导需要的参数（模型只含被实际绑定/被驱动者，保持最小闭合）。 */
export function deriveParameters(
  parts: RigPartSpec[],
  opts: { physics: boolean },
): DerivedParam[] {
  const sems = new Set(parts.map((p) => p.semantic));
  const ids: string[] = [...BASE];
  if (sems.size > 0 && HEAD_TRIGGER.some((s) => sems.has(s))) ids.push(...HEAD);
  if (sems.has("eye") || sems.has("eyeball") || sems.has("brow")) ids.push(...EYES);
  if (sems.has("mouth")) ids.push(...MOUTH);
  if (sems.has("body_upper") || sems.has("body_lower")) ids.push("身摆");
  if (sems.has("body_lower")) ids.push("腿摆");
  if (sems.has("arm_a") || sems.has("arm_b")) ids.push("臂摆");
  if (sems.has("adult_breast")) ids.push("胸摆");
  if (sems.has("tail")) ids.push("尾巴摆");
  if (sems.has("ear_beast")) ids.push("耳朵动");
  if (sems.has("wing")) ids.push("翅膀扇");
  if (BLUSH_TRIGGER.some((s) => sems.has(s))) ids.push("脸红");
  if (opts.physics && (sems.has("hair_front") || sems.has("hair_side") || sems.has("hair_back"))) {
    ids.push("发摆");
  }
  // B-6：成人分级部件存在 → 提供「分级隐藏」开关（默认 0 隐藏）
  if (sems.has("adult_breast") || sems.has("adult_genital")) ids.push("分级隐藏");
  // B-3：服装组可见性参数（衣装组<N>；最小组默认可见 def=1，其余 0）
  const costumes = collectCostumeGroups(parts);
  const defaultGroup = costumes[0]?.group;
  for (const c of costumes) {
    ids.push(c.param);
  }
  const out = new Map<string, DerivedParam>();
  for (const id of ids) {
    if (id.startsWith("衣装组")) {
      const g = Number(id.slice(3));
      out.set(id, { id, min: 0, max: 1, def: g === defaultGroup ? 1 : 0, group: "Custom" });
    } else {
      out.set(id, { id, ...RIG_PARAM_DEFS[id] });
    }
  }
  for (const p of parts) {
    for (const [k, v] of Object.entries(p.customParams ?? {})) {
      out.set(k, { id: k, min: v.min ?? 0, max: v.max ?? 1, def: v.def, group: v.group });
    }
  }
  return [...out.values()];
}

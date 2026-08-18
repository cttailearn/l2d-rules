import type { Category } from "./types.ts";

// 部件命名规则：PARTS_<工程号>_<部件名>_<服装组号>
// 身体层不带组号；服装层必须带组号；工程号默认 01
const PART_ID_RE = /^PARTS_(\d{2})_(.+?)(?:_(\d{3}))?$/;

export const BODY_TYPES = ["hair","eye","brow","mouth","nose","ear","face_skin","breast","genital","limb"] as const;
export const CLOTHING_TYPES = ["hairstyle","underwear","top","bottom","dress","shoes","socks","accessory"] as const;
export const BODY_PART_NAMES = new Set([
  "face","hoho","ear","nose","eye","eyeball","brow","mouth","neck",
  "hair_back","hair_side","hair_front",
  "body_upper","body_lower","arm_a","arm_b","leg","feet",
  "adult_breast","adult_genital",
]);

export interface ParsedPartId {
  raw: string;
  projectNo: string;
  name: string;
  costumeGroup: number | null;
}

export function parsePartId(id: string): ParsedPartId | null {
  const m = PART_ID_RE.exec(id);
  if (!m) return null;
  return { raw: id, projectNo: m[1], name: m[2], costumeGroup: m[3] ? Number(m[3]) : null };
}

export function buildPartId(name: string, opts: { projectNo?: string; costumeGroup?: number | null } = {}): string {
  const proj = opts.projectNo ?? "01";
  if (opts.costumeGroup == null) return `PARTS_${proj}_${name}`;
  const g = String(opts.costumeGroup).padStart(3, "0");
  return `PARTS_${proj}_${name}_${g}`;
}

export function validatePartId(id: string, category: Category): { ok: boolean; errs: string[] } {
  const errs: string[] = [];
  const parsed = parsePartId(id);
  if (!parsed) { errs.push(`非法部件 ID（须满足 PARTS_<工程号>_<部件名>_<服装组号>）: ${id}`); return { ok: false, errs }; }
  if (category === "clothing" && parsed.costumeGroup == null) errs.push(`服装层部件必须带服装组号: ${id}`);
  if (category === "body" && parsed.costumeGroup != null) errs.push(`身体层部件不得带服装组号: ${id}`);
  if (category === "body" && !BODY_PART_NAMES.has(parsed.name)) errs.push(`身体层部件名不在白名单（specs/parts-naming.json）: ${parsed.name}`);
  return { ok: errs.length === 0, errs };
}

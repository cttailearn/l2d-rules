// moc3/deformers.ts —— moc3 M4：deformer 树 + rotation 形变 → `.l2dm.deformers`（+ 部件父级接线）
// 语义（与 Cubism 3 runtime 约定一致；坐标系经 to-l2dm 的 y 翻转/缩放对齐画布空间）：
//   - deformer 树：deformer.parent_deformer_indices（warp/rotation 通用）→ `.l2dm.deformers`
//   - rotation deformer → `.l2dm.deformer{ pivot: origin, bindings:[{parameter, channel:"rotation", from, to}] }`
//     from/to = keyform 角度相对 base 角度的偏移（y 翻转后取反；.l2dm rotation 为角度增量累加）
//   - 驱动参数解析：deformer.keyform_binding_band_indices → band → binding → keys（参数轴关键值），
//     再由 parameter.keyform_binding_begin/counts 反查参数 id（同 band）
//   - 部件接线：art_mesh.parent_deformer_indices → `.l2dm.parts[].parent`
//
// 边界：warp（curved-surface）deformer 的网格形变（keyform 顶点偏移 → `.l2dm.warps`）仍需
// 官方网格插值算法地面真值，暂记入 docs/MOC3-PHASE2-PLAN.md 的 M4 尾随。

import type { L2dmDeformer, L2dmModel } from "@l2dp/engine";
import type { Moc3Data } from "./moc3.ts";

export interface Moc3DeformersOptions {
  /** y 翻转/缩放已应用的画布空间映射（供 origin/pivot 换算） */
  toCanvas?: (x: number, y: number) => [number, number];
  /** 是否输出 deformers（缺省 true） */
  emit?: boolean;
  /**
   * 实验性：解析 rotation deformer 的精确旋转 binding。
   * 默认关闭 —— deformer origin 坐标系（非顶点单位）无法离线验证，打开可能渲染失真。
   */
  rotationBindings?: boolean;
}

function num(s: Moc3Data["sections"], name: string): number[] {
  return (s[name] ?? []) as number[];
}
function str(s: Moc3Data["sections"], name: string): string[] {
  return (s[name] ?? []) as string[];
}

/** 解析 deformer 的驱动参数（关键帧绑定反查）：
 *  band(12) → keyform_binding_index(11) 区间 → binding(13) 集合；
 *  parameter.keyform_binding_begin/counts 同为 (11) 下标，其区间与 deformer 的绑定集合相等即命中 */
export function resolveDeformerParameter(
  S: Moc3Data["sections"],
  band: number,
): string | undefined {
  const kbbIndex = num(S, "keyform_binding_index.indices");
  const bands = num(S, "keyform_binding_band.begin_indices");
  const bandCounts = num(S, "keyform_binding_band.counts");
  if (band < 0 || band >= bands.length) return undefined;
  const wanted = new Set<number>();
  const bs = bands[band] ?? 0;
  const bc = bandCounts[band] ?? 0;
  for (let j = 0; j < bc; j++) wanted.add(kbbIndex[bs + j] ?? -1);
  if (wanted.size === 0) return undefined;
  const paramIds = str(S, "parameter.ids");
  const pKBegin = num(S, "parameter.keyform_binding_begin_indices");
  const pKCount = num(S, "parameter.keyform_binding_counts");
  for (let pi = 0; pi < paramIds.length; pi++) {
    const begin = pKBegin[pi] ?? -1;
    const count = pKCount[pi] ?? 0;
    if (begin < 0 || count <= 0) continue;
    let hit = true;
    for (let m = 0; m < count; m++) if (!wanted.has(kbbIndex[begin + m] ?? -1)) { hit = false; break; }
    if (hit) return paramIds[pi];
  }
  return undefined;
}
/** 读一个 band 的参数轴 key 值（keys.values[绑定区间]） */
export function bandKeys(S: Moc3Data["sections"], band: number): number[] {
  const bands = num(S, "keyform_binding_band.begin_indices");
  const bandCounts = num(S, "keyform_binding_band.counts");
  const kbbIndex = num(S, "keyform_binding_index.indices");
  const kbKeysBegin = num(S, "keyform_binding.keys_begin_indices");
  const kbKeysCount = num(S, "keyform_binding.keys_counts");
  const keys = num(S, "keys.values");
  if (band < 0 || band >= bands.length) return [];
  const bi = bands[band] ?? 0;
  const bc = bandCounts[band] ?? 0;
  const out: number[] = [];
  for (let j = 0; j < bc; j++) {
    const bix = kbbIndex[bi + j] ?? -1;
    if (bix < 0) continue;
    const k0 = kbKeysBegin[bix] ?? 0;
    const kn = kbKeysCount[bix] ?? 0;
    for (let m = 0; m < kn; m++) out.push(keys[k0 + m] ?? 0);
  }
  return out;
}

export type Moc3DeformersResult = {
  deformers: L2dmDeformer[];
  /** art_mesh 索引 → 父 deformer id */
  meshParents: Map<number, string>;
};

/**
 * 从 moc3 构建 .l2dm deformer 树 + art mesh 父级接线。
 * 坐标系：需要调用方提供 toCanvas（y 翻转/缩放），缺省恒等。
 */
export function buildDeformers(moc: Moc3Data, opts: Moc3DeformersOptions = {}): Moc3DeformersResult {
  const S = moc.sections;
  const toCanvas = opts.toCanvas ?? ((x: number, y: number): [number, number] => [x, y]);
  const deformers: L2dmDeformer[] = [];
  const meshParents = new Map<number, string>();

  const dIds = str(S, "deformer.ids");
  const dParent = num(S, "deformer.parent_deformer_indices");
  const dType = num(S, "deformer.types");
  const dSpecific = num(S, "deformer.specific_indices");
  const dKBBand = num(S, "deformer.keyform_binding_band_indices");
  const rdBand = num(S, "rotation_deformer.keyform_binding_band_indices");
  const rdKFBegin = num(S, "rotation_deformer.keyform_begin_indices");
  const rdKFCount = num(S, "rotation_deformer.keyform_counts");
  const rdBase = num(S, "rotation_deformer.base_angles");
  const rdkAngles = num(S, "rotation_deformer_keyform.angles");
  const rdkOriginX = num(S, "rotation_deformer_keyform.origin_xs");
  const rdkOriginY = num(S, "rotation_deformer_keyform.origin_ys");

  for (let di = 0; di < dIds.length; di++) {
    const id = dIds[di]!.trim();
    if (!id) continue;
    const def: L2dmDeformer = { id };
    const parent = dParent[di];
    if (parent !== undefined && parent >= 0 && parent >= 0 && parent < dIds.length) {
      def.parent = dIds[parent]!.trim();
    }
    const type = dType[di] ?? 0;
    const specific = dSpecific[di] ?? 0;
    if (type === 1 && opts.rotationBindings === true) {
      // 实验性：rotation deformer pivot=origin + 精确 rotation binding
      // （origin 坐标系无法离线验证；仅显式开启时输出）
      const band = specific >= 0 && specific < rdBand.length ? (rdBand[specific] ?? -1) : -1;
      const param = band >= 0 ? resolveDeformerParameter(S, band) : undefined;
      const kfBegin = rdKFBegin[specific] ?? 0;
      const kfCount = rdKFCount[specific] ?? 0;
      const baseAngle = rdBase[specific] ?? 0;
      const ox = rdkOriginX[kfBegin] ?? 0;
      const oy = rdkOriginY[kfBegin] ?? 0;
      const [px, py] = toCanvas(ox, oy);
      def.pivot = { x: px, y: py };
      if (param && kfCount >= 3) {
        // 以「默认/中位 keyform」为静止参考，输出相对旋转
        const mid = kfBegin + (kfCount >> 1);
        const rest = rdkAngles[mid] ?? baseAngle;
        const a0 = rdkAngles[kfBegin] ?? rest;
        const a1 = rdkAngles[kfBegin + kfCount - 1] ?? rest;
        const from = -(a0 - rest);
        const to = -(a1 - rest);
        if (Number.isFinite(from) && Number.isFinite(to) && from !== to) {
          def.bindings = [{ parameter: param, channel: "rotation", from, to }];
        }
      }
    } else {
      // warp（curved-surface）deformer：树结构 + 枢轴占位（网格形变后续里程碑）
      const band = specific >= 0 && specific < rdBand.length ? (rdBand[specific] ?? -1) : specific >= 0 && specific < dKBBand.length ? (dKBBand[specific] ?? -1) : -1;
      void band;
    }
    deformers.push(def);
  }

  // ---- art mesh → 父 deformer ----
  const amParentDef = num(S, "art_mesh.parent_deformer_indices");
  for (let mi = 0; mi < amParentDef.length; mi++) {
    const p = amParentDef[mi];
    if (p !== undefined && p >= 0 && p < dIds.length) {
      const pid = dIds[p]!.trim();
      if (pid) meshParents.set(mi, pid);
    }
  }

  return { deformers, meshParents };
}
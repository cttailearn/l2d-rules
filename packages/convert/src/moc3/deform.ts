// moc3/deform.ts —— C2：keyform 绑定 + deformer compose（≈ 精简版 CubismCore 更新管线）
// 从 .moc3 数据（零平台依赖）还原每一步形变，产出「每 Mesh 每 参数 keyform 偏移」（→ .l2dm mesh.warps）。
//
// 语义（经官方 CubismCore 3.3 黑盒验证，见 docs/MOC3-PHASE2-PLAN.md §C2）：
//   - Mesh 源位置 = 自身 art_mesh keyform 按驱动参数插值（全部参数默认时的姿态）
//   - warp（curved-surface）deformer：位移场 Δ(u,v) = 双线性(当前keyforms网格,u,v) − 双线性(rest网格,u,v)，
//     u,v = 顶点当前坐标在 rest 矩形 (x0..x1)×(y0..y1) 内的归一化位置；位移叠加到当前位置
//   - rotation deformer：绕该 keyform origin 旋转（角度δ按绑定参数插值），叠加到当前位置
//   - 链式合成：mesh → 父 deformer … → 根，自下而上逐级叠加
//   - 烘焙：对每个影响 Mesh 的参数，沿其轴在关键值处求整链形变 − 基准形变 = keyform 偏移；
//     引擎逐参数累加（accumulateKeyforms）即与官方量级一致。
import type { L2dmWarp, L2dmKeyform } from "@l2dp/engine";
import type { Moc3Data } from "./moc3.ts";

export interface Moc3ParamAxis {
  id: string;
  def: number;
}

/** 单绑定 band 的 keyform 轴值（多绑定=近似取并集，按参数顺序拼接） */
export function bandAxisKeys(moc: Moc3Data, band: number): number[] {
  return bandAxis(moc, band).keys;
}

export function bandAxis(moc: Moc3Data, band: number): { keys: number[]; param: string | undefined } {
  const S = moc.sections;
  const num = (n: string) => (S[n] ?? []) as number[];
  const str = (n: string) => (S[n] ?? []) as string[];
  const bBegin = num("keyform_binding_band.begin_indices");
  const bCount = num("keyform_binding_band.counts");
  const kbb = num("keyform_binding_index.indices");
  const kbKeysBegin = num("keyform_binding.keys_begin_indices");
  const kbKeysCount = num("keyform_binding.keys_counts");
  const keys = num("keys.values");
  if (band < 0 || band >= bBegin.length) return { keys: [], param: undefined };
  const out: number[] = [];
  const bs = bBegin[band] ?? 0;
  const bc = bCount[band] ?? 0;
  for (let j = 0; j < bc; j++) {
    const ix = kbb[bs + j] ?? -1;
    if (ix < 0) continue;
    const k0 = kbKeysBegin[ix] ?? 0;
    const kn = kbKeysCount[ix] ?? 0;
    for (let m = 0; m < kn; m++) out.push(keys[k0 + m] ?? 0);
  }
  // 参数反查（与 resolveDeformerParameter 同策略）
  const wanted = new Set<number>();
  for (let j = 0; j < bc; j++) wanted.add(kbb[bs + j] ?? -1);
  const pIds = str("parameter.ids");
  const pKB = num("parameter.keyform_binding_begin_indices");
  const pKC = num("parameter.keyform_binding_counts");
  let param: string | undefined;
  for (let pi = 0; pi < pIds.length; pi++) {
    const bb = pKB[pi] ?? -1, cc = pKC[pi] ?? 0;
    if (bb < 0 || cc <= 0) continue;
    let hit = true;
    for (let m = 0; m < cc; m++) if (!wanted.has(kbb[bb + m] ?? -1)) { hit = false; break; }
    if (hit) { param = pIds[pi]!.trim(); break; }
  }
  return { keys: out, param };
}

/** 按轴值 v 取 keyform 区间与比例（v 钳制到 [first,last]；严格递增保证） */
export function axisRange(keys: readonly number[], v: number): [number, number, number] {
  const n = keys.length;
  if (n === 0) return [0, 0, 0];
  if (v <= keys[0]!) return [0, 0, 0];
  if (v >= keys[n - 1]!) return [n - 1, n - 1, 1];
  let lo = 0;
  for (let i = 1; i < n - 1; i++) if (keys[i]! <= v) lo = i;
  const hi = lo + 1;
  const t = (v - keys[lo]!) / (keys[hi]! - keys[lo]!);
  return [lo, hi, t];
}

/** 逐顶点序列沿轴插值：series[j] = keyform j 的 (N) 个值；返回插值数组 */
type NumArr = readonly number[] | Float64Array;
export function interpSeries(keys: readonly number[], series: readonly NumArr[], v: number): Float64Array {
  const n = series[0]?.length ?? 0;
  const out = new Float64Array(n);
  if (series.length === 0) return out;
  if (series.length === 1) { out.set(series[0] as NumArr); return out; }
  const [lo, hi, t] = axisRange(keys, v);
  const a = series[lo]!, b = series[hi]!;
  for (let i = 0; i < n; i++) out[i] = (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * t;
  return out;
}

export interface WarpDeformer {
  rows: number;
  cols: number;
  /** (rows+1)*(cols+1) 控制点 [x0,y0, x1,y1, …]（canvas 空间） */
  rest: Float64Array;
  keyforms: Float64Array[];
  keys: number[];
  param: string | undefined;
}

export interface RotationDeformer {
  keys: number[];
  params: string | undefined;
  keyforms: { origin: [number, number]; angle: number }[];
  /** 默认参数下（rest）的角度 → 形变=插值角−默认角（保证 rest 恒等） */
  angleAtDefault: number;
}

export interface DeformerNode {
  id: string;
  parent: number;
  warp?: WarpDeformer;
  rotation?: RotationDeformer;
}

export interface MeshAnim {
  /** 自身 art-mesh keyform（无则 undefined → 用 static 或 zeros） */
  source?: {
    param: string | undefined;
    keys: number[];
    keyforms: Float64Array[]; // [keyIdx] pic*2 个 canvas 位置
    begin: number;
  };
  /** 无自身 keyform 时的基准位置（池解析的 display 顶点，canvas 空间；可选） */
  static?: Float64Array;
  /** deformer 链（最近父 → 根；逐个叠加） */
  chain: DeformerNode[];
}

/** 该 Mesh 影响它的全部参数（自身 keyform + 链上 warp/rotation），保持顺序） */
export function meshParameters(mesh: MeshAnim): string[] {
  const out: string[] = [];
  const push = (p: string | undefined) => { if (p && !out.includes(p)) out.push(p); };
  push(mesh.source?.param);
  for (const d of mesh.chain) {
    push(d.warp?.param);
    push(d.rotation?.params);
  }
  return out;
}

/**
 * 从 .moc3 构建每 Mesh 的动画结构（源 keyform + deformer 链）。
 * @param paramDefs 参数默认值表（parameter.default_values）
 */
export function analyzeMoc3Mesh(moc: Moc3Data, meshIndex: number, includeRotation = false): MeshAnim | null {
  const S = moc.sections;
  const num = (n: string) => (S[n] ?? []) as number[];
  const str = (n: string) => (S[n] ?? []) as string[];
  const artMesh = str("art_mesh.ids").length;
  if (meshIndex < 0 || meshIndex >= artMesh) return null;
  const pic = num("art_mesh.position_index_counts")[meshIndex] ?? 0;
  const amBand = num("art_mesh.keyform_binding_band_indices")[meshIndex] ?? -1;
  const amKB = num("art_mesh.keyform_begin_indices")[meshIndex] ?? 0;
  const amKC = num("art_mesh.keyform_counts")[meshIndex] ?? 0;
  const amkfBegin = num("art_mesh_keyform.keyform_position_begin_indices");
  const kf = num("keyform_position.xys");
  const mesh: MeshAnim = { chain: [] };

  // 自身 keyform 源位置；无则用静态池基准（position_index → keyform pool 的 display 顶点）
  const pidIdx = num("position_index.indices");
  const pib = num("art_mesh.position_index_begin_indices");
  if (amKC > 0) {
    const ax = bandAxis(moc, amBand);
    const keyforms: Float64Array[] = [];
    for (let r = 0; r < amKC; r++) {
      const bv = (amkfBegin[amKB + r] ?? 0) / 2;
      const arr = new Float64Array(pic * 2);
      for (let k = 0; k < pic * 2; k++) arr[k] = kf[bv * 2 + k] ?? 0;
      keyforms.push(arr);
    }
    mesh.source = { param: ax.param, keys: ax.keys, keyforms, begin: amKB };
  } else {
    const bs = pib[meshIndex] ?? 0;
    const st = new Float64Array(pic * 2);
    let okAny = false;
    for (let k = 0; k < pic; k++) {
      const pi = pidIdx[bs + k];
      if (pi === undefined || pi < 0 || pi * 2 + 1 >= kf.length) continue;
      st[k * 2] = kf[pi * 2] ?? 0;
      st[k * 2 + 1] = kf[pi * 2 + 1] ?? 0;
      okAny = true;
    }
    if (okAny) mesh.static = st;
  }

  // deformer 链
  const dIds = str("deformer.ids");
  const dParent = num("deformer.parent_deformer_indices");
  const dType = num("deformer.types");
  const dSpec = num("deformer.specific_indices");
  const amParentDef = num("art_mesh.parent_deformer_indices");

  const warpBand = num("warp_deformer.keyform_binding_band_indices");
  const warpKB = num("warp_deformer.keyform_begin_indices");
  const warpKC = num("warp_deformer.keyform_counts");
  const warpRow = num("warp_deformer.rows");
  const warpCol = num("warp_deformer.cols");
  const wdkfBegin = num("warp_deformer_keyform.keyform_position_begin_indices");

  const rotBand = num("rotation_deformer.keyform_binding_band_indices");
  const rotKB = num("rotation_deformer.keyform_begin_indices");
  const rotKC = num("rotation_deformer.keyform_counts");
  const rotAngle = num("rotation_deformer_keyform.angles");
  const rotOx = num("rotation_deformer_keyform.origin_xs");
  const rotOy = num("rotation_deformer_keyform.origin_ys");

  const buildNode = (di: number): DeformerNode | null => {
    const id = dIds[di]?.trim() ?? "";
    if (!id) return null;
    const node: DeformerNode = { id, parent: dParent[di] ?? -1 };
    const type = dType[di] ?? 0;
    const spec = dSpec[di] ?? 0;
    if (type === 0 && spec >= 0 && spec < warpRow.length && (warpKC[spec] ?? 0) > 0) {
      const rows = warpRow[spec] ?? 0, cols = warpCol[spec] ?? 0;
      const n = (rows + 1) * (cols + 1);
      if (n > 0) {
        const ax = bandAxis(moc, warpBand[spec] ?? -1);
        const rest = new Float64Array(n * 2);
        const keyforms: Float64Array[] = [];
        for (let r = 0; r < (warpKC[spec] ?? 0); r++) {
          const bv = (wdkfBegin[(warpKB[spec] ?? 0) + r] ?? 0) / 2;
          const arr = new Float64Array(n * 2);
          for (let g = 0; g < n * 2; g++) arr[g] = kf[bv * 2 + g] ?? 0;
          keyforms.push(arr);
        }
        // rest = 轴最接近 参数默认 的 keyform（通常 key=0 居中）
        const def = paramDefault(moc, ax.param);
        const restIdx = (ax.keys.length ? ax.keys.map((kk, i) => [Math.abs(kk - def), i]).sort((a, b) => a[0]! - b[0]!)[0]![1] : 0);
        const restArr = keyforms[Math.min(restIdx, keyforms.length - 1)];
        node.warp = { rows, cols, rest: restArr, keyforms, keys: ax.keys, param: ax.param };
      }
    } else if (includeRotation && type === 1 && spec >= 0 && spec < rotKC.length && (rotKC[spec] ?? 0) > 0) {
      const ax = bandAxis(moc, rotBand[spec] ?? -1);
      const kfBegin = rotKB[spec] ?? 0;
      const keyforms = [];
      for (let r = 0; r < (rotKC[spec] ?? 0); r++) {
        keyforms.push({
          origin: [rotOx[kfBegin + r] ?? 0, rotOy[kfBegin + r] ?? 0] as [number, number],
          angle: rotAngle[kfBegin + r] ?? 0,
        });
      }
      const def = paramDefault(moc, ax.param);
      const angleAtDefault = interpolateAngle(ax.keys, keyforms, def);
      node.rotation = { keys: ax.keys, params: ax.param, keyforms, angleAtDefault };
    }
    return node;
  };

  let cur = amParentDef[meshIndex] ?? -1;
  let guard = 0;
  while (cur >= 0 && cur < dIds.length && guard++ < 128) {
    const node = buildNode(cur);
    if (node) mesh.chain.push(node);
    cur = dParent[cur] ?? -1;
  }
  return mesh;
}

export function paramDefault(moc: Moc3Data, param: string | undefined): number {
  if (!param) return 0;
  const str = (n: string) => (moc.sections[n] ?? []) as string[];
  const num = (n: string) => (moc.sections[n] ?? []) as number[];
  const ids = str("parameter.ids");
  const defs = num("parameter.default_values");
  const i = ids.indexOf(param);
  return i >= 0 ? (defs[i] ?? 0) : 0;
}

/**
 * 计算 Mesh 在给定参数状态下的最终位置（canvas 空间，pic*2）。
 * params: (paramId) => value；未覆盖参数用默认值。
 * 链顺序：最近父 → 根（buildNode 逆序），逐级 warp/rotation 叠加。
 */
export function computeDeformedMesh(
  moc: Moc3Data,
  mesh: MeshAnim,
  n: number,
  params: (id: string) => number | undefined,
): Float64Array {
  const out = new Float64Array(n * 2);
  // 源位置：自身 keyform 按驱动参数插值；无则 static 基准；都无则零
  if (mesh.source && mesh.source.keyforms.length > 0) {
    const v = params(mesh.source.param ?? "") ?? paramDefault(moc, mesh.source.param);
    out.set(interpSeries(mesh.source.keys, mesh.source.keyforms, v));
  } else if (mesh.static) {
    out.set(mesh.static.subarray(0, Math.min(mesh.static.length, n * 2)));
  }
  for (const d of mesh.chain) {
    if (d.warp) applyWarp(moc, d.warp, out, params);
    else if (d.rotation) applyRotation(moc, d.rotation, out, params);
  }
  return out;
}

function applyWarp(moc: Moc3Data, w: WarpDeformer, pos: Float64Array, params: (id: string) => number | undefined): void {
  if (!w.param) return;
  const v = params(w.param) ?? paramDefault(moc, w.param);
  const cur = interpSeries(w.keys, w.keyforms, v);
  const rows = w.rows, cols = w.cols;
  const x0 = w.rest[0], x1 = w.rest[cols * 2];
  const y0 = w.rest[1], y1 = w.rest[w.rest.length - 1];
  const spanX = x1 - x0, spanY = y1 - y0;
  for (let k = 0; k < pos.length; k += 2) {
    const px = pos[k], py = pos[k + 1];
    let u = spanX !== 0 ? (px - x0) / spanX : 0;
    let vv = spanY !== 0 ? (py - y0) / spanY : 0;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    if (vv < 0) vv = 0; else if (vv > 1) vv = 1;
    const restV = bilinear(w.rest, rows, cols, u, vv);
    const curV = bilinear(cur, rows, cols, u, vv);
    pos[k] = px + (curV[0] - restV[0]);
    pos[k + 1] = py + (curV[1] - restV[1]);
  }
}

/** 角度沿轴插值 */
function interpolateAngle(
  keys: readonly number[],
  keyforms: readonly { angle: number }[],
  v: number,
): number {
  if (keyforms.length === 0) return 0;
  if (keyforms.length === 1) return keyforms[0]!.angle;
  const raw = keys.length === keyforms.length ? keys : Array.from({ length: keyforms.length }, (_, i) => i);
  const [lo, hi, t] = axisRange(raw, v);
  const a = keyforms[lo]!;
  const b2 = keyforms[hi]!;
  return a.angle + (b2.angle - a.angle) * t;
}

function applyRotation(moc: Moc3Data, r: RotationDeformer, pos: Float64Array, params: (id: string) => number | undefined): void {
  if (!r.params) return;
  const v = params(r.params) ?? paramDefault(moc, r.params);
  const eff = interpolateAngle(r.keys, r.keyforms, v) - r.angleAtDefault;
  if (eff === 0) return;
  const [lo, hi, t] = axisRange(r.keys, v);
  const a = r.keyforms[lo]!;
  const b = r.keyforms[hi]!;
  const ox = a.origin[0] + (b.origin[0] - a.origin[0]) * t;
  const oy = a.origin[1] + (b.origin[1] - a.origin[1]) * t;
  const rad = (eff * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  for (let k = 0; k < pos.length; k += 2) {
    const dx = pos[k] - ox, dy = pos[k + 1] - oy;
    pos[k] = ox + c * dx - s * dy;
    pos[k + 1] = oy + s * dx + c * dy;
  }
}

/** 网格双线性采样（u,v ∈ [0,1]，钳制到边沿）。控制点索引 = r*(cols+1)+c */
export function bilinear(grid: ArrayLike<number>, rows: number, cols: number, u: number, v: number): [number, number] {
  let cx = Math.floor(u * cols);
  let cy = Math.floor(v * rows);
  if (cx >= cols) cx = cols - 1;
  if (cy >= rows) cy = rows - 1;
  if (cx < 0) cx = 0;
  if (cy < 0) cy = 0;
  const tx = u * cols - cx;
  const ty = v * rows - cy;
  const stride = cols + 1;
  const i00 = (cy * stride + cx) * 2;
  const i10 = i00 + 2;
  const i01 = i00 + stride * 2;
  const i11 = i01 + 2;
  const ax = grid[i00]!, ayy = grid[i00 + 1]!;
  const bx = grid[i10]!, byy = grid[i10 + 1]!;
  const cxv = grid[i01]!, cyv = grid[i01 + 1]!;
  const dx = grid[i11]!, dy = grid[i11 + 1]!;
  const topX = ax + (bx - ax) * tx, topY = ayy + (byy - ayy) * tx;
  const botX = cxv + (dx - cxv) * tx, botY = cyv + (dy - cyv) * tx;
  return [topX + (botX - topX) * ty, topY + (botY - topY) * ty];
}

/**
 * 烘焙：对每个 Mesh 的每个影响参数，生成 L2dmWarp（keyforms 轴值单调，偏移在传入的像素空间）。
 * @param toPxOffset 偏移变换：canvas Δ → 像素 Δ（缺省恒等 → 输出 canvas 空间，测试用）
 * @param paramValue 取参数当前值（缺省用 paramDefault）
 */
export function bakeMoc3Warps(
  moc: Moc3Data,
  meshes: readonly (MeshAnim | null)[],
  toPxOffset?: (dx: number, dy: number) => [number, number],
  paramValue?: (id: string) => number,
): L2dmWarp[][] {
  const get = paramValue ?? ((id: string) => paramDefault(moc, id));
  const toPx = toPxOffset ?? ((dx: number, dy: number) => [dx, dy] as [number, number]);
  const out: L2dmWarp[][] = [];
  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi];
    if (!mesh) { out.push([]); continue; }
    if (!mesh.source && !mesh.static) { out.push([]); continue; }
    const n = (moc.sections["art_mesh.position_index_counts"] as number[])[mi] ?? 0;
    const n2 = n * 2;
    // 基准（全部默认）
    const base = computeDeformedMesh(moc, mesh, n, get);
    const params = meshParameters(mesh);
    const warps: L2dmWarp[] = [];
    for (const p of params) {
      const values = collectAxisValues(moc, mesh, p);
      const vals = Array.from(new Set(values.map(vv => +vv.toFixed(4)))).sort((a, b) => a - b);
      if (vals.length < 2) continue;
      const keyforms: L2dmKeyform[] = [];
      for (const vv of vals) {
        const deformed = computeDeformedMesh(moc, mesh, n, (id) => (id === p ? vv : get(id)));
        const offsets: number[] = [];
        for (let k = 0; k < n2; k += 2) {
          const [ox, oy] = toPx(deformed[k]! - base[k]!, deformed[k + 1]! - base[k + 1]!);
          offsets.push(ox, oy);
        }
        keyforms.push({ value: vv, offsets });
      }
      if (keyforms.length >= 2) warps.push({ parameter: p, keyforms });
    }
    out.push(warps);
  }
  return out;
}

/** 收集影响 Mesh 的参数 p 的轴值（自身 keyform + 链上出现同一参数的全部 key） */
function collectAxisValues(moc: Moc3Data, mesh: MeshAnim, p: string): number[] {
  const out: number[] = [];
  if (mesh.source?.param === p) out.push(...mesh.source.keys);
  for (const d of mesh.chain) {
    if (d.warp?.param === p) out.push(...d.warp.keys);
    if (d.rotation?.params === p) out.push(...d.rotation.keys);
  }
  if (out.length === 0) return [paramDefault(moc, p) - 1, paramDefault(moc, p) + 1];
  const def = paramDefault(moc, p);
  if (!out.includes(def)) out.push(def);
  return out;
}


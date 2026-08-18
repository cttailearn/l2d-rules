// Warp 网格形变 deform.ts —— DEVELOPMENT-SPEC §5.4（核心算法）
// 原理：变形后顶点 = 静止顶点 + Σ_warp( 参数插值的 keyform 偏移累加 )
// 确定性、无分配（写入调用方 out）、钳制不外推、插值在参数自身范围（非归一化）。
// 参照 Iki warp.ts 思路自主实现（accumulateKeyforms / accumulate2D / applyWarps）。

import type { L2dmKeyform, L2dmWarp, L2dmWarp2D } from "../format/types.ts";
import type { ParameterStore } from "./parameter-store.ts";

/**
 * 累加一组 keyform 的插值偏移到 out（out += ...）。
 * - value 钳制到 [first.value, last.value]，不外推
 * - 线性找包围对（keyforms 通常很少，线性扫描足够），线性插值
 * - out.length 必须 ≥ keyforms[].offsets.length
 */
export function accumulateKeyforms(
  keyforms: { value: number; offsets: ArrayLike<number> }[],
  value: number,
  out: Float32Array,
): void {
  const ks = keyforms ?? [];
  if (ks.length === 0) return    // 空 → 无贡献（validator 已保证 ≥2，防御性）
  const first = ks[0];
  const last = ks[ks.length - 1];

  if (value <= first.value) {
    const o = first.offsets;
    for (let i = 0; i < o.length; i++) out[i] += o[i];
    return;
  }
  if (value >= last.value) {
    const o = last.offsets;
    for (let i = 0; i < o.length; i++) out[i] += o[i];
    return;
  }
  let lo = first;
  let hi = ks[1];
  for (let k = 1; k < ks.length - 1; k++) {
    if (ks[k].value <= value) { lo = ks[k]; hi = ks[k + 1]; }
  }
  const t = (value - lo.value) / (hi.value - lo.value);
  const oLo = lo.offsets;
  const oHi = hi.offsets;
  for (let i = 0; i < oLo.length; i++) {
    out[i] += oLo[i] + (oHi[i] - oLo[i]) * t;
  }
}

/**
 * 2D 参数网格：按 vx/vy 在 valuesX×valuesY 上双线性插值 keyform 偏移，累加入 out（row-major k = j*W+i）。
 * - 每轴钳制到范围端、内部线性找包围对（validator 保证 valuesX/Y 单调递增）
 */
export function accumulateKeyforms2D(
  valuesX: number[],
  valuesY: number[],
  keyforms2d: { offsets: ArrayLike<number> }[],
  vx: number,
  vy: number,
  out: Float32Array,
): void {
  const W = valuesX.length;
  // X 轴包围
  let ix: number; let tx: number;
  if (vx <= valuesX[0]) { ix = 0; tx = 0; }
  else if (vx >= valuesX[W - 1]) { ix = W - 2; tx = 1; }
  else {
    ix = 0;
    for (let k = 0; k < W - 1; k++) { if (valuesX[k + 1] <= vx) ix = k + 1; }
    tx = (vx - valuesX[ix]) / (valuesX[ix + 1] - valuesX[ix]);
  }
  // Y 轴包围
  const H = valuesY.length;
  let iy: number; let ty: number;
  if (vy <= valuesY[0]) { iy = 0; ty = 0; }
  else if (vy >= valuesY[H - 1]) { iy = H - 2; ty = 1; }
  else {
    iy = 0;
    for (let k = 0; k < H - 1; k++) { if (valuesY[k + 1] <= vy) iy = k + 1; }
    ty = (vy - valuesY[iy]) / (valuesY[iy + 1] - valuesY[iy]);
  }
  // 四角（row-major）
  const c00 = keyforms2d[iy * W + ix];
  const c10 = keyforms2d[iy * W + ix + 1];
  const c01 = keyforms2d[(iy + 1) * W + ix];
  const c11 = keyforms2d[(iy + 1) * W + ix + 1];
  const o00 = c00.offsets, o10 = c10.offsets, o01 = c01.offsets, o11 = c11.offsets;
  for (let n = 0; n < o00.length; n++) {
    const top = o00[n] + (o10[n] - o00[n]) * tx;
    const bot = o01[n] + (o11[n] - o01[n]) * tx;
    out[n] += top + (bot - top) * ty;
  }
}

/**
 * 应用 1D warps 到 rest：out = rest（先拷贝），随后逐 warp 累加参数插值偏移。
 * 无 warps → 恒等拷贝。
 */
export function applyWarps(
  rest: Float32Array,
  warps: L2dmWarp[] | undefined,
  params: ParameterStore,
  out: Float32Array,
): void {
  out.set(rest);
  if (!warps || warps.length === 0) return;
  for (const w of warps) {
    accumulateKeyforms(w.keyforms, params.get(w.parameter), out);
  }
}

/**
 * 应用 2D warp（单个）：out = rest 拷贝 + 双线性偏移。
 */
export function applyWarp2D(
  rest: Float32Array,
  warp2d: L2dmWarp2D,
  params: ParameterStore,
  out: Float32Array,
): void {
  out.set(rest);
  const [px, py] = warp2d.parameters;
  accumulateKeyforms2D(warp2d.valuesX, warp2d.valuesY, warp2d.keyforms, params.get(px), params.get(py), out);
}

/** 便捷：把 keyform 偏移（flat）应用为一组顶点坐标数组（无分配需求时使用） */
export function deformVertexOffset(
  rest: readonly number[],
  offset: ArrayLike<number>,
): [number, number] {
  return [rest[0] + offset[0], rest[1] + offset[1]];
}

// 重导类型以方便调用方
export type { L2dmKeyform, L2dmWarp, L2dmWarp2D };

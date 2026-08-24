// warps.ts —— warp 形变合成（P4a 核心）
// 从模板预设"发明"形变（而非从 .moc3 解码）：给定 参数值 → 每顶点偏移。
// 产物直接写入 .l2dm.mesh.warps / .warp2d；engine accumulateKeyforms 运行时消费，格式规则同 validator。
import type { L2dmWarp, L2dmWarp2D } from "@l2dp/engine";
import type { Grid } from "./meshes.ts";
import { gridColRow, gridXY } from "./meshes.ts";

export const DEG = Math.PI / 180;

/** 全零偏移（顶点数 n → 偏移长度 2n） */
export function zeroOffsets(n: number): number[] {
  return new Array(n * 2).fill(0);
}

/** 逐元素相加（两个长度相同的偏移数组） */
export function addOffsets(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

/** 1D warp：values 须严格递增（validator 要求）；offsetFn(v) 返回长度 2n 的偏移。 */
export function warp1D(param: string, values: number[], offsetFn: (v: number) => number[]): L2dmWarp {
  return { parameter: param, keyforms: values.map((v) => ({ value: v, offsets: offsetFn(v) })) };
}

/** 2D warp：valuesX/Y 须严格递增；keyforms row-major k = j*lenX + i。 */
export function warp2D(
  params: [string, string],
  valuesX: number[],
  valuesY: number[],
  offsetFn: (vx: number, vy: number) => number[],
): L2dmWarp2D {
  const keyforms: { offsets: number[] }[] = [];
  for (let j = 0; j < valuesY.length; j++) {
    for (let i = 0; i < valuesX.length; i++) {
      keyforms.push({ offsets: offsetFn(valuesX[i]!, valuesY[j]!) });
    }
  }
  return { parameters: params, valuesX, valuesY, keyforms };
}

// ---------------- 形变预设（每语义类型一个；参数值域见 params.ts RIG_PARAM_DEFS） ----------------

/** 眨眼：上睑下行闭合到眼线（row=1），下睑轻微上移。closure ∈ [0,1]。 */
export function eyeLidOffsets(g: Grid, closure: number): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  const lidRow = Math.min(1, g.rows - 1);
  const yLid = g.y0 + (lidRow / (g.rows - 1)) * g.height;
  for (let vi = 0; vi < n; vi++) {
    const [, r] = gridColRow(g, vi);
    const y = gridXY(g, vi)[1]!;
    const dy = r <= lidRow
      ? (yLid - y) * closure * 0.92
      : (yLid - y) * closure * 0.4;
    out[vi * 2 + 1] = dy;
  }
  return out;
}

/** 眉升降：整体垂直位移，中央略高（弧）。amount ∈ [-1,1]。 */
export function browOffsets(g: Grid, amount: number, maxShiftRatio = 0.35): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  const shift = g.height * maxShiftRatio * Math.abs(amount);
  const sign = amount >= 0 ? 1 : -1;
  const cx = g.x0 + g.width / 2;
  const half = g.width / 2;
  for (let vi = 0; vi < n; vi++) {
    const x = gridXY(g, vi)[0]!;
    const arc = 1 - 0.25 * (Math.abs(x - cx) / (half || 1));
    out[vi * 2 + 1] = shift * sign * arc;
  }
  return out;
}

/** 嘴开：上唇（lipline 以上）上移、下唇下移，嘴角阻尼。open ∈ [0,1]。 */
export function mouthOpenOffsets(g: Grid, open: number): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  const lipline = Math.ceil((g.rows - 1) / 2); // rows=4 → 2（上唇 0..1，下唇 2..3）
  const dy = g.height * 0.32 * open;
  for (let vi = 0; vi < n; vi++) {
    const [c, r] = gridColRow(g, vi);
    const corner = c === 0 || c === g.cols - 1 ? 0.45 : 1;
    out[vi * 2 + 1] = (r < lipline ? -dy : dy) * corner;
  }
  return out;
}

/** 嘴笑：嘴角上提，中心不动，轻微外张。amount ∈ [0,1]。 */
export function mouthSmileOffsets(g: Grid, amount: number): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  const cx = g.x0 + g.width / 2;
  const half = g.width / 2;
  const lift = g.height * 0.28 * amount;
  for (let vi = 0; vi < n; vi++) {
    const x = gridXY(g, vi)[0]!;
    const t = Math.abs(x - cx) / (half || 1);
    out[vi * 2 + 1] = -lift * Math.pow(t, 1.4);
    out[vi * 2] = (x - cx) * 0.12 * amount;
  }
  return out;
}

/** 发丝跟随头转：head 转向时发丝横向滞后偏移（dx 随深度增大）。turnDeg ∈ [-30,30]。 */
export function hairHeadFollowOffsets(g: Grid, turnDeg: number, factorPx = 12): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  const rootY = g.y0;
  const t = turnDeg / 30; // -1..1
  for (let vi = 0; vi < n; vi++) {
    const y = gridXY(g, vi)[1]!;
    const depth = (y - rootY) / (g.height || 1);
    out[vi * 2] = depth * factorPx * t;
  }
  return out;
}

/** 发丝摆动：自顶部（root）向下的横向偏移。amount ∈ [-1,1]。 */
export function hairSwayOffsets(g: Grid, amount: number, swayPx = 16): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  const rootY = g.y0;
  for (let vi = 0; vi < n; vi++) {
    const y = gridXY(g, vi)[1]!;
    const t = (y - rootY) / (g.height || 1);
    out[vi * 2] = t * swayPx * amount;
  }
  return out;
}

// ---------------- 头簇联动（warp2d：头转向 / 头点头 双参数） ----------------

/** 绕枢轴刚体旋转（头转向）：angle deg；偏移 = 旋转后 - rest。 */
export function headTurnOffsets(g: Grid, hinge: { x: number; y: number }, angleDeg: number): number[] {
  const n = g.vertices.length / 2;
  const a = angleDeg * DEG;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const out: number[] = [];
  for (let vi = 0; vi < n; vi++) {
    const [x, y] = gridXY(g, vi);
    out.push(
      (x - hinge.x) * (ca - 1) - (y - hinge.y) * sa,
      (x - hinge.x) * sa + (y - hinge.y) * (ca - 1),
    );
  }
  return out;
}

/** 点头（屏幕平面的俯仰近似）：绕水平枢轴纵向压缩 + 轻微宽度内收。angle deg。 */
export function headNodOffsets(g: Grid, hinge: { x: number; y: number }, angleDeg: number): number[] {
  const n = g.vertices.length / 2;
  const a = angleDeg * DEG;
  const ca = Math.cos(a);
  const out: number[] = [];
  for (let vi = 0; vi < n; vi++) {
    const [x, y] = gridXY(g, vi);
    out.push(
      (x - hinge.x) * (1 - ca) * 0.35,
      -(y - hinge.y) * (1 - ca),
    );
  }
  return out;
}

/** 头簇头转向/点头 warp2d（values ±30°，keyform 3×3：中间为 identity）。 */
export function headTurnWarp2D(
  grid: Grid,
  hinge: { x: number; y: number },
): L2dmWarp2D {
  const axes = [-30, 0, 30] as const;
  return warp2D(
    ["头转向", "头点头"],
    [...axes],
    [...axes],
    (vx, vy) => addOffsets(headTurnOffsets(grid, hinge, vx), headNodOffsets(grid, hinge, vy)),
  );
}

// ---------------- 新增部位形变（B-2/B-4） ----------------

/** 下躯随重心微摆：以躯体上部为根，向侧向弯曲（dx 随深度增大）。amount ∈ [-1,1]。 */
export function bodyLowerSwayOffsets(g: Grid, amount: number, swayPx = 10): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  const rootY = g.y0;
  for (let vi = 0; vi < n; vi++) {
    const y = gridXY(g, vi)[1]!;
    const t = (y - rootY) / (g.height || 1);
    out[vi * 2] = t * swayPx * amount;
  }
  return out;
}

/** 臂/腿摆动：以顶部（肩/髋）为根，向侧向摆（含轻微弧）。amount ∈ [-1,1]。 */
export function limbSwayOffsets(g: Grid, amount: number, swayPx = 14): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  const rootY = g.y0;
  for (let vi = 0; vi < n; vi++) {
    const y = gridXY(g, vi)[1]!;
    const t = (y - rootY) / (g.height || 1);
    out[vi * 2] = t * swayPx * amount;
    out[vi * 2 + 1] = t * t * 2 * amount;
  }
  return out;
}

/** 尾巴弯曲：自根部（顶部）向下弯曲的横向偏移。amount ∈ [0,1]。 */
export function tailSwayOffsets(g: Grid, amount: number, swayPx = 24): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  const rootY = g.y0;
  for (let vi = 0; vi < n; vi++) {
    const y = gridXY(g, vi)[1]!;
    const t = (y - rootY) / (g.height || 1);
    const sway = Math.sin(t * Math.PI);
    out[vi * 2] = sway * swayPx * t * amount;
  }
  return out;
}

/** 翅膀扇动：绕翼根旋转近似（纵向上扬）。amount ∈ [-1,1]。 */
export function wingFlapOffsets(g: Grid, amount: number, flapPx = 28): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  const rootY = g.y0;
  for (let vi = 0; vi < n; vi++) {
    const y = gridXY(g, vi)[1]!;
    const depth = (y - rootY) / (g.height || 1);
    out[vi * 2] = depth * flapPx * amount * 0.4;
    out[vi * 2 + 1] = -depth * flapPx * amount * 0.9;
  }
  return out;
}

/** 兽耳摆动：耳尖（上部）向侧向偏 + 整体轻微竖起。amount ∈ [-1,1]。 */
export function earTwitchOffsets(g: Grid, amount: number, twitchPx = 12): number[] {
  const n = g.vertices.length / 2;
  const out = zeroOffsets(n);
  for (let vi = 0; vi < n; vi++) {
    const [, r] = gridColRow(g, vi);
    const top = 1 - r / (g.rows - 1);
    out[vi * 2] = top * twitchPx * amount;
    out[vi * 2 + 1] = -top * twitchPx * 0.5 * Math.abs(amount);
  }
  return out;
}
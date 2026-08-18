// 引擎动作资产与曲线采样 —— DEVELOPMENT-SPEC §5.8（ Player 依赖）
// motion3 Segments 采样：对齐 dsl buildSegments 布局（0=Linear 多点段 / 1=Bezier 段）。
// 确定性：纯函数，无随机；同 (segments, t) → 同值。

export interface EngineCurve {
  /** 语义参数名（semantic 编译产物约定；与 .l2dm.parameters 直接对应） */
  id: string;
  /** motion3 Segments：扁平 [type, 点..., ...]；时间单位秒 */
  segments: number[];
}

export interface EngineMotion {
  /** 时长（毫秒） */
  durationMs: number;
  loop: boolean;
  curves: EngineCurve[];
}

// ---------------- 曲线采样 ----------------

interface Seg {
  /** 段起点（前一关键点） */
  t0: number;
  v0: number;
  /** 段终点 */
  t1: number;
  v1: number;
  /** Bezier 控制点 [c1t,c1v,c2t,c2v]；null = 线性段 */
  bz: [number, number, number, number] | null;
}

/** 解析 motion3 Segments 为段表（官方布局：初始点 + 交织段标识符；每段自定界）。 */
export function parseSegments(segments: number[]): Seg[] {
  const s: Seg[] = [];
  if (segments.length < 2) return s;
  // 初始点（元素 0/1），段标识符从元素 2 开始
  let prev: { t: number; v: number } = { t: segments[0]!, v: segments[1]! };
  let i = 2;
  while (i < segments.length) {
    const type = segments[i];
    i += 1;
    if (type === 0 || type === 2 || type === 3) {
      // Linear/Stepped/Inverse：标识符后 1 点
      if (i + 1 >= segments.length) break;
      const k = { t: segments[i]!, v: segments[i + 1]! };
      i += 2;
      s.push({ t0: prev.t, v0: prev.v, t1: k.t, v1: k.v, bz: null });
      prev = k;
    } else if (type === 1) {
      // Bezier：标识符后 3 点 [c1t,c1v, c2t,c2v, pt,pv]
      if (i + 5 >= segments.length) break;
      const bz: [number, number, number, number] = [
        segments[i]!, segments[i + 1]!, segments[i + 2]!, segments[i + 3]!,
      ];
      const k = { t: segments[i + 4]!, v: segments[i + 5]! };
      i += 6;
      s.push({ t0: prev.t, v0: prev.v, t1: k.t, v1: k.v, bz });
      prev = k;
    } else {
      break; // 无法识别的段（防御）
    }
  }
  return s;
}

/** 在时间 tS（秒）采样 motion3 曲线值；端点外钳制（不外推）。 */
export function sampleSegments(segments: number[], tS: number): number {
  const s = parseSegments(segments);
  if (s.length === 0) return 0;
  if (tS <= s[0]!.t0) return s[0]!.v0;
  const last = s[s.length - 1]!;
  if (tS >= last.t1) return last.v1;
  for (const seg of s) {
    if (tS >= seg.t0 && tS <= seg.t1) {
      const span = seg.t1 - seg.t0;
      if (seg.bz === null || span === 0) {
        const f = span === 0 ? 0 : (tS - seg.t0) / span;
        return seg.v0 + (seg.v1 - seg.v0) * f;
      }
      const u = solveBezierT(seg.t0, seg.bz[0], seg.bz[2], seg.t1, tS);
      const [, c1v, , c2v] = seg.bz;
      const omu = 1 - u;
      return omu * omu * omu * seg.v0 + 3 * omu * omu * u * c1v +
        3 * omu * u * u * c2v + u * u * u * seg.v1;
    }
  }
  return last.v1;
}

/** 三次贝塞尔时间反解：x(u)=t 的 u（牛顿迭代 ≤8 次，钳制 [0,1]） */
function solveBezierT(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const span = p3 - p0;
  let u = span === 0 ? 0.5 : (t - p0) / span;
  u = Math.max(0, Math.min(1, u));
  for (let i = 0; i < 8; i++) {
    const omu = 1 - u;
    const x = omu * omu * omu * p0 + 3 * omu * omu * u * p1 + 3 * omu * u * u * p2 + u * u * u * p3;
    const dx = 3 * omu * omu * (p1 - p0) + 6 * omu * u * (p2 - p1) + 3 * u * u * (p3 - p2);
    if (Math.abs(x - t) < 1e-7 || Math.abs(dx) < 1e-9) break;
    u -= (x - t) / dx;
    u = Math.max(0, Math.min(1, u));
  }
  return u;
}

/** 把动作在 tMs 处的参数值写入 ParameterStore（值域 = 参数自身范围，set 钳制）。 */
export function applyMotion(motion: EngineMotion, tMs: number, params: { set(id: string, v: number): boolean }): void {
  const tS = tMs / 1000;
  for (const c of motion.curves) {
    params.set(c.id, sampleSegments(c.segments, tS));
  }
}

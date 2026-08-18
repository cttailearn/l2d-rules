// motion3 曲线解析采样（规格 6.2，对齐官方格式：segments 为 (时间,值) 点对 + 段类型交织）
// 布局：[x0(时间=0), y0(初始值), type, 点..., type, 点...]
// 段类型：0=线性(1点) 1=贝塞尔(3点) 2=步进(1点) 3=反向步进(1点)
export interface MotionCurve { target: "Parameter"; id: string; segments: number[]; }
export interface MotionDef { meta: { duration: number; fps: number; loop: boolean }; curves: MotionCurve[]; }

export interface Segment { flag: number; pts: [number, number]; bezier?: [number, number, number, number, number, number]; }

export function parseSegments(segments: number[]): { startTime: number; startValue: number; segs: Segment[] } {
  const startTime = segments[0] ?? 0;
  const startValue = segments[1] ?? 0;
  const segs: Segment[] = [];
  let i = 2;
  while (i < segments.length) {
    const flag = segments[i++];
    if (flag === 1) {
      // 贝塞尔：3 点 (x,y)
      if (i + 5 < segments.length + 1 && i + 5 <= segments.length - 1 + 1) {
        const x1 = segments[i], y1 = segments[i + 1], x2 = segments[i + 2], y2 = segments[i + 3], x3 = segments[i + 4], y3 = segments[i + 5];
        segs.push({ flag, pts: [x3, y3], bezier: [x1, y1, x2, y2, x3, y3] });
        i += 6;
        continue;
      }
    }
    // 线性/步进/反向步进：1 点
    const x = segments[i], y = segments[i + 1];
    segs.push({ flag, pts: [x, y] });
    i += 2;
  }
  return { startTime, startValue, segs };
}

// 在时间 t 处采样（t 为绝对时间，duration 为总时长；loop 处理在 sampleMotion）
export function sampleCurve(curve: MotionCurve, t: number): number {
  const { startTime, startValue, segs } = parseSegments(curve.segments);
  if (!segs.length) return startValue;
  // 找包含 t 的段
  let prevX = startTime, prevY = startValue;
  for (const s of segs) {
    const endX = s.pts[0];
    if (t <= endX || t <= startTime) {
      // 在段内插值
      const u = endX > prevX ? Math.min(1, Math.max(0, (t - prevX) / (endX - prevX))) : 1;
      if (s.flag === 1 && s.bezier) {
        const [x1, y1, x2, y2, x3, y3] = s.bezier;
        // 参数化 u 需在 x 方向均匀化（近似：按段内 u 直接三次插值 y）
        const uu = 1 - u;
        return uu * uu * uu * prevY + 3 * uu * uu * u * y1 + 3 * uu * u * u * y2 + u * u * u * y3;
      }
      if (s.flag === 2) return s.pts[1];
      if (s.flag === 3) return u < 0.5 ? prevY : s.pts[1];
      return prevY + (s.pts[1] - prevY) * u; // 线性
    }
    prevX = endX; prevY = s.pts[1];
  }
  return prevY; // 超出末段 → 末值
}

export function sampleMotion(motion: MotionDef, timeMs: number): Record<string, number> {
  const tSec = timeMs / 1000; // motion3 的 duration 单位为秒
  const t = motion.meta.loop ? tSec % motion.meta.duration : Math.min(tSec, motion.meta.duration);
  const out: Record<string, number> = {};
  for (const c of motion.curves) out[c.id] = sampleCurve(c, t);
  return out;
}

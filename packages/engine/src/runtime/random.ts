// SeededRandom —— 确定性随机（ARCHITECTURE §2 / C10 接口）
// 时钟/随机种子可注入：同 (seed, 调用序列) → 同序列；CI 无浏览器可测。
// mulberry32：32 位种子、均匀 [0,1)、无状态外泄、确定性强。

export interface SeededRandom {
  /** 下一个 [0,1) 均匀随机数 */
  next(): number;
}

export function mulberry32(seed: number): SeededRandom {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

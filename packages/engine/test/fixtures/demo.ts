// 共享 demo 夹具：模型（L2dmModel）+ 语义动作（EngineMotion）
// 由 player.test.ts 与 fixture 生成脚本共用；demo.l2dm 为该模型的磁盘序列化。
//
// 模型（canvas 30x30；网格 = 画布像素坐标）：
//   face：红，父 deformer headDeformer（头转向→x 平移 0..8）
//   tail：蓝，warp 尾巴摆→dx+6（上右移）
//   hair：绿，warp 前发摆→dy+4（向下摆）
//   physics：头转向 → 前发摆

import { L2DM_FORMAT_VERSION, type L2dmModel } from "../../src/index.ts";
import type { EngineMotion } from "../../src/index.ts";

export function makeDemoModel(): L2dmModel {
  const quad = (x0: number, y0: number, x1: number, y1: number): { vertices: number[]; uvs: number[]; indices: number[] } => ({
    vertices: [x0, y0, x1, y0, x1, y1, x0, y1],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
  });
  const z = (n: number): number[] => new Array(n).fill(0);
  return {
    formatVersion: L2DM_FORMAT_VERSION,
    id: "demo",
    canvas: { width: 30, height: 30 },
    parameters: [
      { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
      { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
      { id: "尾巴摆", min: 0, max: 1, def: 0, group: "Custom" },
      { id: "前发摆", min: 0, max: 1, def: 0, group: "Physics" },
    ],
    parts: [
      {
        id: "face", order: 1, parent: "headDeformer", color: [1, 0, 0, 1],
        mesh: {
          ...quad(12, 10, 18, 16),
          warps: [
            { parameter: "微笑", keyforms: [{ value: 0, offsets: z(8) }, { value: 1, offsets: [0, -5, 0, -5, 0, -5, 0, -5] }] },
          ],
        },
      },
      {
        id: "tail", order: 2, color: [0, 0, 1, 1],
        mesh: {
          ...quad(0, 22, 8, 30),
          warps: [
            { parameter: "尾巴摆", keyforms: [{ value: 0, offsets: z(8) }, { value: 1, offsets: [6, 0, 6, 0, 6, 0, 6, 0] }] },
          ],
        },
      },
      {
        id: "hair", order: 3, color: [0, 1, 0, 1],
        mesh: {
          ...quad(20, 2, 26, 8),
          warps: [
            { parameter: "前发摆", keyforms: [{ value: 0, offsets: z(8) }, { value: 1, offsets: [0, 4, 0, 4, 0, 4, 0, 4] }] },
          ],
        },
      },
    ],
    deformers: [
      // 对称区间：头转向为 -30..30，默认 0 落在归一化中点 → binding 输出 x = from + (to-from)*0.5
      // 取 [-8, 8] 使 rest（param=0）零位移，±30° 摆动 ±8px（evalBindings 全范围线性映射语义）
      { id: "headDeformer", bindings: [{ parameter: "头转向", channel: "x", from: -8, to: 8 }] },
    ],
    physics: {
      pendulums: [
        { id: "发丝", input: "头转向", outputParams: ["前发摆"], delay: 0.2, acceleration: 0.5 },
      ],
    },
  };
}

/** 语义 motion3（官方 Segments 布局：初始点 + 交织段标识符）：微笑/尾巴摆 0→1→0（1s 周期，loop）。 */
export const DEMO_MOTION: EngineMotion = {
  durationMs: 1000,
  loop: true,
  curves: [
    { id: "微笑", segments: [0, 0, 0, 0.5, 1, 0, 1, 0] },
    { id: "尾巴摆", segments: [0, 0, 0, 0.5, 1, 0, 1, 0] },
  ],
};

// skeleton.ts —— ConvertedBundle → 可渲染 `.l2dm` 骨架（Phase 1 占位几何）
// 说明：
//   - 官方几何（ArtMesh 顶点/warp keyform/deformer 树/draw order/参数范围）在 .moc3 二进制，
//     Phase 2（docs/MOC3-PHASE2-PLAN.md）解析后注入。此处产出：
//       · 完整参数面（id/范围/组，供 driver 环境层与校验器）
//       · cdi3 部件目录 → 确定性配色的占位网格（网格矩阵布局，可渲染、可 CI 校验）
//       · physics3 → 摆锤近似（每个 PhysicsSetting 一个摆锤：输入=首个 Input 参数）
//       · pose3 → 部件联动组
//   全部引用仅在已知 id 内闭合，保证 validateL2dmModel 通过。

import type { L2dmModel, L2dmParamGroup } from "@l2dp/engine";
import { L2DM_PARAM_GROUPS } from "@l2dp/engine";
import { partColor } from "./map.ts";
import type { ConvertedBundle } from "./types.ts";

export interface SkeletonOptions {
  /** 画布尺寸（缺省按部件数自动排布） */
  canvas?: { width: number; height: number };
  /** 每部件占位网格边长（像素，缺省 16） */
  cell?: number;
}

const CELL_DEFAULT = 16;
const PAD = 1;

const ALLOWED_GROUPS = L2DM_PARAM_GROUPS as readonly string[];
function toGroup(g: string): L2dmParamGroup {
  return (ALLOWED_GROUPS.includes(g) ? g : "Custom") as L2dmParamGroup;
}

export function toL2dmSkeleton(b: ConvertedBundle, opts: SkeletonOptions = {}): L2dmModel {
  const cell = opts.cell ?? CELL_DEFAULT;
  const n = b.parts.length;
  const cols = n > 0 ? Math.ceil(Math.sqrt(n)) : 1;
  const rows = n > 0 ? Math.ceil(n / cols) : 1;
  const canvas = opts.canvas ?? { width: cols * cell, height: rows * cell };

  const id = sanitizeId(b.source);
  const parameters = b.params.map((p) => ({
    id: p.id,
    min: p.min,
    max: p.max,
    def: p.def,
    group: toGroup(p.engineGroup),
  }));

  const parts = b.parts.map((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cell + PAD;
    const y = row * cell + PAD;
    const s = cell - 2 * PAD;
    return {
      id: p.id,
      order: i,
      color: partColor(p.id),
      mesh: {
        vertices: [x, y, x + s, y, x + s, y + s, x, y + s],
        uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        indices: [0, 1, 2, 0, 2, 3],
      },
    };
  });

  // physics3 → 摆锤近似；仅保留输入/输出参数都落在参数面内的设置
  const paramIds = new Set(parameters.map((p) => p.id));
  const pendulums: NonNullable<L2dmModel["physics"]>["pendulums"] = [];
  if (b.physics) {
    for (const s of b.physics.settings) {
      const input = s.inputs[0]?.param;
      const outputs = s.outputs.map((o) => o.param);
      if (input === undefined || !paramIds.has(input)) continue;
      if (outputs.length === 0 || !outputs.every((o) => paramIds.has(o))) continue;
      const delays = s.vertices.map((v) => v.delay).filter((v) => v > 0);
      const accels = s.vertices.map((v) => v.acceleration).filter((v) => v > 0);
      pendulums.push({
        id: s.id || "pendulum-" + pendulums.length,
        input,
        outputParams: outputs,
        delay: delays.length > 0 ? delays.reduce((a, v) => a + v, 0) / delays.length : 1,
        acceleration: accels.length > 0 ? Math.max(...accels) : 1,
      });
    }
  }

  const poseGroups = (b.pose?.groups ?? [])
    .filter((g) => g.ids.every((pid) => b.parts.some((p) => p.id === pid)))
    .map((g) => ({ ids: g.ids }));

  return {
    formatVersion: 1,
    id,
    canvas,
    parameters,
    parts: parts as unknown as L2dmModel["parts"],
    physics: pendulums.length > 0 ? { pendulums } : undefined,
    pose: poseGroups.length > 0 ? { groups: poseGroups } : undefined,
  };
}

/** 角色名 → .l2dm id（仅保留 [A-Za-z0-9_-]，非法字符连串折叠为 '-'，空则兜底 "model"） */
export function sanitizeId(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return s.length > 0 ? s : "model";
}

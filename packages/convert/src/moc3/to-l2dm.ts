// moc3/to-l2dm.ts —— moc3 解析结果 → 真实几何 .l2dm（Phase 2 核心）
// 语义（与 Cubism 3 运行时约定一致）：
//   - 网格顶点 = keyform_position.xys[ positionIndices[*] ]（positionIndices 为 u16 池索引，
//     小索引=基础姿态；大索引=形变关键帧）
//   - 三角形 非索引展平：indices=[0,1,2,3,4,5,…]（vertexCount 为 3 的倍数）
//   - UV = uv.xys[uvBegin*2 + 2k ..]（每顶点 2 个 f32，0..1）
//   - 纹理 = art_mesh.texture_indices[mesh] → model3.Textures[?]
//   - 绘制顺序 = draw_order_group_object 中 ARTMESH(0) 项相对先后
//   - 坐标系：moc3 顶点为「模型单位坐标系」→ 贴合包围盒 + 等比缩放(默认按画布高) + y 翻转
//     到 .l2dm（左上原点、y 向下），保证几何比例与原格式一致。
import type { L2dmModel } from "@l2dp/engine";
import { mapEngineGroup } from "../map.ts";
import { buildDeformers } from "./deformers.ts";
import type { Moc3Data } from "./moc3.ts";

export interface Moc3ToL2dmOptions {
  id: string;
  /** model3.FileReferences.Textures（art_mesh.texture 索引 → 文件名） */
  textures?: string[];
  /** model3/Groups（EyeBlink/LipSync → 参数组） */
  groups?: { target: string; name: string; ids: string[] }[];
  /** 画布覆盖（缺省：按包围盒高 = moc canvas.height 等比缩放） */
  canvas?: { width: number; height: number } | null;
  /** 显式缩放因子（缺省由包围盒+画布高推导） */
  scale?: number;
  /** 目标高度（像素）：降采样渲染用（浏览器 demo 等），等比缩放、UV 不变。优先于 canvas.height */
  targetHeight?: number;
  /** 是否输出 deformer 树 + 部件父级接线（M4；缺省 true） */
  deformers?: boolean;
}

function num(s: Moc3Data["sections"], name: string): number[] {
  return (s[name] ?? []) as number[];
}
function str(s: Moc3Data["sections"], name: string): string[] {
  return (s[name] ?? []) as string[];
}

export function moc3ToL2dm(moc: Moc3Data, opts: Moc3ToL2dmOptions): L2dmModel {
  const S = moc.sections;

  // ---- 参数 ----
  const pIds = str(S, "parameter.ids");
  const pMax = num(S, "parameter.max_values");
  const pMin = num(S, "parameter.min_values");
  const pDef = num(S, "parameter.default_values");
  const parameters = pIds.map((id, i) => {
    const min = Math.min(pMin[i] ?? 0, pMax[i] ?? 0);
    const max = Math.max(pMin[i] ?? 0, pMax[i] ?? 0);
    const def = pDef[i] ?? min;
    return {
      id,
      min,
      max,
      def: def >= min && def <= max ? def : min,
      group: mapEngineGroup(id, undefined, opts.groups ?? []),
    };
  });

  // ---- 网格素材 ----
  const amIds = str(S, "art_mesh.ids");
  const amPosBegin = num(S, "art_mesh.position_index_begin_indices");
  const amPosCount = num(S, "art_mesh.position_index_counts");
  const amUvBegin = num(S, "art_mesh.uv_begin_indices");
  const amTex = num(S, "art_mesh.texture_indices");
  const positionPool = num(S, "keyform_position.xys");
  const uvPool = num(S, "uv.xys");
  const posIdx = num(S, "position_index.indices");
  const meshVisible = num(S, "art_mesh.visibles");
  const meshEnable = num(S, "art_mesh.enables");

  // ---- 第一遍：基础姿态包围盒（仅统计可见 mesh，排除 下絵/背景 引导层撑宽）----
  const visibleMesh = amIds.map((_, mi) => (meshVisible[mi] ?? 1) !== 0 && (meshEnable[mi] ?? 1) !== 0);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let mi = 0; mi < amIds.length; mi++) {
    if (!visibleMesh[mi]) continue;
    const n = amPosCount[mi] ?? 0;
    const bs = amPosBegin[mi] ?? 0;
    for (let k = 0; k < n; k++) {
      const pi = posIdx[bs + k]!;
      const x = positionPool[pi * 2];
      const y = positionPool[pi * 2 + 1];
      if (Number.isFinite(x)) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
      if (Number.isFinite(y)) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (!Number.isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  // ---- 缩放与画布（targetHeight 优先：降采样渲染；否则按 moc canvas.height）----
  const refHeight = opts.targetHeight && opts.targetHeight > 0 ? opts.targetHeight : moc.canvas.height;
  const scale = opts.scale ?? (refHeight > 0 ? refHeight / spanY : 100);
  const canvas = opts.canvas ?? {
    width: Math.max(1, Math.round(spanX * scale)),
    height: Math.max(1, Math.round(spanY * scale)),
  };
  const toPx = (x: number, y: number): [number, number] => [
    (x - minX) * scale,
    (maxY - y) * scale, // y 翻转（Cubism y 向上 → 引擎 y 向下）
  ];

  // ---- 绘制顺序 ----
  const dogTypes = num(S, "draw_order_group_object.types");
  const dogIdx = num(S, "draw_order_group_object.indices");
  const drawOrderByMesh = new Map<number, number>();
  {
    let order = 0;
    for (let k = 0; k < dogTypes.length; k++) {
      if (dogTypes[k] === 0) {
        const m = dogIdx[k]!;
        if (!drawOrderByMesh.has(m)) drawOrderByMesh.set(m, order++);
      }
    }
  }

  // ---- 第二遍：网格 ----
  const parts: L2dmModel["parts"] = amIds.map((id, mi) => {
    const n = amPosCount[mi] ?? 0;
    const bs = amPosBegin[mi] ?? 0;
    const order = drawOrderByMesh.get(mi) ?? mi;
    if (n <= 0) return { id, order };

    const vertices: number[] = [];
    const uvs: number[] = [];
    const uvOff = (amUvBegin[mi] ?? 0) * 2;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const pi = posIdx[bs + k]!;
      if (pi < 0) { ok = false; break; }
      const [px, py] = toPx(positionPool[pi * 2] ?? 0, positionPool[pi * 2 + 1] ?? 0);
      vertices.push(px, py);
      uvs.push(uvPool[uvOff + k * 2] ?? 0, uvPool[uvOff + k * 2 + 1] ?? 0);
    }
    if (!ok || vertices.length === 0) return { id, order };

    const indices: number[] = [];
    for (let k = 0; k < n - (n % 3); k++) indices.push(k);

    const visible = visibleMesh[mi];
    const texIdx = amTex[mi] ?? -1;
    return {
      id,
      order,
      color: visible ? [1, 1, 1, 1] : [1, 1, 1, 0],
      texture: opts.textures && texIdx >= 0 && opts.textures[texIdx] ? opts.textures[texIdx] : undefined,
      mesh: { vertices, uvs, indices },
    };
  });

  // ---- M4：deformer 树 + 部件父级接线（rotation 精确；warp 网格形变尾随）----
  let deformers: L2dmModel["deformers"];
  if (opts.deformers !== false) {
    const d = buildDeformers(moc, { toCanvas: (x, y) => toPx(x, y) });
    deformers = d.deformers.length > 0 ? d.deformers : undefined;
    for (let mi = 0; mi < parts.length; mi++) {
      const pid = d.meshParents.get(mi);
      if (pid) parts[mi] = { ...parts[mi], parent: pid };
    }
  }
  return { formatVersion: 1, id: opts.id, canvas, parameters, parts, deformers };
}
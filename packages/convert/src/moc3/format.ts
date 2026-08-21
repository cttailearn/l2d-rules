// moc3/format.ts —— 分节布局定义（忠实转录自参考逆向：
//   py-moc3 的 SECTION_LAYOUT（对应官方 CMocMemoryMapperV1.initializeMemoryMap）
//   + moc3-reader-re 的 moc3-struct.txt —— 两者一致，字段齐全)
//
// moc3 内部是「struct-of-arrays」：~90 个 typed array，每个由 SOT(160 项 u32) 索引。
// 每个分节：(name, 元素类型, count_idx, align)。count 取自 counts[count_idx]。

export const MOC3_MAGIC = "MOC3";
export const MOC3_HEADER_SIZE = 64; // 头部：魔字 + version(u1) + endian(u1) + 填充
export const MOC3_SOT_COUNT = 160; // Section Offset Table 项数（每个 u32，共 640B）
export const MOC3_COUNT_INFO_SIZE = 128; // count info 区字节（23 × i32 + 填充）
export const MOC3_COUNT_INFO = 32; // counts[] 容量（仅前 23 有意义）
export const MOC3_DEFAULT_OFFSET = 0x7c0; // 1984：正文起点（countInfo + canvas + sections）
export const MOC3_ALIGN = 64;
export const MOC3_RUNTIME_UNIT = 8; // RUNTIME 元素字节
export const MOC3_CANVAS_SIZE = 64;

/** 版本枚举（byte4） */
export const Moc3Version = { V3_00: 1, V3_03: 2, V4_00: 3, V4_02: 4, V5_00: 5 } as const;
export type Moc3VersionN = (typeof Moc3Version)[keyof typeof Moc3Version];

/** counts[] 索引 → 章节组（struct.txt / py-moc3 CountIdx 一致） */
export const CountIdx = {
  PARTS: 0,
  DEFORMERS: 1,
  WARP_DEFORMERS: 2,
  ROTATION_DEFORMERS: 3,
  ART_MESHES: 4,
  PARAMETERS: 5,
  PART_KEYFORMS: 6,
  WARP_DEFORMER_KEYFORMS: 7,
  ROTATION_DEFORMER_KEYFORMS: 8,
  ART_MESH_KEYFORMS: 9,
  KEYFORM_POSITIONS: 10,
  KEYFORM_BINDING_INDICES: 11,
  KEYFORM_BINDING_BANDS: 12,
  KEYFORM_BINDINGS: 13,
  KEYS: 14,
  UVS: 15,
  POSITION_INDICES: 16,
  DRAWABLE_MASKS: 17,
  DRAW_ORDER_GROUPS: 18,
  DRAW_ORDER_GROUP_OBJECTS: 19,
  GLUES: 20,
  GLUE_INFOS: 21,
  GLUE_KEYFORMS: 22,
} as const;

export type ElemTypeName = "I32" | "F32" | "I16" | "U8" | "BOOL" | "STR64" | "RUNTIME";

export const ElemSize: Record<ElemTypeName, number> = {
  I32: 4, F32: 4, I16: 2, U8: 1, BOOL: 4, STR64: 64, RUNTIME: MOC3_RUNTIME_UNIT,
};

export interface SectionDef {
  name: string;
  type: ElemTypeName;
  /** counts[] 索引；-1 = 特殊（附加节，读取时跳过） */
  countIdx: number;
  /** >0 = 写入前 64B 对齐；STR64/附加 = 0 */
  align: number;
}

const A = MOC3_ALIGN;

/**
 * 分节布局（顺序即官方内存映射顺序；读路径按 SOT 定位、行进对齐跳转）。
 * countIdx 与 _core.py / struct.txt 一一对应。
 */
export const SECTION_LAYOUT: readonly SectionDef[] = [
  // ---- Parts (counts[0]) ----
  { name: "part.runtime_space", type: "RUNTIME", countIdx: CountIdx.PARTS, align: A },
  { name: "part.ids", type: "STR64", countIdx: CountIdx.PARTS, align: 0 },
  { name: "part.keyform_binding_band_indices", type: "I32", countIdx: CountIdx.PARTS, align: A },
  { name: "part.keyform_begin_indices", type: "I32", countIdx: CountIdx.PARTS, align: A },
  { name: "part.keyform_counts", type: "I32", countIdx: CountIdx.PARTS, align: A },
  { name: "part.visibles", type: "BOOL", countIdx: CountIdx.PARTS, align: A },
  { name: "part.enables", type: "BOOL", countIdx: CountIdx.PARTS, align: A },
  { name: "part.parent_part_indices", type: "I32", countIdx: CountIdx.PARTS, align: A },
  // ---- Deformers (counts[1]) ----
  { name: "deformer.runtime_space", type: "RUNTIME", countIdx: CountIdx.DEFORMERS, align: A },
  { name: "deformer.ids", type: "STR64", countIdx: CountIdx.DEFORMERS, align: 0 },
  { name: "deformer.keyform_binding_band_indices", type: "I32", countIdx: CountIdx.DEFORMERS, align: A },
  { name: "deformer.visibles", type: "BOOL", countIdx: CountIdx.DEFORMERS, align: A },
  { name: "deformer.enables", type: "BOOL", countIdx: CountIdx.DEFORMERS, align: A },
  { name: "deformer.parent_part_indices", type: "I32", countIdx: CountIdx.DEFORMERS, align: A },
  { name: "deformer.parent_deformer_indices", type: "I32", countIdx: CountIdx.DEFORMERS, align: A },
  { name: "deformer.types", type: "I32", countIdx: CountIdx.DEFORMERS, align: A },
  { name: "deformer.specific_indices", type: "I32", countIdx: CountIdx.DEFORMERS, align: A },
  // ---- WarpDeformers (counts[2]) ----
  { name: "warp_deformer.keyform_binding_band_indices", type: "I32", countIdx: CountIdx.WARP_DEFORMERS, align: A },
  { name: "warp_deformer.keyform_begin_indices", type: "I32", countIdx: CountIdx.WARP_DEFORMERS, align: A },
  { name: "warp_deformer.keyform_counts", type: "I32", countIdx: CountIdx.WARP_DEFORMERS, align: A },
  { name: "warp_deformer.vertex_counts", type: "I32", countIdx: CountIdx.WARP_DEFORMERS, align: A },
  { name: "warp_deformer.rows", type: "I32", countIdx: CountIdx.WARP_DEFORMERS, align: A },
  { name: "warp_deformer.cols", type: "I32", countIdx: CountIdx.WARP_DEFORMERS, align: A },
  // ---- RotationDeformers (counts[3]) ----
  { name: "rotation_deformer.keyform_binding_band_indices", type: "I32", countIdx: CountIdx.ROTATION_DEFORMERS, align: A },
  { name: "rotation_deformer.keyform_begin_indices", type: "I32", countIdx: CountIdx.ROTATION_DEFORMERS, align: A },
  { name: "rotation_deformer.keyform_counts", type: "I32", countIdx: CountIdx.ROTATION_DEFORMERS, align: A },
  { name: "rotation_deformer.base_angles", type: "F32", countIdx: CountIdx.ROTATION_DEFORMERS, align: A },
  // ---- ArtMeshes (counts[4]) ----
  { name: "art_mesh.runtime_space_0", type: "RUNTIME", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.runtime_space_1", type: "RUNTIME", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.runtime_space_2", type: "RUNTIME", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.runtime_space_3", type: "RUNTIME", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.ids", type: "STR64", countIdx: CountIdx.ART_MESHES, align: 0 },
  { name: "art_mesh.keyform_binding_band_indices", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.keyform_begin_indices", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.keyform_counts", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.visibles", type: "BOOL", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.enables", type: "BOOL", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.parent_part_indices", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.parent_deformer_indices", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.texture_indices", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.drawable_flags", type: "U8", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.position_index_counts", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.uv_begin_indices", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.position_index_begin_indices", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.vertex_counts", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.mask_begin_indices", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  { name: "art_mesh.mask_counts", type: "I32", countIdx: CountIdx.ART_MESHES, align: A },
  // ---- Parameters (counts[5]) ----
  { name: "parameter.runtime_space", type: "RUNTIME", countIdx: CountIdx.PARAMETERS, align: A },
  { name: "parameter.ids", type: "STR64", countIdx: CountIdx.PARAMETERS, align: 0 },
  { name: "parameter.max_values", type: "F32", countIdx: CountIdx.PARAMETERS, align: A },
  { name: "parameter.min_values", type: "F32", countIdx: CountIdx.PARAMETERS, align: A },
  { name: "parameter.default_values", type: "F32", countIdx: CountIdx.PARAMETERS, align: A },
  { name: "parameter.repeats", type: "BOOL", countIdx: CountIdx.PARAMETERS, align: A },
  { name: "parameter.decimal_places", type: "I32", countIdx: CountIdx.PARAMETERS, align: A },
  { name: "parameter.keyform_binding_begin_indices", type: "I32", countIdx: CountIdx.PARAMETERS, align: A },
  { name: "parameter.keyform_binding_counts", type: "I32", countIdx: CountIdx.PARAMETERS, align: A },
  // ---- PartKeyforms (counts[6]) ----
  { name: "part_keyform.draw_orders", type: "F32", countIdx: CountIdx.PART_KEYFORMS, align: A },
  // ---- WarpDeformerKeyforms (counts[7]) ----
  { name: "warp_deformer_keyform.opacities", type: "F32", countIdx: CountIdx.WARP_DEFORMER_KEYFORMS, align: A },
  { name: "warp_deformer_keyform.keyform_position_begin_indices", type: "I32", countIdx: CountIdx.WARP_DEFORMER_KEYFORMS, align: A },
  // ---- RotationDeformerKeyforms (counts[8]) ----
  { name: "rotation_deformer_keyform.opacities", type: "F32", countIdx: CountIdx.ROTATION_DEFORMER_KEYFORMS, align: A },
  { name: "rotation_deformer_keyform.angles", type: "F32", countIdx: CountIdx.ROTATION_DEFORMER_KEYFORMS, align: A },
  { name: "rotation_deformer_keyform.origin_xs", type: "F32", countIdx: CountIdx.ROTATION_DEFORMER_KEYFORMS, align: A },
  { name: "rotation_deformer_keyform.origin_ys", type: "F32", countIdx: CountIdx.ROTATION_DEFORMER_KEYFORMS, align: A },
  { name: "rotation_deformer_keyform.scales", type: "F32", countIdx: CountIdx.ROTATION_DEFORMER_KEYFORMS, align: A },
  { name: "rotation_deformer_keyform.reflect_xs", type: "BOOL", countIdx: CountIdx.ROTATION_DEFORMER_KEYFORMS, align: A },
  { name: "rotation_deformer_keyform.reflect_ys", type: "BOOL", countIdx: CountIdx.ROTATION_DEFORMER_KEYFORMS, align: A },
  // ---- ArtMeshKeyforms (counts[9]) ----
  { name: "art_mesh_keyform.opacities", type: "F32", countIdx: CountIdx.ART_MESH_KEYFORMS, align: A },
  { name: "art_mesh_keyform.draw_orders", type: "F32", countIdx: CountIdx.ART_MESH_KEYFORMS, align: A },
  { name: "art_mesh_keyform.keyform_position_begin_indices", type: "I32", countIdx: CountIdx.ART_MESH_KEYFORMS, align: A },
  // ---- KeyformPositions (counts[10]) ----
  { name: "keyform_position.xys", type: "F32", countIdx: CountIdx.KEYFORM_POSITIONS, align: A },
  // ---- KeyformBindingIndexes (counts[11]) ----
  { name: "keyform_binding_index.indices", type: "I32", countIdx: CountIdx.KEYFORM_BINDING_INDICES, align: A },
  // ---- KeyformBindingBands (counts[12]) ----
  { name: "keyform_binding_band.begin_indices", type: "I32", countIdx: CountIdx.KEYFORM_BINDING_BANDS, align: A },
  { name: "keyform_binding_band.counts", type: "I32", countIdx: CountIdx.KEYFORM_BINDING_BANDS, align: A },
  // ---- KeyformBindings (counts[13]) ----
  { name: "keyform_binding.keys_begin_indices", type: "I32", countIdx: CountIdx.KEYFORM_BINDINGS, align: A },
  { name: "keyform_binding.keys_counts", type: "I32", countIdx: CountIdx.KEYFORM_BINDINGS, align: A },
  // ---- Keys (counts[14]) ----
  { name: "keys.values", type: "F32", countIdx: CountIdx.KEYS, align: A },
  // ---- UVs (counts[15]) ----
  { name: "uv.xys", type: "F32", countIdx: CountIdx.UVS, align: A },
  // ---- PositionIndexes (counts[16]) ----
  { name: "position_index.indices", type: "I16", countIdx: CountIdx.POSITION_INDICES, align: A },
  // ---- DrawableMasks (counts[17]) ----
  { name: "drawable_mask.art_mesh_indices", type: "I32", countIdx: CountIdx.DRAWABLE_MASKS, align: A },
  // ---- DrawOrderGroups (counts[18]) ----
  { name: "draw_order_group.object_begin_indices", type: "I32", countIdx: CountIdx.DRAW_ORDER_GROUPS, align: A },
  { name: "draw_order_group.object_counts", type: "I32", countIdx: CountIdx.DRAW_ORDER_GROUPS, align: A },
  { name: "draw_order_group.object_total_counts", type: "I32", countIdx: CountIdx.DRAW_ORDER_GROUPS, align: A },
  { name: "draw_order_group.min_draw_orders", type: "I32", countIdx: CountIdx.DRAW_ORDER_GROUPS, align: A },
  { name: "draw_order_group.max_draw_orders", type: "I32", countIdx: CountIdx.DRAW_ORDER_GROUPS, align: A },
  // ---- DrawOrderGroupObjects (counts[19]) ----
  { name: "draw_order_group_object.types", type: "I32", countIdx: CountIdx.DRAW_ORDER_GROUP_OBJECTS, align: A },
  { name: "draw_order_group_object.indices", type: "I32", countIdx: CountIdx.DRAW_ORDER_GROUP_OBJECTS, align: A },
  { name: "draw_order_group_object.group_indices", type: "I32", countIdx: CountIdx.DRAW_ORDER_GROUP_OBJECTS, align: A },
  // ---- Glues (counts[20]) ----
  { name: "glue.runtime_space", type: "RUNTIME", countIdx: CountIdx.GLUES, align: A },
  { name: "glue.ids", type: "STR64", countIdx: CountIdx.GLUES, align: 0 },
  { name: "glue.keyform_binding_band_indices", type: "I32", countIdx: CountIdx.GLUES, align: A },
  { name: "glue.keyform_begin_indices", type: "I32", countIdx: CountIdx.GLUES, align: A },
  { name: "glue.keyform_counts", type: "I32", countIdx: CountIdx.GLUES, align: A },
  { name: "glue.art_mesh_index_as", type: "I32", countIdx: CountIdx.GLUES, align: A },
  { name: "glue.art_mesh_index_bs", type: "I32", countIdx: CountIdx.GLUES, align: A },
  { name: "glue.info_begin_indices", type: "I32", countIdx: CountIdx.GLUES, align: A },
  { name: "glue.info_counts", type: "I32", countIdx: CountIdx.GLUES, align: A },
  // ---- GlueInfos (counts[21]) ----
  { name: "glue_info.weights", type: "F32", countIdx: CountIdx.GLUE_INFOS, align: A },
  { name: "glue_info.position_indices", type: "I16", countIdx: CountIdx.GLUE_INFOS, align: A },
  // ---- GlueKeyforms (counts[22]) ----
  { name: "glue_keyform.intensities", type: "F32", countIdx: CountIdx.GLUE_KEYFORMS, align: A },
];

/** V3.03+ 附加节（写入时追加；读取时计 -1 忽略——运行时空间归零） */
export const ADDITIONAL_V303: SectionDef = {
  name: "additional.quad_transforms", type: "BOOL", countIdx: -1, align: 0,
};

/** 按版本构建有效布局 */
export function buildLayout(version: number): readonly SectionDef[] {
  return version >= Moc3Version.V3_03 ? [...SECTION_LAYOUT, ADDITIONAL_V303] : SECTION_LAYOUT;
}

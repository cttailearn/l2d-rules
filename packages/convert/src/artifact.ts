// artifact.ts —— .l2dm 自包含模型产物：把官方模型资源（纹理）内嵌为数据 URI
// 目标：.l2dm 一个文件即自包含——几何(Phase1 骨架) + 参数面 + 动作/表情元数据 + 资源(atlas)。
// 宿主拿到后无需外部文件即可解码纹理并渲染（解码/上传仍归宿主）。

import type { L2dmModel } from "@l2dp/engine";
import { bundlePhysicsToPendulums, bundlePoseToGroups, toL2dmSkeleton } from "./skeleton.ts";
import { moc3ToL2dm, readMoc3 } from "./moc3/index.ts";
import type { ConvertedBundle } from "./types.ts";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 字节 → base64（零依赖实现，浏览器/Node 通用；确定性）。 */
export function bytesToB64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    const rem = bytes.length - i;
    out += rem > 1 ? B64[(n >> 6) & 63]! : "=";
    out += rem > 2 ? B64[n & 63]! : "=";
  }
  return out;
}

/** 文件扩展名 → image MIME。 */
export function mimeForFile(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "jpg": case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "avif": return "image/avif";
    default: return "image/png";
  }
}

/** 字节 → data URI（内嵌 atlas 值）。 */
export function toDataUri(bytes: Uint8Array, mime = "image/png"): string {
  return `data:${mime};base64,${bytesToB64(bytes)}`;
}

export interface ArtifactOptions {
  /** 内嵌纹理（file = model3 FileReferences.Textures 相对路径） */
  textures?: { file: string; bytes: Uint8Array }[];
  canvas?: { width: number; height: number };
  /** 是否把占位部件改为引用真实纹理（默认 false：仅内嵌 atlas，网格保持纯色） */
  attachTextures?: boolean;
  /**
   * Phase-2 真实几何：官方 .moc3 二进制。提供后 toL2dmArtifact 用 readMoc3+moc3ToL2dm
   * 产出真实 ArtMesh 几何 + 烘焙 warp + deformer 树（不再用占位网格），
   * 并叠加 bundle 的 physics3→摆锤 与 pose3→联动组。缺省 = Phase-1 占位骨架。
   */
  moc3Bytes?: Uint8Array;
  /** 目标高度（像素）：真实几何降采样渲染用（如浏览器 demo）；缺省 = 包围盒等比 */
  targetHeight?: number;
}

/**
 * 把 ConvertedBundle 升级为**自包含 .l2dm 模型产物**：
 * - 有 moc3Bytes（Phase-2）：真实几何（顶点/UV/索引/warp/deformer）+ bundle 参数面 + physics/pose 叠加 + 内嵌 atlas；
 * - 无 moc3Bytes（Phase-1）：占位网格骨架 + 参数面 + 内嵌 atlas。
 */
export function toL2dmArtifact(bundle: ConvertedBundle, opts: ArtifactOptions = {}): L2dmModel {
  const files = opts.textures ? opts.textures.map((t) => t.file) : [];
  let model: L2dmModel;
  if (opts.moc3Bytes) {
    const rm = readMoc3(opts.moc3Bytes);
    if (!rm.ok) throw new Error("toL2dmArtifact: .moc3 解析失败: " + rm.error);
    model = moc3ToL2dm(rm.moc, {
      id: bundle.source,
      textures: files.length > 0 ? files : undefined,
      groups: bundle.groups as { target: string; name: string; ids: string[] }[] | undefined,
      canvas: opts.canvas,
      targetHeight: opts.targetHeight,
    });
    // 叠加 bundle 元数据：physics3→摆锤 + pose3→联动组（moc3 本身不含这二者）
    const paramIds = new Set(model.parameters.map((p) => p.id));
    const pendulums = bundlePhysicsToPendulums(bundle, paramIds);
    if (pendulums.length > 0) model.physics = { pendulums };
    const groups = bundlePoseToGroups(bundle).filter((g) => g.ids.every((pid) => model.parts.some((p) => p.id === pid)));
    if (groups.length > 0) model.pose = { groups };
  } else {
    model = toL2dmSkeleton(bundle, { canvas: opts.canvas });
  }
  if (opts.textures && opts.textures.length > 0) {
    const atlas: Record<string, string> = {};
    for (const t of opts.textures) atlas[t.file] = toDataUri(t.bytes, mimeForFile(t.file));
    model.atlas = atlas;
    if (opts.attachTextures) {
      model.parts = model.parts.map((p, i) => ({ ...p, texture: files[i % files.length]! }));
    }
  }
  return model;
}


/** 给任意 L2dmModel（含 moc3 真实几何）内嵌纹理 atlas（data URI）。 */
export function embedAtlasInto(model: L2dmModel, textures: { file: string; bytes: Uint8Array }[]): L2dmModel {
  const atlas: Record<string, string> = {};
  for (const t of textures) atlas[t.file] = toDataUri(t.bytes, mimeForFile(t.file));
  model.atlas = atlas;
  return model;
}

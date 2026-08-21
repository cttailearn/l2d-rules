// author.ts —— .l2dm 作者/二次修改工具链（从零构建 + 编辑 API）
// 两用：
//   - 从零构建：createL2dm(spec) —— 纯规格 → 合法 .l2dm（AI 可生成 / 手写）
//   - 二次修改：编辑 API 原地修改并返回 model（官方模型转换产物可直接再编辑）
// 所有编辑保持"校验友好"（如 addPart 自动补 order；embedTexture 自动 data URI）。

import { validateL2dmModel, type L2dmDeformer, type L2dmModel, type L2dmParamGroup, type L2dmPart, type L2dmPhysics, type L2dmPose, type L2dmWarp } from "@l2dp/engine";
import { toDataUri, mimeForFile } from "./artifact.ts";
import { sanitizeId } from "./skeleton.ts";

export interface L2dmCreateSpec {
  id: string;
  canvas?: { width: number; height: number };
  parameters?: { id: string; min?: number; max?: number; def?: number; group?: L2dmParamGroup }[];
  parts?: L2dmPart[];
  deformers?: L2dmDeformer[];
  physics?: L2dmPhysics;
  pose?: L2dmPose;
  atlas?: Record<string, string>;
}

/** 从零构建 .l2dm 模型（缺省值友好：参数默认 [0,1]/Custom，画布 32x32）。建议随后 validate() 复核。 */
export function createL2dm(spec: L2dmCreateSpec): L2dmModel {
  return {
    formatVersion: 1,
    id: sanitizeId(spec.id) || spec.id,
    canvas: spec.canvas ?? { width: 32, height: 32 },
    parameters: (spec.parameters ?? []).map((p) => ({
      id: p.id,
      min: p.min ?? 0,
      max: p.max ?? 1,
      def: p.def,
      group: p.group ?? "Custom",
    })),
    parts: spec.parts ?? [],
    deformers: spec.deformers,
    physics: spec.physics,
    pose: spec.pose,
    atlas: spec.atlas,
  };
}

// ---------------- 二次修改（编辑 API） ----------------

export function addPart(model: L2dmModel, part: Omit<L2dmPart, "order"> & { order?: number }): L2dmModel {
  model.parts.push({ ...part, order: part.order ?? model.parts.length });
  return model;
}

export function removePart(model: L2dmModel, id: string): L2dmModel {
  model.parts = model.parts.filter((p) => p.id !== id);
  model.parts.forEach((p, i) => { p.order = i; });
  return model;
}

export function setPartOrder(model: L2dmModel, id: string, order: number): L2dmModel {
  const p = model.parts.find((x) => x.id === id);
  if (p) p.order = order;
  return model;
}

export function setParamRange(model: L2dmModel, paramId: string, min: number, max: number, def?: number): L2dmModel {
  const p = model.parameters.find((x) => x.id === paramId);
  if (p) {
    p.min = min;
    p.max = max;
    if (def !== undefined) p.def = def;
  }
  return model;
}

export function setParamGroup(model: L2dmModel, paramId: string, group: L2dmParamGroup): L2dmModel {
  const p = model.parameters.find((x) => x.id === paramId);
  if (p) p.group = group;
  return model;
}

export function addParameter(model: L2dmModel, param: { id: string; min?: number; max?: number; def?: number; group?: L2dmParamGroup }): L2dmModel {
  model.parameters.push({ id: param.id, min: param.min ?? 0, max: param.max ?? 1, def: param.def, group: param.group ?? "Custom" });
  return model;
}

/** 内嵌纹理：bytes → data URI 写入 model.atlas（覆盖同名）。 */
export function embedTexture(model: L2dmModel, file: string, bytes: Uint8Array, mime?: string): L2dmModel {
  model.atlas = model.atlas ?? {};
  model.atlas[file] = toDataUri(bytes, mime ?? mimeForFile(file));
  return model;
}

/** 部件引用纹理（atlas 键需存在；uvRect 可给采样区域）。 */
export function attachTexture(model: L2dmModel, partId: string, atlasFile: string, uvRect?: { x: number; y: number; width: number; height: number }): L2dmModel {
  const p = model.parts.find((x) => x.id === partId);
  if (p) {
    p.texture = atlasFile;
    if (uvRect) p.uvRect = uvRect;
  }
  return model;
}

/** 缺网格的部件补一个默认四边网格（方便快速加部件再加 warp）。确保后 addWarp 可用。 */
export function ensureMesh(model: L2dmModel, partId: string): L2dmModel {
  const p = model.parts.find((x) => x.id === partId);
  if (p && !p.mesh) {
    p.mesh = {
      vertices: [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5],
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      indices: [0, 1, 2, 0, 2, 3],
    };
  }
  return model;
}

/** 加参数驱动的形变（warp）；keyform.offsets 长度须 = 网格顶点数（validator 复核）。 */
export function addWarp(model: L2dmModel, partId: string, warp: L2dmWarp): L2dmModel {
  const p = model.parts.find((x) => x.id === partId);
  if (p && p.mesh) {
    p.mesh.warps = p.mesh.warps ?? [];
    p.mesh.warps.push(warp);
  }
  return model;
}

export function addDeformer(model: L2dmModel, deformer: L2dmDeformer): L2dmModel {
  model.deformers = model.deformers ?? [];
  model.deformers.push(deformer);
  return model;
}

export function addPendulum(model: L2dmModel, pendulum: NonNullable<L2dmModel["physics"]>["pendulums"][number]): L2dmModel {
  model.physics = model.physics ?? { pendulums: [] };
  model.physics.pendulums.push(pendulum);
  return model;
}

/** 校验当前模型（engine 规则 1–7）。编辑后复核用。 */
export function validate(model: L2dmModel): { ok: boolean; issues: { path: string; message: string }[] } {
  return validateL2dmModel(model);
}

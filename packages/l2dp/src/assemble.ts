// .l2dp 工程组装（规格 6）：自动绑定增量 + 部件/纹理 → 完整文件集
import type { Part, Mesh, ParamDef, Deformer, Groups, Motion, Expression, Manifest } from "./types.ts";

export interface AssemblyInput {
  meta: { id: string; name: string; author: string; grade?: string };
  parts: Part[];
  meshes: Mesh[];
  params: ParamDef[];
  deformers?: Deformer[];
  groups?: Groups;
  motions?: Motion[];
  expressions?: Expression[];
  textures: Uint8Array[]; // 纹理页（RGBA PNG 字节），可为空
}

export interface AssembledL2dp {
  files: Record<string, Uint8Array>; // 相对路径 → 字节
  manifest: Manifest;
  validate: () => Promise<{ ok: boolean; issues: { path: string; message: string }[] }>;
}

export function assembleProject(input: AssemblyInput): AssembledL2dp {
  const textureFiles: string[] = [];
  const filesMap: Record<string, Uint8Array> = {};
  input.textures.forEach((bytes, i) => {
    const name = `page_${String(i).padStart(2, "0")}.png`;
    textureFiles.push("textures/" + name);
    filesMap["textures/" + name] = bytes;
  });

  const manifest: Manifest = {
    schemaVersion: 2,
    id: input.meta.id,
    name: input.meta.name,
    author: input.meta.author,
    grade: input.meta.grade ?? "adult",
    displayInfo: { width: 1024, height: 1024, originX: 0, originY: 0, pixelsPerUnit: 1 },
    fileManifest: {
      textures: textureFiles,
      parts: "parts.json",
      meshes: "meshes.json",
      deformers: "deformers.json",
      params: "params.json",
      groups: "groups.json",
      motions: "motions",
      expressions: "expressions",
    },
  };

  filesMap["manifest.json"] = utf8(JSON.stringify(manifest, null, 2));
  filesMap["parts.json"] = utf8(JSON.stringify(input.parts, null, 2));
  filesMap["meshes.json"] = utf8(JSON.stringify(input.meshes, null, 2));
  filesMap["deformers.json"] = utf8(JSON.stringify(input.deformers ?? [], null, 2));
  filesMap["params.json"] = utf8(JSON.stringify(input.params, null, 2));
  filesMap["groups.json"] = utf8(JSON.stringify(input.groups ?? { paramGroups: [], partGroups: [] }, null, 2));
  // 规格 6.2 约定：Idle 组必须存在——工具链为无动作工程生成默认 idle
  const motions = input.motions?.length ? input.motions : [DEFAULT_IDLE_MOTION];
  filesMap["motions/Idle.json"] = utf8(JSON.stringify(motions[0], null, 2));
  if (input.expressions?.length) filesMap["expressions/expr_0.json"] = utf8(JSON.stringify(input.expressions[0], null, 2));

  return {
    files: filesMap,
    manifest,
    validate: async () => {
      const { validateManifest } = await import("./validate.ts");
      const v = validateManifest(
        manifest, input.parts, input.meshes, input.params, input.groups,
        motions, input.expressions ?? [], undefined,
      );
      return { ok: v.ok, issues: v.issues };
    },
  };
}

const DEFAULT_IDLE_MOTION: Motion = {
  meta: { duration: 2, fps: 30, loop: true },
  curves: [{ target: "Parameter", id: "PARAM_ANGLE_X", segments: [0, 0, 0, 2, 0] }],
};

export function utf8(s: string): Uint8Array { return new TextEncoder().encode(s); }
export function fromUtf8(b: Uint8Array): string { return new TextDecoder().decode(b); }

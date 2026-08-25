// manifest.ts —— 词表 manifest 生成器 + library 索引生成（P6）——「目录进」的装配面
// 给定（模型参数面 / 动作与表情资产表）→ 产出 driver 消费的 ManifestLike / AssetIndex，
// 供 StreamIngestor / 双模式校验 / 两跳共用。纯函数、零平台依赖。

import type { AssetIndex, ManifestLike } from "./ir/types.ts";

/** 参数定义（结构型 = .l2dm parameter / EnvParamDef / manifest sems 的公共形状） */
export interface ParamDefLike {
  id: string;
  min: number;
  max: number;
  def?: number;
  group?: string;
}

/**
 * 词表 manifest 生成器：参数面 → ManifestLike（sems 单一来源）。
 * 语义名即参数 id（SPEC「引擎参数 = 语义参数」）。
 */
export function generateManifest(parameters: readonly ParamDefLike[]): ManifestLike {
  return {
    sems: parameters.map((p) => ({
      name: p.id,
      min: p.min,
      max: p.max,
      ...(p.group !== undefined ? { group: p.group } : {}),
      ...(p.def !== undefined ? { def: p.def } : {}),
    })),
  };
}

/** 词表抽取：manifest → 语义名列表（供 labeler 词表提示 / 工具描述 / 校验诊断）。 */
export function vocabularyOf(manifest: ManifestLike): string[] {
  return manifest.sems.map((s) => s.name);
}

/** library 索引生成：动作/表情资产表 → AssetIndex（供校验引用解析与第一跳 kinds 提取）。 */
export function generateLibraryIndex(
  motions: readonly { name: string; group?: string }[],
  expressions: readonly { name: string }[] = [],
): AssetIndex {
  return {
    motions: motions.map((m) => ({ name: m.name, ...(m.group !== undefined ? { group: m.group } : {}) })),
    expressions: expressions.map((e) => ({ name: e.name })),
    behaviors: [],
  };
}

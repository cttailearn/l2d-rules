// catalog.ts —— 库索引生成器（目录进、IR 出）—— P6「library 索引」+ §14.3-2「资产权重/随机选择」
// 把宿主/编辑器给的行为目录（BehaviorItem 列表，支持 weight）装配成第一跳可用的 BehaviorIndex。
// 确定性：同 (目录顺序, seed) → 同 pick 分布（BehaviorIndex 内部 mulberry32）。

import { BehaviorIndex, type BehaviorItem } from "./twohop/types.ts";

export interface BehaviorCatalog {
  behaviors: readonly BehaviorItem[];
  /** 默认种子（供 BehaviorIndex 加权随机；缺省固定值保证可复现） */
  seed?: number;
}

/**
 * 从行为目录构建第一跳 BehaviorIndex（§6.8「目录进、IR 出」）。
 * 与 BehaviorIndex 直接 register 等价，但把"目录 + 种子"作为一个原子装配单元，
 * 供宿主从 manifest cache / 资产库一次性生成索引。
 */
export function buildBehaviorIndex(catalog: BehaviorCatalog): BehaviorIndex {
  const index = new BehaviorIndex(catalog.seed);
  for (const b of catalog.behaviors) index.register(b);
  return index;
}

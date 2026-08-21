// map.ts —— 官方 id → 引擎语义 的映射启发（参数组映射 / 值域猜测 / 确定性配色）
// 说明：官方 moc3 无损几何里才是参数范围的权威来源（Phase 2）。
// Phase 1 提供：model3 Groups（EyeBlink/LipSync）+ cdi3 ParameterGroup 映射 + 值域启发式。

import type { L2dmParamGroup } from "@l2dp/engine";

/** 官方参数组（cdi3 ParameterGroups，Haru 样本的 GroupId 值）→ 引擎合法组 */
const GROUP_ID_MAP: Record<string, L2dmParamGroup> = {
  ParamGroupFace: "Head",
  ParamGroupEyes: "Head",
  ParamGroup: "Head", // 眉毛
  ParamGroupMouth: "LipSync",
  ParamGroup2: "Body", // 胴体（含呼吸/重心）
  ParamGroupArms: "Body",
  ParamGroup3: "Physics", // 髪揺れ
};

/**
 * 把参数 id 映射为引擎参数组：
 *   1) model3 Groups.EyeBlink / LipSync 指定 id → 对应组（权威）
 *   2) cdi3 ParameterGroup → 启发式映射（Face/Eyes→Head，Mouth→LipSync，2/Arms→Body，3→Physics）
 *   3) 特例：ParamBreath → Ambient（环境层呼吸管辖）
 *   4) 兜底 Custom
 */
export function mapEngineGroup(
  paramId: string,
  groupId: string | undefined,
  groups: { target: string; name: string; ids: string[] }[],
): L2dmParamGroup {
  if (paramId === "ParamBreath" || /Breath/i.test(paramId)) return "Ambient";
  for (const g of groups) {
    if (g.target === "Parameter" && (g.name === "EyeBlink" || g.name === "LipSync") && g.ids.includes(paramId)) {
      return g.name === "EyeBlink" ? "EyeBlink" : "LipSync";
    }
  }
  if (groupId && groupId in GROUP_ID_MAP) return GROUP_ID_MAP[groupId]!;
  // 兜底启发式（无 cdi3 场景）
  if (/Angle|Head|Tere|FaceForm/i.test(paramId)) return "Head";
  if (/Body|Bust|Arm/i.test(paramId)) return "Body";
  if (/Hair|Front|Side|Back|Scarf/i.test(paramId)) return "Physics";
  if (/Open|Smile|Mouth/i.test(paramId)) return "LipSync";
  return "Custom";
}

/**
 * 参数值域启发式（真实范围在 .moc3，Phase 2 覆盖）。规则：
 *   Open/Smile 类 → [0,1]；Angle 类 → [-30,30]；Breath → [-1,1]；Tere/Tear → [0,1]；兜底 [-1,1]
 */
export function guessParamRange(id: string): { min: number; max: number; def: number } {
  if (/Open|Smile/i.test(id)) return { min: 0, max: 1, def: 0 };
  if (/Angle/i.test(id)) return { min: -30, max: 30, def: 0 };
  if (/Breath/i.test(id)) return { min: -1, max: 1, def: 0 };
  if (/Tere|Tear|Form/i.test(id)) return { min: 0, max: 1, def: 0 };
  return { min: -1, max: 1, def: 0 };
}

/** 确定性字符串哈希 → [0,1)（占位网格配色用；同 id 同色） */
export function hashUnit(id: string): number {
  let h = 2166136261; // FNV-1a 32
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** HSL → RGB（s=0.65, v=0.55，保证多个部件可区分） */
export function hueToRgb(hueDeg: number): [number, number, number, number] {
  const h = ((hueDeg % 360) + 360) % 360;
  const s = 0.65;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  // 0..1（引擎 L2dmPart.color 契约：0..1，渲染前由 player 转 0..255）
  return [r + m, g + m, b + m, 1];
}

export function partColor(id: string): [number, number, number, number] {
  return hueToRgb(hashUnit(id) * 360);
}

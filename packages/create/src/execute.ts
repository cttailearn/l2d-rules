// execute.ts —— 执行创作指令：校验 → rig（@l2dp/rig）→ 动作资产 → 合成结果
import { rigCharacter, type RigCharacterSpec, type RigPartSpec, type RigResult } from "@l2dp/rig";
import type { L2dmModel } from "@l2dp/engine";
import type { CreationDirective, CreationMotion } from "./ir.ts";
import { generateStarterMotions, motionFromCreation, type NamedMotion } from "./motions.ts";
import { validateCreation } from "./validate.ts";

export interface CreationResult {
  character: string;
  canvas: { width: number; height: number };
  model: L2dmModel;
  rig: RigResult;
  motions: NamedMotion[];
  notes: string[];
}

/** 执行创作指令（运行时依赖 @l2dp/rig 的绑定 + @l2dp/engine 的动作类型）。 */
export function executeCreation(d: CreationDirective): CreationResult {
  const issues = validateCreation(d);
  if (issues.length > 0) {
    throw new Error("创作指令校验未通过：" + issues.map((i) => i.rule + " " + i.path + ": " + i.message).join("；"));
  }
  const canvas = d.canvas ?? { width: 512, height: 1024 };

  const rigParts: RigPartSpec[] = d.parts.map((p) => ({
    id: p.id,
    semantic: p.semantic as RigPartSpec["semantic"],
    side: p.side,
    bbox: p.bbox,
    color: p.color,
    image: p.image,
    customParams: p.customParams,
  }));
  const rigSpec: RigCharacterSpec = {
    id: d.character,
    canvas,
    parts: rigParts,
    hinge: d.hinge,
    physics: d.physics,
    breathing: d.breathing,
    customTemplates: d.customTemplates,
  };
  const rig = rigCharacter(rigSpec);

  const params = rig.model.parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def }));
  let motions: NamedMotion[];
  if (d.motions && d.motions.length > 0) {
    motions = d.motions.map((m: CreationMotion) => ({
      name: m.name,
      kind: m.kind,
      motion: motionFromCreation(m.curves, m.durationMs, m.loop ?? false, m.name, m.kind),
    }));
  } else {
    motions = generateStarterMotions(params);
  }

  const notes: string[] = [
    "创建方式：P4b 创作指令 → @l2dp/rig 半自动绑定 + 基础动作生成",
    "动作资产：" + motions.map((m) => m.name).join("/"),
  ];
  return { character: rig.model.id, canvas, model: rig.model, rig, motions, notes };
}

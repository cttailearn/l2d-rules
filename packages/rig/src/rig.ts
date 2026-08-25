// rig.ts —— 半自动绑定主入口（P4a）：PartSpec → 参数挂接 + warp 形变合成 + 自动顺序/物理 → .l2dm + RigSpec + 报告
// 复用 @l2dp/convert 的 author.ts（createL2dm / embedTexture / sanitizeId）作为写入面。
import { createL2dm, embedTexture, sanitizeId } from "@l2dp/convert";
import type { L2dmDeformer, L2dmMesh, L2dmModel, L2dmPart } from "@l2dp/engine";
import { RIG_TEMPLATES, headClusterSemantics, type RigTemplate, type RigTemplateLike, type RigTemplateSemantic } from "./vocab.ts";
import { collectCostumeGroups, costumeParamOf, deriveParameters } from "./params.ts";
import { makeGrid, toL2dmMesh, type Grid } from "./meshes.ts";
import {
  warp1D,
  headTurnWarp2D,
  eyeLidOffsets,
  browOffsets,
  mouthOpenOffsets,
  mouthSmileOffsets,
  hairSwayOffsets,
  hairHeadFollowOffsets,
  bodyLowerSwayOffsets,
  limbSwayOffsets,
  tailSwayOffsets,
  wingFlapOffsets,
  earTwitchOffsets,
} from "./warps.ts";
import { buildReport } from "./report.ts";
import type { RigBinding, RigCharacterSpec, RigResult, RigSpec, RigSpecDeformer, RigSpecPendulum } from "./types.ts";

/** 语义 → headCluster 判定缓存（含服装头簇成员，如 hairstyle） */
const HEAD_SEM = new Set<string>(headClusterSemantics() as readonly string[]);

function defaultHinge(parts: RigCharacterSpec["parts"], canvas: { width: number; height: number }): { x: number; y: number } {
  const face = parts.find((p) => p.semantic === "face");
  if (face) return { x: face.bbox.x + face.bbox.width / 2, y: face.bbox.y + face.bbox.height };
  const firstHead = parts.find((p) => HEAD_SEM.has(p.semantic));
  if (firstHead) return { x: firstHead.bbox.x + firstHead.bbox.width / 2, y: firstHead.bbox.y + firstHead.bbox.height };
  return { x: canvas.width * 0.5, y: canvas.height * 0.62 };
}

/**
 * 从 PartSpec 建出完整可驱动模型。
 * - 每个部件：语义模板网格配准到 bbox；头簇 → warp2d（头转向/头点头）；眼/眉/口/发各挂对应 1D warp；
 * - 自动绘制顺序（语义先验×10 + 出现序号）；body → 呼吸 deformer；发丝 → 摆锤物理（输出参数驱动 sway warp）；
 * - 纹理部件内嵌 atlas（键 = 部件 id）。
 */
export function rigCharacter(spec: RigCharacterSpec): RigResult {
  const canvas = spec.canvas ?? { width: 512, height: 1024 };
  const physics = spec.physics !== false;
  const breathing = spec.breathing !== false;

  // B-7：自定义模板合并查找（custom 优先；RIG_TEMPLATES 为内置兜底）
  const customT = spec.customTemplates ?? {};
  const isCustom = (sem: string): boolean => Object.prototype.hasOwnProperty.call(customT, sem);
  const templateOf = (sem: string): RigTemplateLike =>
    customT[sem] ?? (RIG_TEMPLATES[sem as RigTemplateSemantic] as unknown as RigTemplateLike);

  // 输入防御：语义已知（内置 ∪ 自定义）+ id 唯一
  const seen = new Set<string>();
  for (const p of spec.parts) {
    if (!isCustom(p.semantic) && !(p.semantic in RIG_TEMPLATES)) throw new Error(`未知语义部件: ${p.semantic}`);
    if (seen.has(p.id)) throw new Error(`部件 id 重复: ${p.id}`);
    seen.add(p.id);
  }

  const hinge = spec.hinge ?? defaultHinge(spec.parts, canvas);
  const hasBody = spec.parts.some((p) => p.semantic === "body_upper");
  const hasHair = spec.parts.some((p) => p.semantic === "hair_front" || p.semantic === "hair_side" || p.semantic === "hair_back");

  // 1) 参数面（派生，最小闭合）
  const parameters = deriveParameters(spec.parts, { physics });

  // 2) 部件（网格 + 形变合成 + 顺序）
  const parts: L2dmPart[] = [];
  const rigParts: RigSpec["parts"] = [];
  spec.parts.forEach((p, index) => {
    const tpl = templateOf(p.semantic);
    const grid = makeGrid(tpl.grid[0], tpl.grid[1], p.bbox);
    const mesh: L2dmMesh = toL2dmMesh(grid);
    const bindings: RigBinding[] = [];
    const warps1d: NonNullable<L2dmMesh["warps"]> = [];
    const warps2d: NonNullable<L2dmMesh["warp2d"]> = [];

    // 头簇 → warp2d（头转向/头点头）
    if (tpl.headCluster) {
      warps2d.push(headTurnWarp2D(grid, hinge));
      bindings.push({ param: "头转向", kind: "warp2d" }, { param: "头点头", kind: "warp2d" });
    }
    // 语义专属 1D warp
    switch (p.semantic) {
      case "eye": {
        const param = p.side === "right" ? "眼闭右" : "眼闭左";
        warps1d.push(warp1D(param, [0, 1], (v) => eyeLidOffsets(grid, v)));
        bindings.push({ param, kind: "warp1d" });
        break;
      }
      case "brow": {
        const param = p.side === "right" ? "眉右升" : "眉左升";
        warps1d.push(warp1D(param, [-1, 0, 1], (v) => browOffsets(grid, v)));
        bindings.push({ param, kind: "warp1d" });
        break;
      }
      case "mouth": {
        warps1d.push(warp1D("嘴开", [0, 1], (v) => mouthOpenOffsets(grid, v)));
        warps1d.push(warp1D("嘴笑", [0, 1], (v) => mouthSmileOffsets(grid, v)));
        bindings.push({ param: "嘴开", kind: "warp1d" }, { param: "嘴笑", kind: "warp1d" });
        break;
      }
      case "body_lower": {
        warps1d.push(warp1D("身摆", [-1, 0, 1], (v) => bodyLowerSwayOffsets(grid, v)));
        bindings.push({ param: "身摆", kind: "warp1d" });
        break;
      }
      case "arm_a":
      case "arm_b": {
        const param = p.semantic === "arm_b" ? "臂右摆" : "臂左摆";
        // 复用 臂摆 参数，区分左右：arm_a/arm_b 用一侧符号
        warps1d.push(warp1D("臂摆", [-1, 0, 1], (v) => limbSwayOffsets(grid, p.side === "right" ? -v : v)));
        bindings.push({ param: "臂摆", kind: "warp1d" });
        void param;
        break;
      }
      case "leg": {
        warps1d.push(warp1D("腿摆", [-1, 0, 1], (v) => limbSwayOffsets(grid, p.side === "right" ? -v : v)));
        bindings.push({ param: "腿摆", kind: "warp1d" });
        break;
      }
      case "adult_breast": {
        // 胸摆动：摆锤输出 胸摆 消费（见 §4 pendulums）
        warps1d.push(warp1D("胸摆", [-1, 0, 1], (v) => limbSwayOffsets(grid, v, 8)));
        bindings.push({ param: "胸摆", kind: "pendulum-out" });
        break;
      }
      case "adult_genital": {
        // 内容分级部件：不挂默认形变，仅静态（可见性由 ContentPolicy/opacity 控制）
        break;
      }
      case "tail": {
        warps1d.push(warp1D("尾巴摆", [0, 1], (v) => tailSwayOffsets(grid, v)));
        bindings.push({ param: "尾巴摆", kind: "warp1d" });
        break;
      }
      case "wing": {
        warps1d.push(warp1D("翅膀扇", [-1, 1], (v) => wingFlapOffsets(grid, v)));
        bindings.push({ param: "翅膀扇", kind: "warp1d" });
        break;
      }
      case "ear_beast": {
        warps1d.push(warp1D("耳朵动", [-1, 0, 1], (v) => earTwitchOffsets(grid, v)));
        bindings.push({ param: "耳朵动", kind: "warp1d" });
        break;
      }
      case "hoho": {
        // 脸颊：脸红参数 → opacity 显隐（引擎 Part.opacityParam）
        break;
      }
      case "feet": {
        // 静态（无形变）；着地由画布摆放保证
        break;
      }
      default:
        if (p.semantic === "hair_front" || p.semantic === "hair_side" || p.semantic === "hair_back") {
          // 头转直驱跟随（必选：肉眼可见的发丝滞后）；物理摆锤输出（可选：叠加微小延迟）
          warps1d.push(warp1D("头转向", [-30, 0, 30], (v) => hairHeadFollowOffsets(grid, v)));
          bindings.push({ param: "头转向", kind: "warp1d" });
          if (physics) {
            warps1d.push(warp1D("发摆", [-1, 0, 1], (v) => hairSwayOffsets(grid, v)));
            bindings.push({ param: "发摆", kind: "warp1d" });
          }
        }
    }

    // B-7：自定义语义 drive 挂接——调用方在部件 customParams 里声明 drive.id 参数后，自动挂摆动 warp
    const driveId = (tpl as { drive?: { id: string } }).drive?.id;
    if (driveId !== undefined && !bindings.some((b) => b.param === driveId)) {
      warps1d.push(warp1D(driveId, [-1, 0, 1], (v) => limbSwayOffsets(grid, v)));
      bindings.push({ param: driveId, kind: "warp1d" });
    }

    mesh.warps = warps1d.length > 0 ? warps1d : undefined;
    mesh.warp2d = warps2d.length > 0 ? warps2d : undefined;

    const order = p.order ?? tpl.order * 10 + index;
    const color = p.color ?? tpl.color;
    // B-3：服装部件 → 随服装组可见性参数显隐（opacityParam = 衣装组<N>）
    const costumeGroup = tpl.clothing === true
      ? ((p as { costumeGroup?: number }).costumeGroup ?? 1)
      : undefined;
    const part: L2dmPart = {
      id: p.id,
      order,
      color,
      mesh,
      ...(p.image ? { texture: p.id } : {}),
      // B-1：脸颊随「脸红」参数显隐（0 → 透明，>0 渐显；引擎 opacityParam 驱动）
      ...(p.semantic === "hoho" ? { opacityParam: "脸红" } : {}),
      // B-3：服装部件随 衣装组<N> 参数显隐（outfit op 置 1 即换装）
      ...(costumeGroup !== undefined ? { opacityParam: costumeParamOf(costumeGroup) } : {}),
      // B-6：成人分级部件默认隐藏（opacityParam=分级隐藏，def=0）；ContentPolicy 判定后置 1 才可见
      ...(tpl.adult === true ? { opacityParam: "分级隐藏" } : {}),
      ...(hasBody && breathing && p.semantic === "body_upper" ? { parent: "body_breathe" } : {}),
    };
    parts.push(part);
    rigParts.push({
      id: p.id,
      semantic: p.semantic,
      order,
      color,
      ...(p.image ? { texture: p.id } : {}),
      ...(costumeGroup !== undefined ? { costumeGroup } : {}),
      bindings,
    });
  });

  // 3) 呼吸 deformer（body 绕底中 pivot scaleY）
  const deformers: L2dmDeformer[] = [];
  const rigDeformers: RigSpecDeformer[] = [];
  if (hasBody && breathing) {
    const body = spec.parts.find((p) => p.semantic === "body_upper")!;
    const pivot = { x: body.bbox.x + body.bbox.width / 2, y: body.bbox.y + body.bbox.height };
    const d: L2dmDeformer = {
      id: "body_breathe",
      pivot,
      bindings: [{ parameter: "呼吸", channel: "scaleY", from: 0, to: 0.06 }],
    };
    deformers.push(d);
    rigDeformers.push({
      id: d.id,
      parent: d.parent,
      pivot,
      bindings: [{ parameter: "呼吸", channel: "scaleY", from: 0, to: 0.06 }],
    });
  }

  // 4) 物理（摆锤输出参数，warp 消费）
  let pendulums: RigSpecPendulum[] | null = null;
  const hasBreast = spec.parts.some((p) => p.semantic === "adult_breast");
  const list: RigSpecPendulum[] = [];
  if (physics && hasHair) {
    list.push({ id: "hair-sway", input: "头转向", outputParams: ["发摆"], delay: 0.8, acceleration: 0.5 });
  }
  if (physics && hasBreast) {
    // B-2：胸摆动（输入 呼吸 → 输出 胸摆；摆锤惯性模拟胸部跟随呼吸的迟缓摆动）
    list.push({ id: "breast-sway", input: "呼吸", outputParams: ["胸摆"], delay: 1.2, acceleration: 0.4 });
  }
  if (list.length > 0) pendulums = list;

  // 5) 组装 .l2dm（复用 @l2dp/convert author API）
  const model = createL2dm({
    id: sanitizeId(spec.id),
    canvas,
    parameters,
  });
  model.parts.push(...parts);
  if (deformers.length > 0) model.deformers = deformers;
  if (pendulums) model.physics = { pendulums };

  // 纹理部件 → 内嵌 atlas（键 = part id；data URI 由 author.embedTexture 落账）
  for (const p of spec.parts) {
    if (p.image) {
      const b64 = p.image.dataUri.replace(/^data:image\/[a-z0-9.+-]+;base64,/, "");
      embedTexture(model, p.id, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    }
  }

  // 6) RigSpec（审计）
  const rigSpec: RigSpec = {
    character: model.id,
    canvas: { width: canvas.width, height: canvas.height },
    hinge,
    parameters: parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def, group: p.group })),
    parts: rigParts,
    deformers: rigDeformers,
    physics: pendulums,
    pose: null,
    // B-3：服装组审计（outfit 换装依据）
    costumes: collectCostumeGroups(spec.parts).map((c) => ({ group: c.group, param: c.param, partIds: c.partIds })),
    // B-6：成人分级部件审计（默认隐藏；ContentPolicy 由宿主判定）
    adult: spec.parts
      .filter((p) => templateOf(p.semantic).adult === true)
      .map((p) => ({ semantic: p.semantic as string, partIds: [p.id] })),
    notes: [],
  };

  // 7) 质检
  return { model, spec: rigSpec, report: buildReport(model, { hinge }) };
}
// validate.ts —— 创作 IR 校验（规则名与 schema 一致；错误结构可直接回注 LLM/修复器）
import { RIG_SEMANTICS } from "@l2dp/rig";
import type { CreationDirective } from "./ir.ts";

export interface CreationIssue {
  rule: string;
  path: string;
  message: string;
}

export function validateCreation(d: CreationDirective): CreationIssue[] {
  const issues: CreationIssue[] = [];
  if (d.v !== 1) issues.push({ rule: "IR_VERSION", path: "v", message: "v 必须为 1" });
  if (typeof d.character !== "string" || d.character.length === 0) {
    issues.push({ rule: "CHARACTER_EMPTY", path: "character", message: "character 必须为非空字符串" });
  }
  const canvas = d.canvas ?? { width: 512, height: 1024 };
  if (!(canvas.width > 0 && canvas.height > 0)) {
    issues.push({ rule: "CANVAS_INVALID", path: "canvas", message: "画布宽高必须为正" });
  }
  if (d.parts.length === 0) issues.push({ rule: "PARTS_EMPTY", path: "parts", message: "至少需要一个部件" });
  const seen = new Set<string>();
  d.parts.forEach((p, i) => {
    const path = "parts[" + i + "]" + (p.id ? " (" + p.id + ")" : "");
    if (typeof p.id !== "string" || p.id.length === 0) {
      issues.push({ rule: "PART_ID_EMPTY", path, message: "部件 id 必须为非空字符串" });
      return;
    }
    if (seen.has(p.id)) issues.push({ rule: "PART_ID_DUP", path, message: "部件 id 重复: " + p.id });
    seen.add(p.id);
    if (!(RIG_SEMANTICS as readonly string[]).includes(p.semantic)) {
      issues.push({ rule: "SEM_NOT_IN_VOCAB", path, message: "语义 '" + p.semantic + "' 不在词表" });
    }
    if (p.side !== undefined && p.side !== "left" && p.side !== "right") {
      issues.push({ rule: "SIDE_INVALID", path, message: "side 必须为 left/right" });
    }
    const b = p.bbox;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !(b.width > 0) || !(b.height > 0)) {
      issues.push({ rule: "BBOX_INVALID", path: path + ".bbox", message: "bbox 宽高必须为正" });
    } else {
      const x2 = b.x + b.width;
      const y2 = b.y + b.height;
      if (b.x < 0 || b.y < 0 || x2 > canvas.width + 60 || y2 > canvas.height + 60) {
        issues.push({ rule: "BBOX_OUT", path: path + ".bbox", message: "bbox 越出画布" });
      }
    }
    if (p.color) {
      const c = p.color;
      if (c.length !== 4 || !c.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
        issues.push({ rule: "COLOR_RANGE", path: path + ".color", message: "color 必须为 4 个 [0,1] 数字" });
      }
    }
    if (!p.image && !p.color) {
      issues.push({ rule: "PART_NO_VIS", path, message: "部件必须有 image 或 color" });
    }
  });
  if (d.hinge) {
    const h = d.hinge;
    if (!(h.x >= 0 && h.x <= canvas.width && h.y >= 0 && h.y <= canvas.height)) {
      issues.push({ rule: "HINGE_OUT", path: "hinge", message: "hinge 应在画布内" });
    }
  }
  for (const [mi, m] of (d.motions ?? []).entries()) {
    const path = "motions/" + (mi + 1);
    if (typeof m.name !== "string" || m.name.length === 0) {
      issues.push({ rule: "MOTION_NAME_EMPTY", path, message: "动作名必须非空" });
    }
    if (!(m.durationMs > 0)) {
      issues.push({ rule: "MOTION_DUR", path, message: "durationMs 必须 > 0" });
    }
    for (const curve of m.curves) {
      let lastT = -Infinity;
      for (const [t, v] of curve.keys) {
        if (!Number.isFinite(t) || !Number.isFinite(v)) {
          issues.push({ rule: "CURVE_KEY_FINITE", path: path + "/" + curve.param, message: "关键帧必须为有限数字" });
        }
        if (t <= lastT) {
          issues.push({ rule: "CURVE_KEY_ORDER", path: path + "/" + curve.param, message: "t 必须严格递增" });
        }
        lastT = t;
      }
    }
  }
  return issues;
}

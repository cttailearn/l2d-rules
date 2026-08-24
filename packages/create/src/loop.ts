// loop.ts —— 创作自修复循环（P4b）：切图 → 标注 → 指令 → 校验/修复 → 执行 → 审核
// 确定性默认链路（ColorKeySegmenter + Position/ColorMap Labeler + RuleRepairer + RuleReviewer）；
// 每步均为可注入接口——LLM 可替换 Segmenter/Labeler/Repairer/Reviewer，宿主零改核心。
import { ColorKeySegmenter, finalizeCutout, type CutoutPart, type Labeler, type RgbaImage, type Segmenter } from "@l2dp/cutout";
import { validateCreation, type CreationIssue } from "./validate.ts";
import { executeCreation, type CreationResult } from "./execute.ts";
import { RuleReviewer, type RigReviewer } from "./review.ts";
import type { CreationDirective, CreationPart, MotionKind } from "./ir.ts";

export interface RepairResult {
  directive: CreationDirective;
  fixes: string[];
}

export interface Repairer {
  repair(d: CreationDirective, issues: CreationIssue[]): RepairResult;
  readonly name: string;
}

/** 确定性修复器：钳 bbox 入画布/最小尺寸、去重 id、滤微小部件、清非法关键帧。 */
export class RuleRepairer implements Repairer {
  readonly name = "rules";
  repair(d: CreationDirective, _issues: CreationIssue[]): RepairResult {
    const fixes: string[] = [];
    const canvas = d.canvas ?? { width: 512, height: 1024 };
    const parts = [...d.parts];
    // 滤微部件
    const kept: CreationPart[] = [];
    for (const p of parts) {
      if (p.bbox.width < 3 || p.bbox.height < 3) {
        fixes.push("丢弃过小部件 " + p.id);
        continue;
      }
      const b = p.bbox;
      const x = Math.max(0, Math.round(b.x));
      const y = Math.max(0, Math.round(b.y));
      const w = Math.min(canvas.width - x, Math.round(b.width));
      const h = Math.min(canvas.height - y, Math.round(b.height));
      if (w < 1 || h < 1) {
        fixes.push("丢弃越界部件 " + p.id);
        continue;
      }
      kept.push({ ...p, bbox: { x, y, width: w, height: h } });
    }
    // 去重 id
    const seenC = new Map<string, number>();
    const dedup: CreationPart[] = [];
    for (const p of kept) {
      const n = seenC.get(p.id) ?? 0;
      seenC.set(p.id, n + 1);
      const id = n === 0 ? p.id : p.id + "-" + n;
      if (id !== p.id) fixes.push("重命名重复部件 " + p.id + " → " + id);
      dedup.push({ ...p, id });
    }
    // 清非法关键帧（t 递增 + 有限）
    const motions = (d.motions ?? []).map((m) => {
      const curves = m.curves.map((c) => {
        const keys: [number, number][] = [];
        let last = -Infinity;
        for (const [t, v] of c.keys) {
          if (!Number.isFinite(t) || !Number.isFinite(v)) { fixes.push("丢弃非法关键帧"); continue; }
          if (t <= last) { fixes.push("关键帧 t 未递增（丢弃 " + t + "）"); continue; }
          keys.push([t, v]);
          last = t;
        }
        if (keys.length === 0) keys.push([0, 0]);
        return { param: c.param, keys };
      });
      return { ...m, curves };
    });
    return { directive: { ...d, parts: dedup, motions }, fixes };
  }
}

/** 创作输入（切图阶段） */
export interface CreateInput {
  character: string;
  image: RgbaImage;
  canvas?: { width: number; height: number };
  hinge?: { x: number; y: number };
  physics?: boolean;
  breathing?: boolean;
  motionKinds?: MotionKind[];
  segmenter?: Segmenter;
  labeler?: Labeler;
  repairer?: Repairer;
  reviewer?: RigReviewer | null;
  maxRounds?: number;
}

export interface CreateOutcome {
  ok: boolean;
  rounds: number;
  log: string[];
  directive: CreationDirective;
  cutout: { parts: CutoutPart[]; coveragePct: number; overlapPct: number; issues: string[] };
  result?: CreationResult;
  issues: string[];
}

/** 半自动切图 + 自修复直出可驱动模型的全链入口。 */
export async function createWithSelfRepair(input: CreateInput): Promise<CreateOutcome> {
  const maxRounds = input.maxRounds ?? 3;
  const log: string[] = [];
  const canvas = input.canvas ?? { width: input.image.width, height: input.image.height };
  const segmenter = input.segmenter ?? new ColorKeySegmenter({ tol: 12, minArea: 60 });
  const labeler = input.labeler ?? (await (async () => { throw new Error("需要 Labeler（LLM 注入或 PositionLabeler/ColorMapLabeler）") })());
  const repairer = input.repairer ?? new RuleRepairer();

  log.push("切图器: " + segmenter.name + " / 标注器: " + labeler.name);
  const candidates = await segmenter.segment(input.image);
  log.push("候选选区: " + candidates.length + " 个");
  const parts = await labeler.label(candidates, input.image);
  const cutout = finalizeCutout(input.image, parts);
  log.push("标注产出: " + parts.length + " 件；覆盖率 " + cutout.coveragePct + "% / 重叠 " + cutout.overlapPct + "%");

  let directive: CreationDirective = {
    v: 1,
    character: input.character,
    canvas,
    parts: parts.map((p: CutoutPart) => ({
      id: p.id,
      semantic: p.semantic as CreationPart["semantic"],
      side: p.side,
      bbox: p.bbox,
      image: { dataUri: p.image.dataUri },
    })),
    ...(input.hinge ? { hinge: input.hinge } : {}),
    ...(input.physics !== undefined ? { physics: input.physics } : {}),
    ...(input.breathing !== undefined ? { breathing: input.breathing } : {}),
    motions: undefined,
  };

  let rounds = 0;
  while (rounds < maxRounds) {
    rounds++;
    const issues = validateCreation(directive);
    if (issues.length > 0) {
      log.push("第 " + rounds + " 轮校验:" + issues.map((i) => i.rule).join(","));
      const repaired = repairer.repair(directive, issues);
      if (repaired.fixes.length === 0) {
        log.push("修复器无进展 → 终止");
        return { ok: false, rounds, log, directive, cutout, issues: issues.map((i) => i.rule + ":" + i.message) };
      }
      for (const f of repaired.fixes) log.push("修复: " + f);
      directive = repaired.directive;
      continue;
    }
    // 校验通过 → 执行
    const result = executeCreation(directive);
    log.push("第 " + rounds + " 轮执行：rig " + (result.rig.report.ok ? "通过" : "失败"));
    if (!result.rig.report.ok) {
      const msgs = result.rig.report.validation.issues.map((i) => i.message);
      log.push("rig 报告:" + msgs.slice(0, 5).join(","));
      const repaired = repairer.repair(directive, msgs.map((m) => ({ rule: "RIG", path: "", message: m })));
      if (repaired.fixes.length === 0 || rounds >= maxRounds) {
        return { ok: false, rounds, log, directive, cutout, issues: msgs, result };
      }
      directive = repaired.directive;
      continue;
    }
    // 审核（可选）
    if (input.reviewer !== null && input.reviewer !== undefined) {
      const verdict = await input.reviewer.review(result.model);
      log.push("审核(" + input.reviewer.name + "): " + (verdict.ok ? "通过" : "未过 → " + verdict.issues.join(",")));
      if (!verdict.ok) {
        if (rounds >= maxRounds) {
          return { ok: false, rounds, log, directive, cutout, issues: verdict.issues, result };
        }
        const repaired = repairer.repair(directive, verdict.issues.map((m) => ({ rule: "REVIEW", path: "", message: m })));
        if (repaired.fixes.length === 0) {
          return { ok: false, rounds, log, directive, cutout, issues: verdict.issues, result };
        }
        for (const f of repaired.fixes) log.push("修复: " + f);
        directive = repaired.directive;
        continue;
      }
    }
    return { ok: true, rounds, log, directive, cutout, result, issues: [] };
  }
  return { ok: false, rounds, log, directive, cutout, issues: ["达到最大轮数 " + maxRounds] };
}

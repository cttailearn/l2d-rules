// report.ts —— 质检报告（P4a；SPEC-v2.0 §9.4 的 SDK 侧落地）
// ok = engine 结构校验通过（致命）；summary 提供覆盖率等信息性指标（warning 不否决）。
import { validateL2dmModel } from "@l2dp/engine";
import type { L2dmModel } from "@l2dp/engine";

export interface RigCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface RigReport {
  ok: boolean;
  checks: RigCheck[];
  validation: { ok: boolean; issues: { path: string; message: string }[] };
  summary: {
    partCount: number;
    paramCount: number;
    warp1dCount: number;
    warp2dCount: number;
    deformerCount: number;
    pendulumCount: number;
    canvasArea: number;
    usedArea: number;
    coveragePct: number;
  };
}

const SAMPLE_W = 64;
const SAMPLE_H = 64;

/** 用粗网格统计部件网格顶点的外包包围盒覆盖度（近似；仅信息性指标）。 */
function coverageSim(model: L2dmModel): { usedArea: number; coveragePct: number } {
  const w = Math.max(1, model.canvas.width);
  const h = Math.max(1, model.canvas.height);
  const map = new Uint8Array(SAMPLE_W * SAMPLE_H);
  for (const part of model.parts) {
    const m = part.mesh;
    if (!m || m.vertices.length === 0) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < m.vertices.length; i += 2) {
      const x = m.vertices[i]!;
      const y = m.vertices[i + 1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (minX > maxX || minY > maxY) continue;
    const c0 = Math.max(0, Math.floor((minX / w) * SAMPLE_W));
    const c1 = Math.min(SAMPLE_W - 1, Math.ceil((maxX / w) * SAMPLE_W));
    const r0 = Math.max(0, Math.floor((minY / h) * SAMPLE_H));
    const r1 = Math.min(SAMPLE_H - 1, Math.ceil((maxY / h) * SAMPLE_H));
    for (let cc = c0; cc <= c1; cc++) for (let rr = r0; rr <= r1; rr++) map[rr * SAMPLE_W + cc] = 1;
  }
  let covered = 0;
  for (let i = 0; i < SAMPLE_W * SAMPLE_H; i++) if (map[i] !== 0) covered++;
  const ratio = covered / (SAMPLE_W * SAMPLE_H);
  return { usedArea: ratio * w * h, coveragePct: ratio * 100 };
}

export function buildReport(model: L2dmModel, _opts: { hinge?: { x: number; y: number } } = {}): RigReport {
  const validation = validateL2dmModel(model);
  const checks: RigCheck[] = [
    {
      name: "engine_validate",
      ok: validation.ok,
      detail: validation.ok
        ? "engine validateL2dmModel 通过"
        : validation.issues.slice(0, 8).map((i) => `${i.path}: ${i.message}`).join("；"),
    },
    ...(!validation.ok
      ? validation.issues.map((i) => ({ name: "rig:" + i.path || "rig", ok: false, detail: i.message }))
      : []),
  ];
  let warp1dCount = 0;
  let warp2dCount = 0;
  for (const part of model.parts) {
    if (!part.mesh) continue;
    warp1dCount += part.mesh.warps?.length ?? 0;
    warp2dCount += part.mesh.warp2d?.length ?? 0;
  }
  const cov = coverageSim(model);
  return {
    ok: validation.ok && checks.every((c) => c.ok),
    checks,
    validation,
    summary: {
      partCount: model.parts.length,
      paramCount: model.parameters.length,
      warp1dCount,
      warp2dCount,
      deformerCount: model.deformers?.length ?? 0,
      pendulumCount: model.physics?.pendulums?.length ?? 0,
      canvasArea: model.canvas.width * model.canvas.height,
      usedArea: Math.round(cov.usedArea),
      coveragePct: Math.round(cov.coveragePct * 10) / 10,
    },
  };
}

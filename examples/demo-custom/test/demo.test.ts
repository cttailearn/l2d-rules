// demo-custom（B-7）自动化断言：运行时自定义语义注入 + 创作路径服装/自定义语义
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { rigCharacter, type RigTemplateLike } from "@l2dp/rig";
import { executeCreation } from "@l2dp/create";

const customTemplates: Record<string, RigTemplateLike> = {
  cape: { zh: "披风", order: 21, headCluster: false, color: [0.65, 0.38, 0.78, 1], grid: [3, 6], drive: { id: "披风飘" } },
  halo: { zh: "光环", order: 23, headCluster: true, color: [0.98, 0.85, 0.4, 1], grid: [4, 2] },
};
const canvas = { width: 400, height: 600 };

test("B-7 demo: customTemplates 注入的语义入模、可渲染、drive 可驱动", () => {
  const rig = rigCharacter({
    id: "c", canvas,
    parts: [
      { id: "face", semantic: "face", bbox: { x: 120, y: 150, width: 160, height: 130 } },
      { id: "cape", semantic: "cape", bbox: { x: 20, y: 260, width: 50, height: 260 }, customParams: { 披风飘: { min: -1, max: 1, def: 0, group: "Custom" } } },
      { id: "halo", semantic: "halo", bbox: { x: 160, y: 100, width: 70, height: 30 } },
    ],
    customTemplates,
  });
  assert.equal(rig.report.ok, true);
  assert.ok(rig.model.parts.some((p) => p.id === "cape"), "cape 入模");
  assert.ok(rig.model.parameters.some((p) => p.id === "披风飘"), "drive 参数派生");
  // 渲染非空 + drive 可见
  const sw = new SoftwareRenderer();
  const h = (set: Record<string, number>) => {
    const pl = new L2dmPlayer(rig.model, new Map());
    pl.params.reset(); for (const [k, v] of Object.entries(set)) pl.params.set(k, v);
    pl.render(sw);
    return createHash("sha256").update(sw.readPixels()!).digest("hex");
  };
  assert.notEqual(h({}), h({ 披风飘: 1 }), "自定义语义 drive 可见变化");
});

test("B-7 demo: 创作路径——自定义语义 + 服装语义经 executeCreation 全链", () => {
  const r = executeCreation({
    v: 1, character: "c2", canvas,
    parts: [
      { id: "body", semantic: "body_upper", side: "left", bbox: { x: 60, y: 260, width: 280, height: 240 }, color: [0.5, 0.6, 0.9, 1] },
      { id: "cape", semantic: "cape", side: "left", bbox: { x: 20, y: 270, width: 50, height: 240 }, color: [0.65, 0.38, 0.78, 1], customParams: { 披风飘: { min: -1, max: 1, def: 0, group: "Custom" } } },
      { id: "dress", semantic: "outfit_dress", side: "left", bbox: { x: 60, y: 270, width: 280, height: 220 }, color: [0.9, 0.4, 0.6, 1] },
    ],
    customTemplates,
    motions: [],
  });
  assert.ok(r.model.parts.some((p) => p.id === "cape"), "创作路径自定义语义入模");
  assert.ok(r.model.parts.some((p) => p.id === "dress"), "创作路径服装语义入模");
  assert.equal(r.model.parts.find((p) => p.id === "dress")!.opacityParam, "衣装组1", "服装部件随服饰组显隐");
  assert.ok(r.rig.report.ok, "rig 校验通过");
});
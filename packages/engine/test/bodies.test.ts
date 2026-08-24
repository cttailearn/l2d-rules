// bodies.test.ts（B-5）：引擎多部位（40+）回归——任意部件数/自定义语义参数加载/驱动/渲染
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  L2DM_FORMAT_VERSION,
  validateL2dmModel,
  loadL2dmObject,
  L2dmPlayer,
  SoftwareRenderer,
  type L2dmModel,
  type EngineMotion,
} from "../src/index.ts";

function makeManyPartsModel(count = 40): L2dmModel {
  const cols = 8;
  const cell = 8;
  const C = 30;
  const quad = (i: number) => {
    const row = Math.floor(i / cols);
    const c = i % cols;
    const x0 = c * cell, y0 = row * cell, x1 = x0 + cell - 1, y1 = y0 + cell - 1;
    return { vertices: [x0, y0, x1, y0, x1, y1, x0, y1], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] };
  };
  const z = (n: number) => new Array(n).fill(0);
  const parameters = Array.from({ length: count }, (_, i) => ({ id: "p" + i + "_sway", min: 0, max: 1, def: 0, group: "Custom" as const }));
  const parts = Array.from({ length: count }, (_, i) => ({
    id: "part" + i, order: i, color: [i / count, (count - i) / count, 0.5, 1] as [number, number, number, number],
    mesh: {
      ...quad(i),
      warps: [{ parameter: "p" + i + "_sway", keyforms: [{ value: 0, offsets: z(8) }, { value: 1, offsets: [0, 3, 0, 3, 0, 3, 0, 3] }] }],
    },
  }));
  return { formatVersion: L2DM_FORMAT_VERSION, id: "many", canvas: { width: C * 2, height: C * 2 }, parameters, parts };
}

function loadValidModel(): L2dmModel {
  const lr = loadL2dmObject(makeManyPartsModel(40));
  if (!lr.ok) throw new Error(lr.error);
  return lr.model;
}

test("B-5: 40 部件模型通过引擎校验（引用完整/参数面/几何）", () => {
  const model = makeManyPartsModel(40);
  const v = validateL2dmModel(model);
  assert.equal(v.ok, true, JSON.stringify(v.issues.slice(0, 5)));
  assert.equal(model.parts.length, 40);
  assert.equal(model.parameters.length, 40);
});

test("B-5: 40 部件模型可加载并渲染（无头软件光栅）", () => {
  const model = loadValidModel();
  const sw = new SoftwareRenderer();
  const player = new L2dmPlayer(model, new Map());
  player.render(sw);
  const px = sw.readPixels()!;
  let opaque = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) opaque++;
  assert.ok(opaque > 500, "多部件渲染应产生大量不透明像素（得 " + opaque + "）");
});

test("B-5: 多部件参数驱动像素 + 确定性（同参同哈希）", () => {
  const model = loadValidModel();
  const render = (driveP0: boolean) => {
    const sw = new SoftwareRenderer();
    const player = new L2dmPlayer(model, new Map());
    player.params.reset();
    if (driveP0) player.params.set("p0_sway", 1);
    player.render(sw);
    return createHash("sha256").update(sw.readPixels()!).digest("hex");
  };
  const rest = render(false);
  const driven = render(true);
  const driven2 = render(true);
  assert.notEqual(rest, driven, "驱动 p0_sway 应改变像素");
  assert.equal(driven, driven2, "确定性：同驱动同像素");
});

test("B-5: 播放动作驱动多部件（EngineMotion 覆盖 10 参数）", () => {
  const model = loadValidModel();
  const motion: EngineMotion = {
    durationMs: 800, loop: false,
    curves: Array.from({ length: 10 }, (_, i) => ({ id: "p" + i + "_sway", segments: [0, 0, 0, 1, 1] })),
  };
  const player = new L2dmPlayer(model, new Map());
  player.play(motion);
  player.tick(400);
  assert.ok(Math.abs(player.params.get("p5_sway")! - 0.4) < 1e-3, "动作驱动 p5_sway≈0.4（t=400/1000）");
  const sw = new SoftwareRenderer();
  player.render(sw);
  assert.ok(sw.readPixels()!.length > 0);
});
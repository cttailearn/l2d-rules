import { test } from "node:test";
import assert from "node:assert/strict";
import { ParamSet } from "../src/index.ts";
import { registerDeformers, deformMesh, normalizeParam, type WeightedMesh, type DeformerDef } from "../src/index.ts";
import { buildRenderList, type RenderPart } from "../src/index.ts";
import { sampleMotion, parseSegments, type MotionDef } from "../src/index.ts";
import { PendulumSim, type PendulumDef } from "../src/index.ts";
import { SoftwareCanvas } from "../src/index.ts";
import { renderModel, type RenderModel } from "../src/index.ts";

test("参数求值管线：表情 Add/Overwrite + 物理 + override 优先级", () => {
  const ps = new ParamSet([{ id: "PARAM_MOUTH_OPEN_Y", min: 0, max: 1, def: 0 }, { id: "PARAM_ANGLE_X", min: -30, max: 30, def: 0 }]);
  ps.setMotion("PARAM_MOUTH_OPEN_Y", 0.2);
  ps.applyExpression({ name: "smile", values: [{ id: "PARAM_MOUTH_OPEN_Y", value: 0.3, blend: "Add" }] });
  assert.equal(ps.final("PARAM_MOUTH_OPEN_Y"), 0.5, "动作+表情 Add");
  ps.setOverride("PARAM_MOUTH_OPEN_Y", 0.1);
  assert.equal(ps.final("PARAM_MOUTH_OPEN_Y"), 0.1, "override 最高");
  ps.setPhysicsOut("PARAM_ANGLE_X", 5);
  assert.equal(ps.final("PARAM_ANGLE_X"), 5, "物理输出生效");
  ps.setOverride("PARAM_ANGLE_X", 9);
  assert.equal(ps.final("PARAM_ANGLE_X"), 9, "override 覆盖物理");
});

test("ArtMesh 形变：归一化 + 线性曲线 + 权重", () => {
  const defs: DeformerDef[] = [{
    id: "d1", type: "warp", target: "m0",
    controlPoints: [{ source: { x: 0, y: 0 }, destination: { x: 0, y: 10 } }],
    normalization: { paramId: "PARAM_ANGLE_X", min: -30, def: 0, max: 30 },
    curve: "linear",
  }];
  registerDeformers(defs);
  const mesh: WeightedMesh = { id: "m0", vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }], weights: [{ deformerId: "d1", values: [1, 0.5] }] };
  const out = deformMesh(mesh, { PARAM_ANGLE_X: 30 });
  assert.equal(out[0].y, 10, "满权重满幅度");
  assert.equal(out[1].y, 5, "半权重");
  assert.equal(normalizeParam(0, { min: -30, def: 0, max: 30 }), 0);
  assert.equal(normalizeParam(-15, { min: -30, def: 0, max: 30 }), -0.5, "负侧有符号");
});

test("场景排序与服装组切换", () => {
  const parts: RenderPart[] = [
    { id: "a", drawOrder: 3, opacity: 1, blendMode: "normal", visible: true, category: "body", costumeGroup: null, texturePage: 0, meshId: null },
    { id: "b", drawOrder: 1, opacity: 0.5, blendMode: "normal", visible: true, category: "clothing", costumeGroup: 1, texturePage: 0, meshId: null },
    { id: "c", drawOrder: 2, opacity: 1, blendMode: "normal", visible: false, category: "body", costumeGroup: null, texturePage: 0, meshId: null },
    { id: "d", drawOrder: 0, opacity: 1, blendMode: "normal", visible: true, category: "clothing", costumeGroup: 2, texturePage: 0, meshId: null },
  ];
  const list1 = buildRenderList(parts, { activeCostumeGroup: 1 });
  assert.deepEqual(list1.map(p => p.id), ["b", "a"], "组1显示+按 drawOrder");
  const listAll = buildRenderList(parts, { activeCostumeGroup: null });
  assert.deepEqual(listAll.map(p => p.id), ["d", "b", "a"], "编辑态全部显示");
});

test("motion3 曲线解析与采样（官方点对格式）", () => {
  // [x0=0, y0=0, type0(线性), x1=1, y1=10, type0, x2=2, y2=20]
  const { startValue, segs } = parseSegments([0, 0, 0, 1, 10, 0, 2, 20]);
  assert.equal(startValue, 0);
  assert.equal(segs.length, 2);
  const motion: MotionDef = { meta: { duration: 2, fps: 30, loop: true }, curves: [{ target: "Parameter", id: "PARAM_ANGLE_X", segments: [0, 0, 0, 1, 10, 0, 2, 20] }] };
  assert.equal(sampleMotion(motion, 0).PARAM_ANGLE_X, 0);
  assert.equal(sampleMotion(motion, 1000).PARAM_ANGLE_X, 10, "t=1s 线性中点");
  const noLoop: MotionDef = { meta: { duration: 2, fps: 30, loop: false }, curves: [{ target: "Parameter", id: "PARAM_ANGLE_X", segments: [0, 0, 0, 1, 10, 0, 2, 20] }] };
  assert.equal(sampleMotion(noLoop, 2000).PARAM_ANGLE_X, 20, "t=2s 末点（非循环）");
  // 贝塞尔段：从 (0,0) 三次到 (1,1)，控制 (0.333,0)(0.666,0)
  const bm: MotionDef = { meta: { duration: 1, fps: 30, loop: true }, curves: [{ target: "Parameter", id: "P", segments: [0, 0, 1, 0.333, 0, 0.666, 0, 1, 1] }] };
  const mid = sampleMotion(bm, 500).P;
  assert.ok(mid > 0.05 && mid < 0.5, "贝塞尔中点 0<v<0.5: " + mid);
});

test("physics3 摆锤收敛", () => {
  const def: PendulumDef = {
    id: "p1",
    input: [{ sourceParamId: "PARAM_ANGLE_X", weight: 100, type: "X", reflect: false }],
    output: [{ destinationParamId: "PARAM_HAIR_FRONT", vertexIndex: 1, scale: 2, weight: 100, type: "Angle", reflect: false }],
    vertices: [{ mobility: 1, delay: 0.9, acceleration: 1, radius: 5 }],
    normalization: { position: { min: -10, def: 0, max: 10 }, angle: { min: -10, def: 0, max: 10 } },
  };
  const sim = new PendulumSim([def], 16);
  let last = 0;
  for (let i = 0; i < 120; i++) { const o = sim.step({ PARAM_ANGLE_X: 10 }); last = o.PARAM_HAIR_FRONT ?? 0; }
  assert.ok(Math.abs(last) > 0.5, "驱动生效");
});

test("软件光栅化：三角形填充 + 像素", () => {
  const cv = new SoftwareCanvas(64, 64);
  cv.clear([0, 0, 0, 0]);
  cv.drawTri({ a: [10, 10], b: [54, 10], c: [10, 54], uv: [[0, 0], [0, 0], [0, 0]], tex: null, color: [255, 0, 0, 255] });
  assert.deepEqual(cv.pixel(20, 20), [255, 0, 0, 255]);
  assert.deepEqual(cv.pixel(5, 5), [0, 0, 0, 0]);
  assert.ok(cv.countNonTransparent() > 100, "填充面积足够");
});

test("模型级渲染：形变后顶点位移改变输出", () => {
  const meshData = { vertices: [{ x: 100, y: 100, u: 0, v: 0 }, { x: 220, y: 100, u: 1, v: 0 }, { x: 100, y: 220, u: 0, v: 1 }], triangles: [0, 1, 2], weights: [] };
  const model: RenderModel = {
    parts: [{ id: "face", drawOrder: 0, opacity: 1, blendMode: "normal", visible: true, category: "body", costumeGroup: null, texturePage: 0, meshId: "m0" }],
    meshes: new Map([["m0", meshData]]),
    textures: new Map([[0, { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(255) }]]),
    deformers: [],
  };
  const c1 = renderModel(model, {}, { activeCostumeGroup: null, clear: [0, 0, 0, 0], scale: 1, offsetX: 0, offsetY: 0 });
  assert.ok(c1.countNonTransparent() > 100, "渲染出三角形");
});

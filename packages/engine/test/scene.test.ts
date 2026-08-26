import { test } from "node:test";
import assert from "node:assert/strict";
import { L2dmPlayer, SceneStage, SoftwareRenderer, type StageChild } from "../src/index.ts";
import { makeDemoModel } from "./fixtures/demo.ts";

// demo 模型的已知像素（见 fixtures/demo.ts）：
//   face 红 @ (15,13)（模型画布 30x30 内）
const child = (id: string, x: number, y = 0, z = 0): StageChild => ({
  id,
  player: new L2dmPlayer(makeDemoModel(), new Map()),
  x,
  y,
  z,
});

test("P6: SceneStage——背景纯色填充（无子级时透明区=背景）", () => {
  const stage = new SceneStage({ width: 20, height: 20 }, { background: [0, 0, 255, 255] });
  const r = new SoftwareRenderer();
  stage.render(r);
  assert.deepEqual(r.pixel(3, 3), [0, 0, 255, 255], "背景应为蓝");
});

test("P6: SceneStage——多角色世界偏移合成（并排两子级各在各自位置渲染）", () => {
  const stage = new SceneStage({ width: 80, height: 30 });
  stage.setChild(child("A", 0));
  stage.setChild(child("B", 40));
  const r = new SoftwareRenderer();
  stage.render(r);
  // A 的 face @ 模型(15,13) → 舞台(15,13) 红
  assert.deepEqual(r.pixel(15, 13), [255, 0, 0, 255]);
  // B 的 face @ 模型(15,13)+40 → 舞台(55,13) 红
  assert.deepEqual(r.pixel(55, 13), [255, 0, 0, 255]);
  // 两子级之间的空隙透明
  assert.deepEqual(r.pixel(30, 13), [0, 0, 0, 0]);
});

test("P6: SceneStage——相机平移（视心 world x=20 平移两角色）", () => {
  const stage = new SceneStage({ width: 40, height: 30 }, { camera: { x: 20, y: 0, zoom: 1 } });
  stage.setChild(child("A", 0));
  stage.setChild(child("B", 40));
  const r = new SoftwareRenderer();
  stage.render(r);
  // B face 世界 (55,13) - 20 → 舞台 (35,13) 红
  assert.deepEqual(r.pixel(35, 13), [255, 0, 0, 255], "B 左移 20");
  // A face 世界 (15,13) - 20 → 舞台 (-5) 出画布 → 原处为空
  assert.deepEqual(r.pixel(15, 13), [0, 0, 0, 0], "A 移出画布");
});

test("P6: SceneStage——相机缩放（zoom=2：世界坐标缩放后落位）", () => {
  // 画布 60x60；A 无偏移，zoom=2 → face 中心 (15,13)→(30,26)
  const stage = new SceneStage({ width: 60, height: 60 }, { camera: { x: 0, y: 0, zoom: 2 } });
  stage.setChild(child("A", 0));
  const r = new SoftwareRenderer();
  stage.render(r);
  assert.deepEqual(r.pixel(30, 26), [255, 0, 0, 255]);
  // 未缩放处（世界 0..30 映射 0..60 之外不识别的点）可查左下尾部：tail(4,26)→(8,52) 蓝
  assert.deepEqual(r.pixel(8, 52), [0, 0, 255, 255]);
});

test("P6: SceneStage——子级增删与列表", () => {
  const stage = new SceneStage({ width: 10, height: 10 });
  stage.setChild(child("A", 0));
  stage.setChild(child("B", 0));
  assert.deepEqual(stage.childIds(), ["A", "B"]);
  assert.equal(stage.removeChild("A"), true);
  assert.deepEqual(stage.childIds(), ["B"]);
  assert.equal(stage.removeChild("missing"), false);
});

test("P0-2: SceneStage——panTo/zoomTo 缓动确定性插值", () => {
  const stage = new SceneStage({ width: 30, height: 30 });
  stage.panTo(20, 0, 100);
  stage.tick(50);
  const half = stage.currentCamera();
  assert.ok(Math.abs(half.x - 10) < 1e-6, `50ms 半程 x≈10, got ${half.x}`);
  stage.tick(50);
  assert.deepEqual(stage.currentCamera(), { x: 20, y: 0, zoom: 1 }, "100ms 到位");
  stage.zoomTo(2, 200);
  stage.tick(100);
  const z = stage.currentCamera();
  assert.ok(z.zoom > 1 && z.zoom < 2, `zoom 半程, got ${z.zoom}`);
  stage.tick(100);
  assert.deepEqual(stage.currentCamera(), { x: 20, y: 0, zoom: 2 }, "zoom 200ms 到位");
  // setCamera 立即落位并中止动画
  stage.setCamera({ x: 0, y: 0, zoom: 1 });
  assert.deepEqual(stage.currentCamera(), { x: 0, y: 0, zoom: 1 });
});

test("P0-2: SceneStage——相机平移缓动驱动渲染落位", () => {
  const stage = new SceneStage({ width: 30, height: 20 });
  stage.setChild(child("A", 0)); // face 红 @ 模型(15,13)
  const r1 = new SoftwareRenderer();
  stage.render(r1);
  assert.deepEqual(r1.pixel(15, 13), [255, 0, 0, 255], "初始 camera=0,0,1 face@15,13");
  // 相机平移到 x=15 → face 世界 15-15=0 → 舞台 (0,13)
  stage.panTo(15, 0, 120);
  stage.tick(120);
  const r2 = new SoftwareRenderer();
  stage.render(r2);
  assert.deepEqual(r2.pixel(0, 13), [255, 0, 0, 255], "相机右移 15 → face 左移到 x=0");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  L2DM_FORMAT_VERSION,
  loadL2dm,
  ParameterStore,
  SoftwareRenderer,
  L2dmPlayer,
  mulberry32,
  importMotion3,
  importExpression3,
  importManifest,
  applyExpression,
  type EngineMotion,
} from "../src/index.ts";
import { makeDemoModel, DEMO_MOTION } from "./fixtures/demo.ts";

const makeModel = makeDemoModel;
const MOTION = DEMO_MOTION;

test("M4: 播放——motion3 驱动参数（时序采样）", () => {
  const p = new L2dmPlayer(makeModel(), new Map());
  p.play(MOTION);
  p.tick(500);
  assert.ok(Math.abs(p.params.get("微笑") - 1) < 1e-6, `在 500ms 微笑应≈1，${p.params.get("微笑")}`);
  p.tick(250);
  assert.ok(Math.abs(p.params.get("微笑") - 0.5) < 1e-6, `在 750ms 微笑应≈0.5，${p.params.get("微笑")}`);
  // 循环：1000ms 后回到 t=0
  p.tick(250);
  assert.ok(Math.abs(p.params.get("微笑")) < 1e-6, `在 1000ms（循环）微笑应≈0，${p.params.get("微笑")}`);
});

test("M4: 非循环动作播完自动停止", () => {
  const p = new L2dmPlayer(makeModel(), new Map());
  const m: EngineMotion = { ...MOTION, loop: false }; // 时长 1000ms 与段末关键帧一致
  p.play(m);
  p.tick(1500); // 超过时长 → 结束，停在末帧（t=1s 处微笑=0）
  assert.equal(p.playing, false);
  assert.ok(Math.abs(p.params.get("微笑")) < 1e-6, "停在末帧（t=1s 处微笑=0）");
});

test("M4: 参数→像素——形变网格驱动渲染", () => {
  const p = new L2dmPlayer(makeModel(), new Map());
  const r = new SoftwareRenderer();
  // rest 态：face 中心红、tail 中心蓝、hair 中心绿
  p.render(r);
  assert.deepEqual(r.pixel(15, 13), [255, 0, 0, 255]); // face
  assert.deepEqual(r.pixel(4, 26), [0, 0, 255, 255]);  // tail
  assert.deepEqual(r.pixel(23, 5), [0, 255, 0, 255]);  // hair
  // 微笑=1 → face 上移 5px：旧中心变空、新位置变红
  p.params.set("微笑", 1);
  p.render(r);
  assert.deepEqual(r.pixel(15, 13), [0, 0, 0, 0], "旧 face 中心应已空");
  assert.deepEqual(r.pixel(15, 8), [255, 0, 0, 255], "新 face 位置应变红");
  // 尾巴摆=1 → tail 右移 6px
  p.params.set("尾巴摆", 1);
  p.render(r);
  assert.deepEqual(r.pixel(4, 26), [0, 0, 0, 0], "旧 tail 中心应已空");
  assert.deepEqual(r.pixel(10, 26), [0, 0, 255, 255], "新 tail 位置应变蓝");
});

test("M4: 层级→像素——deformer 平移驱动 face", () => {
  const p = new L2dmPlayer(makeModel(), new Map());
  const r = new SoftwareRenderer();
  p.params.set("头转向", 30); // 归一化 1 → x+8
  p.render(r);
  assert.deepEqual(r.pixel(15, 13), [0, 0, 0, 0], "旧 face 中心应空");
  assert.deepEqual(r.pixel(23, 13), [255, 0, 0, 255], "face 右移 8px 后应变红");
});

test("M4: 物理→像素——摆锤收敛驱动 hair", () => {
  const p = new L2dmPlayer(makeModel(), new Map());
  const r = new SoftwareRenderer();
  p.params.set("头转向", 30);
  for (let i = 0; i < 400; i++) p.tick(16);
  // 前发摆 收敛（≈0.625）→ hair 下摆 dy≈2.5
  assert.ok(p.params.get("前发摆") > 0.6, `前发摆应收敛，${p.params.get("前发摆")}`);
  p.render(r);
  assert.deepEqual(r.pixel(23, 9), [0, 255, 0, 255], "hair 下摆后 (23,9) 应变绿");
});

test("M4: 加载 demo.l2dm 文件 → 播放 → 无头录 30 帧像素与 golden 参考一致", () => {
  const text = readFileSync(new URL("./fixtures/demo.l2dm", import.meta.url), "utf8");
  const loaded = loadL2dm(text);
  assert.equal(loaded.ok, true, loaded.ok ? "" : loaded.error);
  if (!loaded.ok) return;

  const p = new L2dmPlayer(loaded.model, new Map());
  p.play(DEMO_MOTION);
  const r = new SoftwareRenderer();
  const hashes: string[] = [];
  for (let i = 0; i < 30; i++) {
    p.tick(33, mulberry32(42));
    p.render(r);
    hashes.push(createHash("sha256").update(r.readPixels()!).digest("hex"));
  }

  // golden 参考：首跑（文件缺失）录制并提交，后续运行逐帧 hash 对比。
  // 任何像素/算法变化 → 对应帧 hash 失配（DoD：无头录 N 帧像素与参考一致）。
  const goldenPath = new URL("./fixtures/demo-golden.json", import.meta.url);
  let golden: string[];
  try {
    golden = JSON.parse(readFileSync(goldenPath, "utf8")).frames;
  } catch {
    writeFileSync(goldenPath, JSON.stringify({ frames: hashes }, null, 2) + "\n");
    golden = hashes;
  }
  assert.equal(hashes.length, golden.length);
  for (let i = 0; i < hashes.length; i++) {
    assert.equal(hashes[i], golden[i], `第 ${i} 帧与 golden 不一致`);
  }
});

test("M4: compat——manifest → 引擎模型骨架（sems→参数/layers→部件/bones→deformer）", () => {
  const m = importManifest({
    formatVersion: 1,
    syntaxVersion: "1.0.0",
    id: "小夏",
    layers: [
      { name: "head", parts: ["face", "ear"], z: 1 },
      { name: "body", parts: ["torso"], z: 0 },
    ],
    bones: [{ name: "headBone", layer: "head" }],
    outfits: [{ name: "校服", group: 0 }],
    sems: [
      { name: "微笑", min: 0, max: 1, params: [] },
      { name: "头转向", min: -30, max: 30, params: [] },
    ],
    assetIndex: { motions: [], expressions: [], behaviors: [] },
  });
  // 参数：sems → L2dmParameter
  assert.deepEqual(
    m.parameters.map((p) => [p.id, p.min, p.max]),
    [["微笑", 0, 1], ["头转向", -30, 30]],
  );
  // 部件：layers 展平，order = 层 z（缺省按层序）
  const parts = [...m.parts].sort((a, b) => a.order - b.order);
  assert.deepEqual(parts.map((p) => p.id), ["torso", "face", "ear"]);
  // deformer：bones
  assert.deepEqual(m.deformers, [{ id: "headBone" }]);
  // 骨架是合法 .l2dm（可过 loader 校验）；无网格部件可进 player 渲染不崩
  assert.equal(loadL2dm(JSON.stringify(m)).ok, true);
  const p = new L2dmPlayer(m, new Map());
  const r = new SoftwareRenderer();
  p.render(r);
  assert.equal(r.countNonTransparent(), 0);
});

test("M4: compat——非语义 motion3 拒绝；语义产物导入", () => {
  // PARAM id 轨道 → 拒绝
  const bad = importMotion3({ meta: { duration: 1, fps: 30, loop: false }, curves: [{ target: "Parameter", id: "PARAM_ANGLE_X", segments: [0, 0, 0, 1, 1] }] });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.error.includes("非语义"), bad.error);
  // 语义产物 → 导入
  const good = importMotion3({ meta: { duration: 1.5, fps: 30, loop: true }, curves: [{ target: "Parameter", id: "微笑", segments: [0, 0, 0, 1, 1] }] });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.durationMs, 1500);
    assert.equal(good.value.curves[0]!.id, "微笑");
  }
});

test("M4: compat——非语义 expression 拒绝；applyExpression 生效", () => {
  const bad = importExpression3({ type: "Live2D Expression", parameters: [{ id: "PARAM_MOUTH_OPEN_Y", value: 1, blend: "Add" }] });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.error.includes("非语义"), bad.error);
  const good = importExpression3({ type: "Live2D Expression", parameters: [{ id: "微笑", value: 0.25, blend: "Add" }] });
  assert.equal(good.ok, true);
  if (good.ok) {
    const ps = new ParameterStore(makeModel().parameters);
    applyExpression(good.value, ps);
    assert.equal(ps.get("微笑"), 0.25); // base 0 + Add 0.25
  }
});

test("M4: 空模型可渲染（无 mesh 部件跳过）", () => {
  const p = new L2dmPlayer({ formatVersion: L2DM_FORMAT_VERSION, id: "空", canvas: { width: 4, height: 4 }, parameters: [], parts: [] }, new Map());
  const r = new SoftwareRenderer();
  p.render(r); // 不应抛错
  assert.equal(r.countNonTransparent(), 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  L2DM_FORMAT_VERSION,
  type L2dmModel,
  ParameterStore,
  SoftwareRenderer,
  L2dmPlayer,
  mulberry32,
  importMotion3,
  importExpression3,
  applyExpression,
  type EngineMotion,
  type RenderMesh,
  type Tex2D,
} from "../src/index.ts";

// ---------- 夹具：demo 模型（canvas 30x30；网格 = 画布像素坐标） ----------
// face：红，父 deformer headDeformer（头转向→x 平移 0..8）
// tail：蓝，warp 尾巴摆→dx+6（上右移）
// hair：绿，warp 前发摆→dy+4（向下摆）
// physics：头转向 → 前发摆
function makeModel(): L2dmModel {
  const quad = (x0: number, y0: number, x1: number, y1: number): { vertices: number[]; uvs: number[]; indices: number[] } => ({
    vertices: [x0, y0, x1, y0, x1, y1, x0, y1],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
  });
  const z = (n: number): number[] => new Array(n).fill(0);
  return {
    formatVersion: L2DM_FORMAT_VERSION,
    id: "demo",
    canvas: { width: 30, height: 30 },
    parameters: [
      { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
      { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
      { id: "尾巴摆", min: 0, max: 1, def: 0, group: "Custom" },
      { id: "前发摆", min: 0, max: 1, def: 0, group: "Physics" },
    ],
    parts: [
      {
        id: "face", order: 1, parent: "headDeformer", color: [1, 0, 0, 1],
        mesh: {
          ...quad(12, 10, 18, 16),
          warps: [
            { parameter: "微笑", keyforms: [{ value: 0, offsets: z(8) }, { value: 1, offsets: [0, -5, 0, -5, 0, -5, 0, -5] }] },
          ],
        },
      },
      {
        id: "tail", order: 2, color: [0, 0, 1, 1],
        mesh: {
          ...quad(0, 22, 8, 30),
          warps: [
            { parameter: "尾巴摆", keyforms: [{ value: 0, offsets: z(8) }, { value: 1, offsets: [6, 0, 6, 0, 6, 0, 6, 0] }] },
          ],
        },
      },
      {
        id: "hair", order: 3, color: [0, 1, 0, 1],
        mesh: {
          ...quad(20, 2, 26, 8),
          warps: [
            { parameter: "前发摆", keyforms: [{ value: 0, offsets: z(8) }, { value: 1, offsets: [0, 4, 0, 4, 0, 4, 0, 4] }] },
          ],
        },
      },
    ],
    deformers: [
      // 对称区间：头转向为 -30..30，默认 0 落在归一化中点 → binding 输出 x = from + (to-from)*0.5
      // 取 [-8, 8] 使 rest（param=0）零位移，±30° 摆动 ±8px（evalBindings 全范围线性映射语义）
      { id: "headDeformer", bindings: [{ parameter: "头转向", channel: "x", from: -8, to: 8 }] },
    ],
    physics: {
      pendulums: [
        { id: "发丝", input: "头转向", outputParams: ["前发摆"], delay: 0.2, acceleration: 0.5 },
      ],
    },
  };
}

// 语义 motion3（官方 Segments 布局：初始点 + 交织段标识符）：微笑/尾巴摆 0→1→0（1s 周期，loop）
const MOTION: EngineMotion = {
  durationMs: 1000,
  loop: true,
  curves: [
    { id: "微笑", segments: [0, 0, 0, 0.5, 1, 0, 1, 0] },
    { id: "尾巴摆", segments: [0, 0, 0, 0.5, 1, 0, 1, 0] },
  ],
};

function frame(out: SoftwareRenderer): Uint8Array {
  return out.readPixels()!;
}

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

test("M4: 确定性——同 (模型, 动作, dt 序列, seed) → 逐帧像素一致", () => {
  const snapshot = (): Uint8Array => {
    const p = new L2dmPlayer(makeModel(), new Map());
    p.play(MOTION);
    const r = new SoftwareRenderer();
    let acc = new Uint8Array(0);
    for (let i = 0; i < 30; i++) {
      p.tick(33, mulberry32(42));
      p.render(r);
      const f = frame(r);
      const next = new Uint8Array(acc.length + f.length);
      next.set(acc);
      next.set(f, acc.length);
      acc = next;
    }
    return acc;
  };
  const a = snapshot();
  const b = snapshot();
  assert.deepEqual(a, b);
  // 且帧非空（有内容）
  let n = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i]! > 0) n++;
  assert.ok(n > 0, "帧应有非透明像素");
  assert.ok(n < a.length / 4, "帧不应全满");
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

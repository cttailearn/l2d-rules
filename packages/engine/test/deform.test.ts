import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ParameterStore,
  applyWarp2D,
  applyWarps,
  accumulateKeyforms,
  accumulateKeyforms2D,
  bindingToMatrix,
  deformerLocalMatrix,
  resolveDeformerMatrices,
  applyAffine,
  type L2dmParameter,
  type L2dmWarp,
  type L2dmWarp2D,
  type L2dmDeformer,
} from "../src/index.ts";

// ---------- 夹具 ----------
const PARAMS: L2dmParameter[] = [
  { id: "微笑", min: 0, max: 1, def: 0 },
  { id: "头转向", min: -30, max: 30, def: 0 },
  { id: "尾巴摆", min: 0, max: 1, def: 0.5 },
];

function paramStore(): ParameterStore {
  return new ParameterStore(PARAMS);
}

const REST = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]); // 4 顶点（xy 对）

// 偏移用 number[]（格式契约；引擎接受 ArrayLike，与 Float32Array 通用）
const Z8 = (): number[] => [0, 0, 0, 0, 0, 0, 0, 0];
const ONE_OFFSET = (): number[] => [0, 0, 0, 0, 0, 0.2, 0, 0.2];

/** Float32 精度容差比较（例：0.2 → 0.20000000298...） */
function assertArrClose(actual: Float32Array, expected: number[], eps = 1e-6): void {
  assert.equal(actual.length, expected.length, `长度 ${actual.length} != ${expected.length}`);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < eps, `[${i}]: ${actual[i]} 不≈ ${expected[i]}`);
  }
}

// ================= ParameterStore =================

test("M2: ParameterStore set 钳制 / get / 未知忽略 / reset / normalized", () => {
  const ps = paramStore();
  assert.equal(ps.get("微笑"), 0);       // def 0
  assert.equal(ps.get("尾巴摆"), 0.5);   // def 0.5
  // set 钳制
  ps.set("微笑", 5);
  assert.equal(ps.get("微笑"), 1);
  ps.set("微笑", -3);
  assert.equal(ps.get("微笑"), 0);
  // 未知 id 忽略且 set 返回 false
  assert.equal(ps.set("幽灵参数", 0.5), false);
  assert.equal(ps.get("幽灵参数"), 0);
  // normalized（注意：def=0 在 [-30,30] 中归一化 = 0.5，不是 0）
  assert.equal(ps.normalized("头转向"), 0.5);
  ps.set("头转向", 30);
  assert.equal(ps.normalized("头转向"), 1);
  ps.set("头转向", -30);
  assert.equal(ps.normalized("头转向"), 0);
  // reset
  ps.set("微笑", 1);
  ps.reset();
  assert.equal(ps.get("微笑"), 0);
  assert.equal(ps.get("头转向"), 0);
});

test("M2: ParameterStore list/has", () => {
  const ps = paramStore();
  assert.equal(ps.has("微笑"), true);
  assert.equal(ps.has("无"), false);
  assert.equal(ps.list().length, 3);
});

// ================= Warp 1D =================

test("M2: accumulateKeyforms 单 keyform 钳制 + 双 keyform 线性插值", () => {
  const out = new Float32Array(8);
  const ks = [
    { value: 0, offsets: Z8() },
    { value: 1, offsets: ONE_OFFSET() },
  ];
  accumulateKeyforms(ks, 0, out); // 钳制 first
  assertArrClose(out, [0, 0, 0, 0, 0, 0, 0, 0]);
  accumulateKeyforms(ks, 1, out); // 累加 last
  assertArrClose(out, [0, 0, 0, 0, 0, 0.2, 0, 0.2]);
  accumulateKeyforms(ks, 1.5, out); // 超上界钳 last（再累加）
  assertArrClose(out, [0, 0, 0, 0, 0, 0.4, 0, 0.4]);
  // -1 钳到 first
  out.fill(0);
  accumulateKeyforms(ks, -1, out);
  assertArrClose(out, [0, 0, 0, 0, 0, 0, 0, 0]);
  // 中值插值
  out.fill(0);
  accumulateKeyforms(ks, 0.5, out);
  assertArrClose(out, [0, 0, 0, 0, 0, 0.1, 0, 0.1]);
  // 任意负区间 [-30,30]
  const ks2 = [
    { value: -30, offsets: Z8() },
    { value: 30, offsets: ONE_OFFSET() },
  ];
  out.fill(0);
  accumulateKeyforms(ks2, 0, out); // 中点 → 0.1
  assertArrClose(out, [0, 0, 0, 0, 0, 0.1, 0, 0.1]);
});

test("M2: applyWarps rest 拷贝 + 多 warp 累加 + 无 warp 恒等", () => {
  const warps: L2dmWarp[] = [
    { parameter: "微笑", keyforms: [{ value: 0, offsets: Z8() }, { value: 1, offsets: ONE_OFFSET() }] },
    { parameter: "尾巴摆", keyforms: [{ value: 0, offsets: Z8() }, { value: 1, offsets: [0, 0, 0, 0, 0, 0.1, 0, 0] }] },
  ];
  const ps = paramStore();
  ps.set("微笑", 1);
  ps.set("尾巴摆", 1);
  const out = new Float32Array(8);
  applyWarps(REST, warps, ps, out);
  // rest + warp1[0.2@v2y,0.2@v3y] + warp2[0.1@v2y] → idx5=1+0.2+0.1=1.3, idx7=1+0.2+0=1.2
  assertArrClose(out, [0, 0, 1, 0, 1, 1.3, 0, 1.2]);

  // 无 warp = 恒等拷贝（rest 不被修改）
  const out2 = new Float32Array(8);
  applyWarps(REST, undefined, ps, out2);
  assertArrClose(out2, [...REST]);
  assertArrClose(REST, [0, 0, 1, 0, 1, 1, 0, 1]);
});

test("M2: accumulateKeyforms2D 双线性 + 钳制", () => {
  // 2×2 网格，2 分量简化（xy）
  const k00 = { offsets: [0, 0] };
  const k10 = { offsets: [1, 0] };
  const k01 = { offsets: [0, 1] };
  const k11 = { offsets: [2, 2] };
  const grid = [k00, k10, k01, k11]; // row-major W=2

  // 角点（钳制）
  let out = new Float32Array(2);
  accumulateKeyforms2D([0, 1], [0, 1], grid, 0, 0, out);
  assert.deepEqual([...out], [0, 0]);
  accumulateKeyforms2D([0, 1], [0, 1], grid, 1, 1, out);
  assert.deepEqual([...out], [2, 2]);
  // 双线性中值
  out = new Float32Array(2);
  accumulateKeyforms2D([0, 1], [0, 1], grid, 0.5, 0.5, out);
  // top=(k00+k10)/2=(0.5,0) bottom=(k01+k11)/2=(1,1.5) → (0.75,0.75)
  assert.ok(Math.abs(out[0] - 0.75) < 1e-9);
  assert.ok(Math.abs(out[1] - 0.75) < 1e-9);
  // 越界钳制
  out = new Float32Array(2);
  accumulateKeyforms2D([0, 1], [0, 1], grid, -5, 5, out);
  assert.deepEqual([...out], [0, 1]); // x 钳 0（k00），y 钳 1（k01）
});

test("M2: applyWarp2D 整体（rest + 双线性）", () => {
  const ps = paramStore();
  ps.set("头转向", 15); // normalized 0.75
  ps.set("尾巴摆", 0.5); // normalized 0.5
  const warp2d: L2dmWarp2D = {
    parameters: ["头转向", "尾巴摆"],
    valuesX: [-30, 30],
    valuesY: [0, 1],
    keyforms: [
      { offsets: Z8() },                             // (x0,y0)
      { offsets: [0, 1, 0, 1, 0, 1, 0, 1] },          // (x1,y0)
      { offsets: Z8() },                             // (x0,y1)
      { offsets: [0, 1, 0, 1, 0, 1, 0, 1] },          // (x1,y1)
    ],
  };
  const out = new Float32Array(8);
  applyWarp2D(REST, warp2d, ps, out);
  // vx=0.75 → 行内 0.75；vy=0.5 → 两行 0.5 合成仍 0.75 → 每顶点 y 偏移 0.75
  assertArrClose(out, [0, 0.75, 1, 0.75, 1, 1.75, 0, 1.75]);
});

test("M2: 确定性——同参多次结果一致", () => {
  const warps: L2dmWarp[] = [
    { parameter: "微笑", keyforms: [{ value: 0, offsets: Z8() }, { value: 1, offsets: ONE_OFFSET() }] },
  ];
  const ps = paramStore();
  ps.set("微笑", 0.37);
  const a = new Float32Array(8);
  const b = new Float32Array(8);
  applyWarps(REST, warps, ps, a);
  applyWarps(REST, warps, ps, b);
  assert.deepEqual([...a], [...b]);
});

// ================= Hierarchy =================

test("M2: bindingToMatrix——平移/旋转/缩放通道按归一化位置累加", () => {
  const ps = paramStore();
  const base = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  // rotation: 头转向(normalized) → -30..30
  const bindings = [{ parameter: "头转向", channel: "rotation" as const, from: -30, to: 30 }];
  ps.set("头转向", 15); // normalized 0.75 → rotation = -30 + 60*0.75 = 15
  const m = bindingToMatrix(base, bindings, ps);
  const [tx, ty] = applyAffine(m, 1, 0);
  const r15 = (15 * Math.PI) / 180;
  assert.ok(Math.abs(tx - Math.cos(r15)) < 1e-9);
  assert.ok(Math.abs(ty - Math.sin(r15)) < 1e-9);

  // 平移 x：from=0 to=100
  const bind2 = [{ parameter: "微笑", channel: "x" as const, from: 0, to: 100 }];
  ps.set("微笑", 0.5); // normalized 0.5 → x=50
  const m2 = bindingToMatrix({ ...base }, bind2, ps);
  const [px] = applyAffine(m2, 0, 0);
  assert.equal(px, 50);
  // 缩放 scaleY：from=1 to=2，基础 scaleY=1 → 结果 1+2=3
  const bind3 = [{ parameter: "微笑", channel: "scaleY" as const, from: 1, to: 2 }];
  ps.set("微笑", 1);
  const m3 = bindingToMatrix({ ...base }, bind3, ps);
  const [, py] = applyAffine(m3, 0, 1);
  assert.equal(py, 3);
});

test("M2: deformerLocalMatrix 绕枢轴旋转", () => {
  const ps = paramStore();
  const d = {
    id: "d0",
    pivot: { x: 5, y: 0 },
    bindings: [{ parameter: "头转向", channel: "rotation" as const, from: -90, to: 90 }],
  };
  ps.set("头转向", 30); // normalized 1 → rotation 90
  const m = deformerLocalMatrix(d, ps);
  // 绕枢轴 (5,0) 旋转 90°：点 (5,1) → (5-1, 0+0) = (4,0)
  const [x, y] = applyAffine(m, 5, 1);
  assert.ok(Math.abs(x - 4) < 1e-9 && Math.abs(y - 0) < 1e-9, `(${x},${y})`);
  // 枢轴点自身不动
  const [px, py] = applyAffine(m, 5, 0);
  assert.ok(Math.abs(px - 5) < 1e-9 && Math.abs(py - 0) < 1e-9);
});

test("M2: resolveDeformerMatrices 父链连乘（任意顺序）+ 缺失父抛错", () => {
  const ps = paramStore();
  const defers: L2dmDeformer[] = [
    { id: "B", parent: "A", bindings: [{ parameter: "微笑", channel: "x", from: 0, to: 10 }] },
    { id: "A", bindings: [{ parameter: "头转向", channel: "rotation", from: -90, to: 90 }] },
  ];
  ps.set("头转向", 30); // rotation 90
  ps.set("微笑", 1); // x +10
  const worlds = resolveDeformerMatrices(defers, ps);
  assert.ok(worlds.has("A"));
  assert.ok(worlds.has("B"));
  // A = rotate90；B = translate(10,0)·rotate90
  // 点 (1,0)：A → (0,1)；B → 先 rotate(0,1)... 连乘语义：multiply(localB, worldA)
  //   worldB 应用 (1,0) = worldA 应用 → (0,1)；再 localB 平移 x+10 → (10,1)
  const [bxp, byp] = applyAffine(worlds.get("B")!, 1, 0);
  assert.ok(Math.abs(bxp - 10) < 1e-9 && Math.abs(byp - 1) < 1e-9, `B(${bxp},${byp})`);
  const [axp, ayp] = applyAffine(worlds.get("A")!, 1, 0);
  assert.ok(Math.abs(axp - 0) < 1e-9 && Math.abs(ayp - 1) < 1e-9);

  // 缺失父 → 抛错
  assert.throws(() => {
    resolveDeformerMatrices([{ id: "X", parent: "缺失" }] satisfies L2dmDeformer[], ps);
  }, /不存在/);
});

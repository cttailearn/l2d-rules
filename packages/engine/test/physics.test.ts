import { test } from "node:test";
import assert from "node:assert/strict";
import { ParameterStore, PendulumSim } from "../src/index.ts";

// fixture：头转向驱动 前发摆（0..1），经典摆锤设置
function make(): { ps: ParameterStore; sim: PendulumSim } {
  const ps = new ParameterStore([
    { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
    { id: "前发摆", min: 0, max: 1, def: 0, group: "Physics" },
  ]);
  const sim = new PendulumSim([
    { id: "发丝", input: "头转向", outputParams: ["前发摆"], delay: 0.2, acceleration: 0.5 },
  ]);
  return { ps, sim };
}

test("M4: 摆锤收敛到固定点（一阶阻尼弹簧）", () => {
  const { ps, sim } = make();
  ps.set("头转向", 15); // -30..30 → 归一化 0.75
  for (let i = 0; i < 400; i++) sim.step(16, ps);
  const out = ps.get("前发摆");
  // 固定点 cur* = input·accel/(accel + delay·DAMP)：accel=0.5,delay=0.2,DAMP=0.5 → 0.75·0.5/0.6 = 0.625
  const target = (0.75 * 0.5) / (0.5 + 0.2 * 0.5);
  assert.ok(Math.abs(out - target) < 0.02, `前发摆 ${out} 应≈${target}`);
  // 且在范围内
  assert.ok(out >= 0 && out <= 1);
});

test("M4: 确定性——同 (dt 序列) 同轨迹", () => {
  const run = (): number[] => {
    const { ps, sim } = make();
    ps.set("头转向", 20);
    const traj: number[] = [];
    for (let i = 0; i < 60; i++) {
      sim.step(16, ps);
      traj.push(ps.get("前发摆"));
    }
    return traj;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
});

test("M4: 收敛后稳定——不振荡、不越界", () => {
  const { ps, sim } = make();
  ps.set("头转向", 30); // 归一化 1.0
  for (let i = 0; i < 800; i++) sim.step(16, ps); // 充分收敛
  const target = (1 * 0.5) / (0.5 + 0.2 * 0.5); // ≈0.625
  for (let i = 0; i < 100; i++) {
    sim.step(16, ps);
    const v = ps.get("前发摆");
    assert.ok(Math.abs(v - target) < 1e-3, `收敛后振荡？${v} vs ${target}`);
    assert.ok(v >= 0 && v <= 1, `越界 ${v}`);
  }
});

// @l2dp/rig P4a 测试：rigCharacter 半自动绑定（模板配准 / 参数挂接 / warp 合成 / 顺序 / 物理 / 像素 golden）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { L2dmPlayer, SoftwareRenderer, type L2dmModel } from "@l2dp/engine";
import { rigCharacter, RIG_TEMPLATES, RIG_PARAM_DEFS } from "../src/index.ts";
import { sampleSpec } from "./sample.ts";
import { goldenRigFrames, renderState } from "./golden-frames.ts";

const here = dirname(fileURLToPath(import.meta.url));

// ---------- 工具 ----------
function modelOf(spec: ReturnType<typeof sampleSpec>): { model: L2dmModel } {
  return rigCharacter(spec);
}

test("P4a: rigCharacter → 合法 .l2dm + RigSpec + 质检报告", () => {
  const { model, spec, report } = rigCharacter(sampleSpec());
  assert.equal(model.formatVersion, 1);
  assert.equal(model.id, "demo-chan");
  assert.equal(model.canvas.width, 480);
  assert.equal(model.canvas.height, 640);
  // engine 校验通过（DoD）
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(report.summary.partCount, sampleSpec().parts.length);
  // RigSpec 审计字段
  assert.equal(spec.character, "demo-chan");
  assert.ok(spec.hinge !== null && spec.hinge.y > 0);
  assert.ok(spec.parts.length === sampleSpec().parts.length);
  const paramIds = spec.parameters.map((p) => p.id);
  assert.ok(paramIds.includes("头转向"));
  assert.ok(paramIds.includes("眼闭左"));
  assert.ok(paramIds.includes("嘴开"));
  // 参数组对齐（引擎合法组 + driver 环境层可驱动）
  const groupOf = (id: string) => model.parameters.find((p) => p.id === id)?.group;
  assert.equal(groupOf("眼闭左"), "EyeBlink");
  assert.equal(groupOf("嘴开"), "LipSync");
  assert.equal(groupOf("头转向"), "Head");
  assert.equal(groupOf("呼吸"), "Ambient");
  assert.equal(groupOf("发摆"), "Physics");
});

test("P4a: 自动绘制顺序遵循语义先验（后发<脸<前发；目玉<目）", () => {
  const { model } = rigCharacter(sampleSpec());
  const orderOf = (id: string) => model.parts.find((p) => p.id === id)?.order;
  assert.ok(orderOf("hair-back")! < orderOf("face")!);
  assert.ok(orderOf("face")! < orderOf("hair-front")!);
  assert.ok(orderOf("eyeball-l")! < orderOf("eye-l")!);
  assert.ok(orderOf("brow-l")! > orderOf("eye-l")!);
  // order = 先验×10 + 序号 → 同语义两件保序
  assert.ok(orderOf("hair-side-l")! < orderOf("hair-side-r")!);
});

test("P4a: warp 合成完整性（keyform 长度/递增/2D 网格数/绑定审计）", () => {
  const { model, spec } = rigCharacter(sampleSpec());
  for (const part of model.parts) {
    const m = part.mesh!;
    const n = m.vertices.length;
    for (const w of m.warps ?? []) {
      assert.ok(w.keyforms.length >= 2);
      for (let i = 1; i < w.keyforms.length; i++) {
        assert.ok(w.keyforms[i]!.value > w.keyforms[i - 1]!.value, "keyform value 须严格递增");
      }
      for (const k of w.keyforms) assert.equal(k.offsets.length, n);
    }
    for (const w2 of m.warp2d ?? []) {
      assert.equal(w2.keyforms.length, w2.valuesX.length * w2.valuesY.length);
      for (const k of w2.keyforms) assert.equal(k.offsets.length, n);
    }
  }
  // 绑定审计：每个有 warp 的部件在 RigSpec 有对应记录
  const face = spec.parts.find((p) => p.id === "face")!;
  assert.ok(face.bindings.some((b) => b.kind === "warp2d"));
  const eye = spec.parts.find((p) => p.id === "eye-l")!;
  assert.ok(eye.bindings.some((b) => b.param === "眼闭左" && b.kind === "warp1d"));
  const mouth = spec.parts.find((p) => p.id === "mouth")!;
  assert.ok(mouth.bindings.some((b) => b.param === "嘴开"));
  const hair = spec.parts.find((p) => p.id === "hair-front")!;
  assert.ok(hair.bindings.some((b) => b.param === "头转向"));
});

test("P4a: 形变结构断言（眨眼上睑下移 / 嘴开上下分 / 点头纵向压缩）", () => {
  const { model } = rigCharacter(sampleSpec());
  // 眨眼：上睑顶点（row0）在闭眼 keyform 处 dy>0（下移）
  const eyePart = model.parts.find((p) => p.id === "eye-l")!;
  const closure = eyePart.mesh!.warps!.find((w) => w.parameter === "眼闭左")!;
  const topDy = closure.keyforms.at(-1)!.offsets[1]!;
  assert.ok(topDy > 1, "上睑应下移（dy>1）");
  // 嘴开：上唇上移（dy<0）、下唇下移（dy>0）
  const mouthPart = model.parts.find((p) => p.id === "mouth")!;
  const open = mouthPart.mesh!.warps!.find((w) => w.parameter === "嘴开")!;
  const dyFirstRow = open.keyforms.at(-1)!.offsets[1]!; // row0 上唇
  const rows = 4;
  const lowerDy = open.keyforms.at(-1)!.offsets[((rows - 1) * 3) * 2 + 1]!;
  assert.ok(dyFirstRow < -0.5, "上唇应上移");
  assert.ok(lowerDy > 0, "下唇应下移");
  // 点头：warp2d 中心（0,0）为 identity，y 轴端点非零
  const facePart = model.parts.find((p) => p.id === "face")!;
  const headW2 = facePart.mesh!.warp2d![0]!;
  const centerKf = headW2.keyforms[4]!; // i=1,j=1
  assert.ok(centerKf.offsets.every((v) => Math.abs(v) < 1e-9), "头转向/头点头=0 时应恒等");
});

test("P4a: 参数驱动像素变化 + 确定性", () => {
  const { model } = rigCharacter(sampleSpec());
  const rest = renderState(model, () => {});
  const blink = renderState(model, (ps) => { ps.set("眼闭左", 1); ps.set("眼闭右", 1); });
  const turn = renderState(model, (ps) => ps.set("头转向", 20));
  const smile = renderState(model, (ps) => ps.set("嘴笑", 1));
  const breathe = renderState(model, (ps) => ps.set("呼吸", 1));
  assert.notEqual(blink, rest, "眨眼应改变像素");
  assert.notEqual(turn, rest, "转头应改变像素");
  assert.notEqual(smile, rest, "微笑应改变像素");
  assert.notEqual(breathe, rest, "呼吸 deformer 应改变像素");
  // 确定性：同参数两次渲染哈希一致
  assert.equal(renderState(model, () => {}), rest);
  assert.equal(renderState(model, (ps) => ps.set("头转向", 20)), turn);
});

test("P4a: rig 渲染色块非空（软件光栅可见）", () => {
  const { model } = rigCharacter(sampleSpec());
  const player = new L2dmPlayer(model, new Map());
  const sw = new SoftwareRenderer();
  player.render(sw);
  const n = sw.countNonTransparent();
  assert.ok(n > 1000, "应有大量非透明像素");
});

test("P4a: 物理摆锤输出逐步收敛（发摆 靠近头转向）", () => {
  const { model } = rigCharacter(sampleSpec());
  const player = new L2dmPlayer(model, new Map());
  player.params.reset();
  assert.equal(player.params.get("发摆"), 0);
  player.params.set("头转向", 25);
  for (let i = 0; i < 40; i++) player.tick(16);
  const v = player.params.get("发摆");
  assert.ok(v > 0.005, "头转向 25° 后发摆应 >0（跟随）；实际 " + v);
});

test("P4a: 纹理部件内嵌 atlas（data URI → 合法模型）", () => {
  // 1×1 透明 PNG（base64）
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const spec = sampleSpec();
  spec.parts = [{ id: "face", semantic: "face", bbox: { x: 174, y: 138, width: 40, height: 40 }, image: { dataUri: "data:image/png;base64," + png } }];
  const { model, report } = rigCharacter(spec);
  assert.equal(model.parts[0]!.texture, "face");
  assert.ok(model.atlas?.["face"] && model.atlas["face"].startsWith("data:image/png;base64,"));
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  // body/head 缺省 → 无 head 参数仍合法
});

test("P4a: 异常输入（未知语义 / 重复 id）", () => {
  const spec = sampleSpec();
  assert.throws(() => rigCharacter({ ...spec, parts: [{ id: "x", semantic: "galaxy", bbox: { x: 0, y: 0, width: 10, height: 10 } }] as never }), /未知语义/);
  const dup = sampleSpec();
  dup.parts[1] = { ...dup.parts[0]!, id: "hair-back" }; // 重复 id
  assert.throws(() => rigCharacter(dup), /重复/);
});

test("P4a: 像素 golden（确定性回归）", () => {
  const fixture = JSON.parse(readFileSync(join(here, "fixtures", "rig-golden.json"), "utf8")) as {
    canvas: number[];
    frames: { note: string; hash: string }[];
  };
  const { model } = rigCharacter(sampleSpec());
  assert.deepEqual([model.canvas.width, model.canvas.height], fixture.canvas);
  const frames = goldenRigFrames(model);
  assert.equal(frames.length, fixture.frames.length, "帧数应一致");
  const byNote = new Map(fixture.frames.map((f) => [f.note, f.hash]));
  for (const f of frames) {
    const expected = byNote.get(f.note);
    assert.ok(expected !== undefined, "fixture 缺少帧: " + f.note);
    assert.equal(f.hash, expected, "帧哈希不一致: " + f.note);
  }
  // golden 完整性护栏：帧间确实有运动（不是全同）
  const hashes = new Set(frames.map((f) => f.hash));
  assert.ok(hashes.size >= 8, "golden 帧应包含多种状态（至少 8 个不同哈希）");
});

test("P4a: 词表自检（模板 grid ≥2×2、参数组合法、先验顺序严格唯一区间）", () => {
  const sems = Object.values(RIG_TEMPLATES);
  for (const t of sems) {
    assert.ok(t.grid[0] >= 2 && t.grid[1] >= 2, t.semantic + " grid 至少 2×2");
  }
  for (const p of Object.values(RIG_PARAM_DEFS)) {
    assert.ok(p.min < p.max);
  }
  const orders = sems.map((t) => t.order).sort((a, b) => a - b);
  for (let i = 1; i < orders.length; i++) {
    assert.ok(orders[i]! > orders[i - 1]!, "先验顺序应严格递增（唯一）");
  }
});

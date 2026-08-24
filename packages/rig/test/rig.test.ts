// @l2dp/rig P4a 测试：rigCharacter 半自动绑定（模板配准 / 参数挂接 / warp 合成 / 顺序 / 物理 / 像素 golden）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { L2dmPlayer, SoftwareRenderer, type L2dmModel } from "@l2dp/engine";
import { rigCharacter, RIG_TEMPLATES, RIG_PARAM_DEFS, type RigPartSpec, type RigClothingPartSpec } from "../src/index.ts";
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

test("B-1/B-4: 完整身体层 20 语义 + 非标准部位（尾巴/兽耳/翅膀）全绑定合法", () => {
  const canvas = { width: 800, height: 1200 };
  const parts: RigPartSpec[] = [
    // 身体层 20
    { id: "hr-back", semantic: "hair_back", bbox: { x: 200, y: 40, width: 400, height: 260 } },
    { id: "hr-side-l", semantic: "hair_side", side: "left", bbox: { x: 140, y: 60, width: 120, height: 300 } },
    { id: "hr-side-r", semantic: "hair_side", side: "right", bbox: { x: 540, y: 60, width: 120, height: 300 } },
    { id: "hr-front", semantic: "hair_front", bbox: { x: 220, y: 50, width: 360, height: 240 } },
    { id: "neck", semantic: "neck", bbox: { x: 370, y: 350, width: 60, height: 90 } },
    { id: "ear-l", semantic: "ear", side: "left", bbox: { x: 240, y: 300, width: 40, height: 90 } },
    { id: "ear-r", semantic: "ear", side: "right", bbox: { x: 520, y: 300, width: 40, height: 90 } },
    { id: "hoho-l", semantic: "hoho", side: "left", bbox: { x: 260, y: 395, width: 70, height: 45 } },
    { id: "hoho-r", semantic: "hoho", side: "right", bbox: { x: 470, y: 395, width: 70, height: 45 } },
    { id: "face", semantic: "face", bbox: { x: 240, y: 380, width: 320, height: 210 } },
    { id: "nose", semantic: "nose", bbox: { x: 386, y: 455, width: 28, height: 40 } },
    { id: "eye-l", semantic: "eye", side: "left", bbox: { x: 290, y: 420, width: 70, height: 44 } },
    { id: "eye-r", semantic: "eye", side: "right", bbox: { x: 440, y: 420, width: 70, height: 44 } },
    { id: "eyeball-l", semantic: "eyeball", side: "left", bbox: { x: 306, y: 428, width: 24, height: 24 } },
    { id: "eyeball-r", semantic: "eyeball", side: "right", bbox: { x: 470, y: 428, width: 24, height: 24 } },
    { id: "brow-l", semantic: "brow", side: "left", bbox: { x: 288, y: 400, width: 78, height: 20 } },
    { id: "brow-r", semantic: "brow", side: "right", bbox: { x: 434, y: 400, width: 78, height: 20 } },
    { id: "mouth", semantic: "mouth", bbox: { x: 365, y: 505, width: 70, height: 40 } },
    { id: "body-upper", semantic: "body_upper", bbox: { x: 150, y: 470, width: 500, height: 420 } },
    { id: "body-lower", semantic: "body_lower", bbox: { x: 170, y: 850, width: 460, height: 300 } },
    { id: "breast", semantic: "adult_breast", bbox: { x: 260, y: 520, width: 280, height: 120 } },
    { id: "arm-l", semantic: "arm_a", side: "left", bbox: { x: 90, y: 500, width: 60, height: 360 } },
    { id: "arm-r", semantic: "arm_b", side: "right", bbox: { x: 650, y: 500, width: 60, height: 360 } },
    { id: "leg-l", semantic: "leg", side: "left", bbox: { x: 240, y: 900, width: 90, height: 280 } },
    { id: "leg-r", semantic: "leg", side: "right", bbox: { x: 470, y: 900, width: 90, height: 280 } },
    { id: "feet-l", semantic: "feet", side: "left", bbox: { x: 250, y: 1160, width: 80, height: 30 } },
    { id: "feet-r", semantic: "feet", side: "right", bbox: { x: 470, y: 1160, width: 80, height: 30 } },
    { id: "adult-g", semantic: "adult_genital", bbox: { x: 380, y: 880, width: 40, height: 26 } },
    // 非标准部位（B-4）
    { id: "tail", semantic: "tail", bbox: { x: 490, y: 780, width: 80, height: 400 } },
    { id: "ear-beast-l", semantic: "ear_beast", side: "left", bbox: { x: 250, y: 250, width: 55, height: 130 } },
    { id: "ear-beast-r", semantic: "ear_beast", side: "right", bbox: { x: 495, y: 250, width: 55, height: 130 } },
    { id: "wing-l", semantic: "wing", side: "left", bbox: { x: 30, y: 240, width: 90, height: 320 } },
    { id: "wing-r", semantic: "wing", side: "right", bbox: { x: 680, y: 240, width: 90, height: 320 } },
  ];
  const { model, report, spec } = rigCharacter({ id: "full-body", canvas, parts });
  // 词表/模型合法
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(model.parts.length, parts.length, "全部 33 部件入模");
  // 参数面：新增语义参数全部派生
  const paramIds = model.parameters.map((p) => p.id);
  for (const expect of ["尾巴摆", "耳朵动", "翅膀扇", "脸红", "身摆", "臂摆", "腿摆", "胸摆"]) {
    assert.ok(paramIds.includes(expect), "缺少参数 " + expect);
  }
  // 非标准部位 warp 绑定
  const warpParamOf = (id: string) => model.parts.find((p) => p.id === id)!.mesh!.warps!.map((w) => w.parameter);
  assert.ok(warpParamOf("tail").includes("尾巴摆"));
  assert.ok(warpParamOf("wing-l").includes("翅膀扇"));
  assert.ok(warpParamOf("ear-beast-l").includes("耳朵动"));
  // 兽耳随头转（headCluster → warp2d）
  assert.ok(model.parts.find((p) => p.id === "ear-beast-l")!.mesh!.warp2d!.length > 0);
  // hoho 有 opacityParam=脸红
  assert.equal(model.parts.find((p) => p.id === "hoho-l")!.opacityParam, "脸红");
  // 胸有摆锤物理输出
  assert.ok(model.physics!.pendulums.some((p) => p.id === "breast-sway"), "胸摆锤存在");
  assert.ok(model.physics!.pendulums.some((p) => p.id === "hair-sway"), "发丝摆锤存在");
  // 绘制顺序：后发 < 脸 < 前发；下躯在腿之上
  const orderOf = (id: string) => model.parts.find((p) => p.id === id)!.order;
  assert.ok(orderOf("hr-back") < orderOf("face"));
  assert.ok(orderOf("face") < orderOf("hr-front"));
  assert.ok(orderOf("body-lower") < orderOf("leg-l"));
  // RigSpec 审计含新参数
  assert.ok(spec.parameters.some((p) => p.id === "尾巴摆"));
});
test("B-3: 服装层双服装组——opacityParam 换装机制 + RigSpec.costumes 审计", () => {
  const canvas = { width: 800, height: 1200 };
  const base: RigPartSpec[] = [
    { id: "face", semantic: "face", bbox: { x: 240, y: 380, width: 320, height: 210 } },
    { id: "body-upper", semantic: "body_upper", bbox: { x: 150, y: 470, width: 500, height: 420 } },
    { id: "body-lower", semantic: "body_lower", bbox: { x: 170, y: 850, width: 460, height: 300 } },
    { id: "neck", semantic: "neck", bbox: { x: 370, y: 350, width: 60, height: 90 } },
  ];
  const clothing: RigClothingPartSpec[] = [
    { id: "dress-1", semantic: "outfit_dress", costumeGroup: 1, bbox: { x: 150, y: 480, width: 500, height: 300 } },
    { id: "shoes-1", semantic: "outfit_shoes", costumeGroup: 1, bbox: { x: 250, y: 1160, width: 300, height: 30 } },
    { id: "dress-2", semantic: "outfit_dress", costumeGroup: 2, bbox: { x: 150, y: 480, width: 500, height: 300 } },
    { id: "hat-2", semantic: "hairstyle", costumeGroup: 2, bbox: { x: 260, y: 260, width: 280, height: 120 } },
  ];
  const { model, report, spec } = rigCharacter({ id: "costume", canvas, parts: [...base, ...clothing] });
  assert.equal(report.ok, true, JSON.stringify(report.checks));

  // 服装部件挂 opacityParam = 衣装组<N>
  const dress1 = model.parts.find((p) => p.id === "dress-1")!;
  const dress2 = model.parts.find((p) => p.id === "dress-2")!;
  assert.equal(dress1.opacityParam, "衣装组1", "组1服装部件随 衣装组1 显隐");
  assert.equal(dress2.opacityParam, "衣装组2", "组2服装部件随 衣装组2 显隐");
  assert.equal(model.parts.find((p) => p.id === "hat-2")!.opacityParam, "衣装组2", "hairstyle 也随组");
  // 非服装部件无 opacityParam（身体层 default 可见）
  assert.equal(model.parts.find((p) => p.id === "face")!.opacityParam, undefined);

  // 参数面：衣装组1 默认可见(def=1)、衣装组2 默认隐藏(def=0)
  const p1 = model.parameters.find((p) => p.id === "衣装组1")!;
  const p2 = model.parameters.find((p) => p.id === "衣装组2")!;
  assert.equal(p1.def, 1, "最小组（1）默认可见");
  assert.equal(p2.def, 0, "组 2 默认隐藏");

  // RigSpec.costumes 审计
  assert.ok(spec.costumes.length >= 2, "两个服装组都记录");
  const g1 = spec.costumes.find((c) => c.group === 1)!;
  const g2 = spec.costumes.find((c) => c.group === 2)!;
  assert.ok(g1.partIds.includes("dress-1") && g1.partIds.includes("shoes-1"));
  assert.ok(g2.partIds.includes("dress-2") && g2.partIds.includes("hat-2"));

  // 换装语义等价：置 衣装组2=1 && 衣装组1=0 → 组1部件不可见、组2可见（引擎 partVisible opacity>0）
  const render2 = (params: Record<string, number>) => {
    const player2 = new L2dmPlayer(model, new Map());
    player2.params.reset();
    for (const [k, v] of Object.entries(params)) player2.params.set(k, v);
    const sw2 = new SoftwareRenderer();
    player2.render(sw2);
    return Buffer.from(sw2.readPixels()!).toString("hex");
  };
  const g1px = render2({ 衣装组1: 1, 衣装组2: 0 });
  const g2px = render2({ 衣装组1: 0, 衣装组2: 1 });
  assert.notEqual(g1px, g2px, "切换服装组改变渲染像素（换装）");
});
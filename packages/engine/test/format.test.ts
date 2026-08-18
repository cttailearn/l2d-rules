import { test } from "node:test";
import assert from "node:assert/strict";
import {
  L2DM_FORMAT_VERSION,
  loadL2dm,
  loadL2dmObject,
  parseL2dm,
  validateL2dmModel,
  type L2dmModel,
} from "../src/index.ts";

// ---------- 测试夹具：合法最小模型 ----------
function makeValid(): L2dmModel {
  return {
    formatVersion: L2DM_FORMAT_VERSION,
    id: "小夏",
    canvas: { width: 1000, height: 1000 },
    parameters: [
      { id: "微笑", min: 0, max: 1, def: 0 },
      { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
      { id: "尾巴摆", min: 0, max: 1, def: 0.5, group: "Custom" },
    ],
    parts: [
      {
        id: "face",
        order: 1,
        color: [1, 0, 0, 1],
        mesh: {
          vertices: [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5],
          uvs: [0, 0, 1, 0, 1, 1, 0, 1],
          indices: [0, 1, 2, 0, 2, 3],
          warps: [
            {
              parameter: "微笑",
              keyforms: [
                { value: 0, offsets: [0, 0, 0, 0, 0, 0, 0, 0] },
                { value: 1, offsets: [0, 0, 0, 0, 0, 0.2, 0, 0.2] },
              ],
            },
          ],
        },
      },
    ],
  };
}

test("M1: 合法最小模型通过校验", () => {
  const v = validateL2dmModel(makeValid());
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.equal(v.issues.length, 0);
});

test("M1: 多部位 + 自定义语义参数（尾巴摆）合法", () => {
  const m = makeValid();
  m.parts.push(
    { id: "tail1", order: 2, color: [0, 0, 1, 1], mesh: { vertices: [0, 0, 1, 0, 1, 1, 0, 0], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2] } },
    { id: "tail2", order: 3, parent: "tailDeformer", color: [0, 0, 1, 1], mesh: { vertices: [0, 0, 1, 0, 1, 1, 0, 1], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2] } },
  );
  m.deformers = [{ id: "tailDeformer", bindings: [{ parameter: "尾巴摆", channel: "rotation", from: 0, to: 30 }] }];
  const v = validateL2dmModel(m);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
});

test("M1: 参数规则——重复 id / min>=max / def 越界 / 非法 group", () => {
  const m = makeValid();
  m.parameters.push(
    { id: "微笑", min: 0, max: 1 },           // 重复
    { id: "坏范围", min: 1, max: 1 },          // min>=max
    { id: "坏默认", min: 0, max: 1, def: 5 },   // def 越界
    { id: "坏组", min: 0, max: 1, group: "Bogus" as never }, // 非法组
  );
  const v = validateL2dmModel(m);
  assert.equal(v.ok, false);
  const msgs = v.issues.map(i => i.message).join(";");
  assert.ok(msgs.includes("重复"), msgs);
  assert.ok(msgs.includes("范围无效"), msgs);
  assert.ok(msgs.includes("默认值"), msgs);
  assert.ok(msgs.includes("不在规范组"), msgs);
});

test("M1: 悬空引用——warp/opacityParam/deformer.parent/pose 引用不存在", () => {
  const m = makeValid();
  (m.parts[0].mesh!.warps![0] as { parameter: string }).parameter = "不存在参数";
  m.parts[0].opacityParam = "也不存在";
  m.parts[0].parent = "noSuchDeformer";
  m.pose = { groups: [{ ids: ["ghostPart"] }] };
  const v = validateL2dmModel(m);
  assert.equal(v.ok, false);
  const msgs = v.issues.map(i => i.path).join(";");
  assert.ok(msgs.includes("warps[0].parameter"));
  assert.ok(msgs.includes("opacityParam"));
  assert.ok(msgs.includes("parent"));
  assert.ok(msgs.includes("pose.groups[0].ids[0]"));
});

test("M1: 顶点越界 / 无索引 / 奇数顶点 / uvs 不匹配", () => {
  // 越界
  const m1 = makeValid();
  m1.parts[0].mesh!.indices = [0, 1, 5]; // 顶点数 4，索引 5 越界
  let v = validateL2dmModel(m1);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("越界")), JSON.stringify(v.issues));
  // 无索引
  const m2 = makeValid();
  m2.parts[0].mesh!.indices = [];
  v = validateL2dmModel(m2);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("不能为空")), JSON.stringify(v.issues));
  // 奇数顶点
  const m3 = makeValid();
  (m3.parts[0].mesh!.vertices as number[]).push(0.1);
  v = validateL2dmModel(m3);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("偶数")), JSON.stringify(v.issues));
  // uvs 长度不匹配
  const m4 = makeValid();
  (m4.parts[0].mesh!.uvs as number[]).pop();
  v = validateL2dmModel(m4);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("uvs 长度")), JSON.stringify(v.issues));
});

test("M1: warp keyforms 少于 2 / 值不单调 / offsets 长度错", () => {
  const m = makeValid();
  const warps = m.parts[0].mesh!.warps!;
  warps.push({
    parameter: "微笑",
    keyforms: [
      { value: 5, offsets: new Array(8).fill(0) },
      { value: 0, offsets: new Array(8).fill(0) }, // 不单调
    ],
  });
  warps.push({ parameter: "微笑", keyforms: [ { value: 0, offsets: new Array(8).fill(0) } ] }); // <2
  let v = validateL2dmModel(m);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("单调递增")), JSON.stringify(v.issues));

  const m2 = makeValid();
  m2.parts[0].mesh!.warps![0].keyforms[1].offsets = new Array(4).fill(0); // 长度错
  v = validateL2dmModel(m2);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("offsets 长度")), JSON.stringify(v.issues));
});

test("M1: warp2D——keyforms 数 = lenX×lenY / 轴单调 / 引用参数", () => {
  const m = makeValid();
  m.parameters.push({ id: "头转向Y", min: -30, max: 30, def: 0 });
  m.parts[0].mesh!.warp2d = [
    {
      parameters: ["头转向", "头转向Y"],
      valuesX: [-30, 0, 30],
      valuesY: [-30, 30],
      keyforms: [
        { offsets: new Array(8).fill(0) }, // (0,0)
        { offsets: new Array(8).fill(0) }, // (0,1)
        { offsets: new Array(8).fill(0) }, // (1,0)
        { offsets: new Array(8).fill(0) }, // (1,1)
        { offsets: new Array(8).fill(0) }, // (2,0)
        { offsets: new Array(8).fill(0) }, // (2,1)
      ],
    },
  ];
  let v = validateL2dmModel(m);
  assert.equal(v.ok, true, JSON.stringify(v.issues));

  // keyforms 数不对
  m.parts[0].mesh!.warp2d![0].keyforms.pop();
  v = validateL2dmModel(m);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("lenX×lenY")), JSON.stringify(v.issues));

  // 引用的参数不存在
  const m2 = makeValid();
  m2.parts[0].mesh!.warp2d = [{ parameters: ["不存在X", "不存在Y"], valuesX: [0, 1], valuesY: [0, 1], keyforms: [{ offsets: new Array(8).fill(0) }, { offsets: new Array(8).fill(0) }, { offsets: new Array(8).fill(0) }, { offsets: new Array(8).fill(0) }] }];
  v = validateL2dmModel(m2);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("不存在")));
});

test("M1: deformer 成环拒绝", () => {
  const m = makeValid();
  m.deformers = [
    { id: "A", parent: "B" },
    { id: "B", parent: "A" },
  ];
  const v = validateL2dmModel(m);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("成环")), JSON.stringify(v.issues));
});

test("M1: bindings——参数不存在 / from==to / 非法 channel", () => {
  const m = makeValid();
  m.deformers = [
    { id: "d0", bindings: [
      { parameter: "不存在", channel: "rotation", from: 0, to: 1 },
      { parameter: "微笑", channel: "rotation", from: 0.5, to: 0.5 },
      { parameter: "微笑", channel: "scaleZ" as never, from: 0, to: 1 },
    ] },
  ];
  const v = validateL2dmModel(m);
  assert.equal(v.ok, false);
  const msgs = v.issues.map(i => i.message).join(";");
  assert.ok(msgs.includes("不存在"));
  assert.ok(msgs.includes("from 必须"));
  assert.ok(msgs.includes("非法 channel"));
});

test("M1: physics input/output 参数存在性", () => {
  const m = makeValid();
  m.physics = {
    pendulums: [
      { id: "p0", input: "头转向", outputParams: ["前发摆", "后发摆"], delay: 0.1, acceleration: 1 },
      { id: "p1", input: "幽灵输入", outputParams: ["幽灵输出"], delay: 0.1, acceleration: 1 },
    ],
  };
  const v = validateL2dmModel(m);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.path.includes("p1") && i.path.includes(".input")), JSON.stringify(v.issues));
  assert.ok(v.issues.some(i => i.path.includes("outputParams[0]")), JSON.stringify(v.issues));
});

test("M1: uvRect 越界", () => {
  const m = makeValid();
  m.parts[0].uvRect = { x: 0.5, y: 0.5, width: 0.8, height: 0.1 }; // x+width>1
  const v = validateL2dmModel(m);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("uvRect")), JSON.stringify(v.issues));
});

test("M1: atlas 文件存在性（loader 阶段）", () => {
  const m = makeValid();
  m.parts[0].texture = "face.png";
  // 提供 atlasFiles 且缺该文件 → 拒绝
  let v = validateL2dmModel(m, new Set(["other.png"]));
  assert.equal(v.ok, false);
  assert.ok(v.issues.some(i => i.message.includes("atlas 文件")), JSON.stringify(v.issues));
  // 提供 atlasFiles 且包含 → 通过
  v = validateL2dmModel(m, new Set(["face.png"]));
  assert.equal(v.ok, true);
});

test("M1: parseL2dm——结构错 / 版本错 / 缺数组", () => {
  assert.equal(parseL2dm(null).ok, false);
  assert.equal(parseL2dm(123).ok, false);
  assert.equal(parseL2dm({ formatVersion: 2, id: "x", canvas: {}, parameters: [], parts: [] }).ok, false);
  const bad = { formatVersion: L2DM_FORMAT_VERSION, id: "x", canvas: { width: 1, height: 1 } };
  assert.equal(parseL2dm(bad).ok, false); // 缺 parameters/parts
});

test("M1: loadL2dm 一站式——合法文本 / 非法 JSON / 语义坏模型", () => {
  const valid = JSON.stringify(makeValid());
  const r1 = loadL2dm(valid);
  assert.equal(r1.ok, true);
  if (r1.ok) assert.equal(r1.model.id, "小夏");

  const r2 = loadL2dm("{ not json");
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.ok(r2.error.includes("JSON 解析失败"));

  const badModel = makeValid();
  badModel.parameters.push({ id: "微笑", min: 0, max: 1 }); // 重复
  const r3 = loadL2dmObject(badModel);
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.ok(r3.error.includes("重复"), r3.error);
});

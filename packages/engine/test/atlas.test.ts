// atlas.test.ts —— .l2dm 内嵌模型资源（atlas）—— 自包含模型产物
// 覆盖：data URI 内嵌通过校验；部件 texture 引用内嵌键解析；坏值/悬空引用被拒。

import { test } from "node:test";
import assert from "node:assert/strict";
import { L2DM_FORMAT_VERSION, loadL2dmObject, type L2dmModel } from "../src/index.ts";

const PNG_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

function makeWithTexture(): L2dmModel {
  return {
    formatVersion: L2DM_FORMAT_VERSION,
    id: "带资源",
    canvas: { width: 8, height: 8 },
    parameters: [{ id: "微笑", min: 0, max: 1, group: "Custom" }],
    parts: [
      {
        id: "face",
        order: 0,
        texture: "tex_00.png",
        mesh: { vertices: [0, 0, 4, 0, 4, 4, 0, 4], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] },
      },
    ],
  };
}

test("atlas: data URI 内嵌 + 部件引用解析通过校验", () => {
  const m = makeWithTexture();
  m.atlas = { "tex_00.png": PNG_URI };
  const v = loadL2dmObject(m);
  assert.equal(v.ok, true, v.ok ? "" : v.error);
  if (v.ok) assert.equal(v.model.atlas!["tex_00.png"], PNG_URI);
});

test("atlas: 裸 base64 也接受", () => {
  const m = makeWithTexture();
  m.atlas = { "tex_00.png": "iVBORw0KGgoAAAANSUhEUg==" };
  const v = loadL2dmObject(m);
  assert.equal(v.ok, true, v.ok ? "" : v.error);
});

test("atlas: 坏值被拒（非 data URI/非 base64）", () => {
  const m = makeWithTexture();
  m.atlas = { "tex_00.png": "not-an-image!!" };
  const v = loadL2dmObject(m);
  assert.equal(v.ok, false);
});

test("atlas: 显式 atlasFiles 仍有效（外部纹理），且不冲突内嵌", () => {
  const m = makeWithTexture();
  m.atlas = { "tex_00.png": PNG_URI }; // 内嵌
  const v1 = loadL2dmObject(m);
  assert.equal(v1.ok, true);
  const v2 = loadL2dmObject(makeWithTexture(), new Set(["tex_00.png"]));
  assert.equal(v2.ok, true);
});

test("atlas: 无上下文（不传 atlasFiles 也无内嵌）且引用纹理 → 跳过检查（向后兼容）", () => {
  // 既有行为：调用方不提供任何纹理上下文时不做存在性检查，仅当有上下文才严格。
  const m = makeWithTexture(); // part.texture 存在但无 atlas
  const v = loadL2dmObject(m);
  assert.equal(v.ok, true);
});

test("atlas: 有上下文时悬空引用被拒", () => {
  const m = makeWithTexture(); // texture: tex_00.png
  m.atlas = { "other.png": PNG_URI }; // 内嵌键不匹配
  const v = loadL2dmObject(m);
  assert.equal(v.ok, false);
});

// artifact.test.ts —— .l2dm 自包含产物 + 作者/二次修改工具链
// 覆盖：base64/data URI 嵌入、atlas 内嵌+校验、attachTextures、createL2dm 从零、
//       编辑 API（addPart/addWarp/embedTexture/attachTexture/setParamRange/removePart）后校验。

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadL2dmObject } from "@l2dp/engine";
import {
  addDeformer, addParameter, addPart, addWarp, attachTexture, bytesToB64, createL2dm, embedTexture, removePart,
  setParamGroup, setParamRange, toDataUri, toL2dmArtifact, validate,
} from "@l2dp/convert";
import type { ConvertedBundle, ConvertedParam } from "@l2dp/convert";

function miniBundle(): ConvertedBundle {
  const params: ConvertedParam[] = [
    { id: "微笑", engineGroup: "Custom", min: 0, max: 1, def: 0 },
    { id: "头转向", engineGroup: "Head", min: -30, max: 30, def: 0 },
    { id: "眨眼", engineGroup: "EyeBlink", min: 0, max: 1, def: 1 },
  ];
  return {
    format: "l2dp-converted",
    syntaxVersion: "0.1.0",
    source: "小夏",
    version: 3,
    fileRefs: { moc: "m.moc3", mocSize: 1, textures: [] },
    params,
    parts: [{ id: "face" }, { id: "head" }],
    groups: [{ target: "Parameter", name: "EyeBlink", ids: ["眨眼"] }],
    hitAreas: [],
    motions: [],
    expressions: [],
    physics: null,
    pose: null,
    userData: null,
  };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("bytesToB64 / toDataUri：零依赖 base64 正确（PNG magic 8 字节 → 12 字符）", () => {
  assert.equal(bytesToB64(PNG), "iVBORw0KGgo=");
  assert.equal(toDataUri(PNG, "image/png"), "data:image/png;base64,iVBORw0KGgo=");
});

test("toL2dmArtifact：内嵌 atlas 且骨架通过校验", () => {
  const model = toL2dmArtifact(miniBundle(), { textures: [{ file: "tex_00.png", bytes: PNG }] });
  assert.equal(model.atlas!["tex_00.png"], "data:image/png;base64,iVBORw0KGgo=");
  const v = loadL2dmObject(model);
  assert.equal(v.ok, true, v.ok ? "" : v.error);
});

test("toL2dmArtifact：attachTextures 让部件引用真实纹理，仍通过校验", () => {
  const model = toL2dmArtifact(miniBundle(), {
    textures: [
      { file: "tex_00.png", bytes: PNG },
      { file: "tex_01.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff]) },
    ],
    attachTextures: true,
  });
  assert.ok(model.parts.every((p) => p.texture !== undefined && p.texture! in model.atlas!));
  const v = loadL2dmObject(model);
  assert.equal(v.ok, true, v.ok ? "" : v.error);
});

test("createL2dm 从零构建 + 编辑 API 全链路后校验通过", () => {
  const m = createL2dm({ id: "my-mascot", parameters: [{ id: "开心", min: 0, max: 1 }] });
  addPart(m, { id: "body", color: [1, 0.4, 0.2, 1], mesh: { vertices: [0, 0, 4, 0, 4, 4, 0, 4], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] } });
  addPart(m, { id: "head", parent: "headDeformer", color: [0.2, 0.6, 1, 1], mesh: { vertices: [0, 0, 4, 0, 4, 4, 0, 4], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] } });
  addDeformer(m, { id: "headDeformer", bindings: [{ parameter: "开心", channel: "rotation", from: 0, to: 15 }] });
  addWarp(m, "head", { parameter: "开心", keyforms: [{ value: 0, offsets: [0, 0, 0, 0, 0, 0, 0, 0] }, { value: 1, offsets: [0, -0.6, 0, -0.6, 0, -0.6, 0, -0.6] }] });
  addParameter(m, { id: "耳朵动", min: 0, max: 1, group: "Head" });
  setParamRange(m, "开心", -1, 1, 0);
  setParamGroup(m, "耳朵动", "Custom");
  embedTexture(m, "tex_00.png", PNG);
  attachTexture(m, "body", "tex_00.png");
  const v = validate(m);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
});

test("removePart 后 cascade order 重新编号且 pose 引用同步校验", () => {
  const m = createL2dm({ id: "x", parts: [{ id: "a", order: 0 }, { id: "b", order: 1 }, { id: "c", order: 2 }] });
  removePart(m, "b");
  assert.deepEqual(m.parts.map((p) => [p.id, p.order]), [["a", 0], ["c", 1]]);
  const v = validate(m);
  assert.equal(v.ok, true);
});

test("setParamRange 越界则校验失败，改正后通过（编辑与校验联动）", () => {
  const m = createL2dm({ id: "z", parameters: [{ id: "p", min: 0, max: 1 }] });
  setParamRange(m, "p", 0, 1, 5); // def=5 越界
  assert.equal(validate(m).ok, false);
  setParamRange(m, "p", 0, 10, 5); // 修正
  assert.equal(validate(m).ok, true);
});

test("createL2dm 缺省画布/参数友好", () => {
  const m = createL2dm({ id: "foo bar!" });
  assert.equal(m.id, "foo-bar");
  assert.equal(m.canvas.width, 32);
  assert.equal(validate(m).ok, true);
});

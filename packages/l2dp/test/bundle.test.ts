import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleProject, packL2dp, unpackL2dp, fromUtf8 } from "../src/index.ts";

test("组装→打包→解包→内容完整", async () => {
  const assembled = assembleProject({
    meta: { id: "p1", name: "测试角色", author: "tester", grade: "adult" },
    parts: [
      { id: "PARTS_01_face", name: "脸", category: "body", type: "face_skin", costumeGroup: null, parent: null, visible: true, drawOrder: 0, opacity: 1, blendMode: "normal", texturePage: 0, uvBounds: { x: 0, y: 0, w: 1, h: 1 }, diffs: [] },
      { id: "PARTS_01_adult_breast", name: "胸", category: "body", type: "breast", costumeGroup: null, parent: null, visible: true, drawOrder: 1, opacity: 1, blendMode: "normal", texturePage: 0, uvBounds: { x: 0, y: 0, w: 1, h: 1 }, diffs: [] },
      { id: "PARTS_01_outfit_top_001", name: "上衣", category: "clothing", type: "top", costumeGroup: 1, parent: null, visible: true, drawOrder: 2, opacity: 1, blendMode: "normal", texturePage: 0, uvBounds: { x: 0, y: 0, w: 1, h: 1 }, diffs: [] },
    ],
    meshes: [{ id: "m0", partId: "PARTS_01_face", vertices: [{ x: 0, y: 0, u: 0, v: 0 }, { x: 1, y: 0, u: 1, v: 0 }, { x: 0, y: 1, u: 0, v: 1 }], triangles: [0, 1, 2], weights: [] }],
    params: [
      { id: "PARAM_ANGLE_X", name: "角度X", standard: true, min: -30, max: 30, defaultValue: 0 },
      { id: "PARAM_ANGLE_Y", name: "角度Y", standard: true, min: -30, max: 30, defaultValue: 0 },
      { id: "PARAM_ANGLE_Z", name: "角度Z", standard: true, min: -30, max: 30, defaultValue: 0 },
      { id: "PARAM_EYE_L_OPEN", name: "左眼", standard: true, min: 0, max: 1, defaultValue: 1 },
      { id: "PARAM_EYE_R_OPEN", name: "右眼", standard: true, min: 0, max: 1, defaultValue: 1 },
      { id: "PARAM_MOUTH_OPEN_Y", name: "嘴", standard: true, min: 0, max: 1, defaultValue: 0 },
      { id: "PARAM_BODY_ANGLE_X", name: "体X", standard: true, min: -30, max: 30, defaultValue: 0 },
      { id: "PARAM_BODY_ANGLE_Y", name: "体Y", standard: true, min: -30, max: 30, defaultValue: 0 },
      { id: "PARAM_BODY_ANGLE_Z", name: "体Z", standard: true, min: -30, max: 30, defaultValue: 0 },
      { id: "PARAM_BUST_Y", name: "胸摆", standard: true, min: -10, max: 10, defaultValue: 0 },
      { id: "PARAM_HAIR_FRONT", name: "前发摆", standard: true, min: -10, max: 10, defaultValue: 0 },
      { id: "PARAM_HAIR_BACK", name: "后发摆", standard: true, min: -10, max: 10, defaultValue: 0 },
    ],
    textures: [new Uint8Array(64).fill(200)],
  });
  const report = await assembled.validate();
  assert.ok(report.ok, JSON.stringify(report.issues));

  const zip = packL2dp(assembled.files);
  assert.ok(zip.length > 0);
  const back = unpackL2dp(zip);
  assert.ok(back["manifest.json"], "解包含 manifest");
  assert.equal(fromUtf8(back["parts.json"]).includes("PARTS_01_adult_breast"), true, "成人部件保留");
  assert.equal(fromUtf8(back["params.json"]).includes("PARAM_BUST_Y"), true);
  assert.ok(back["textures/page_00.png"], "纹理页保留");
  assert.equal(back["textures/page_00.png"][0], 200);
});

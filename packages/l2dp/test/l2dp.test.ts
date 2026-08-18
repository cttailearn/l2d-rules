import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isStandardParam, validatePartId, buildPartId, parsePartId, validateManifest } from "../src/index.ts";
import type { Manifest, Part, Mesh, ParamDef, Groups, Motion } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const specJson = JSON.parse(readFileSync(join(here, "../../../specs/standard-params.json"), "utf8"));

test("标准参数白名单与 specs JSON 一致", () => {
  const jsons = specJson.standardIds as string[];
  const pkg = ["PARAM_ANGLE_X", "PARAM_EYE_L_OPEN", "PARAM_BUST_Y", "PARAM_HAIR_BACK"];
  assert.ok(jsons.length >= 32, "至少覆盖 Haru 32 参数");
  for (const id of jsons) assert.ok(isStandardParam(id), `在库中缺失: ${id}`);
  assert.ok(isStandardParam("PARAM_BUST_Y"));
  assert.ok(!isStandardParam("PARAM_NOPE"));
});

test("部件命名规则", () => {
  assert.ok(validatePartId("PARTS_01_face", "body").ok);
  assert.ok(validatePartId("PARTS_01_adult_breast", "body").ok);
  const c = validatePartId("PARTS_01_outfit_top_001", "clothing");
  assert.ok(c.ok, JSON.stringify(c.errs));
  const bad = validatePartId("PARTS_01_outfit_top", "clothing");
  assert.ok(!bad.ok, "服装层缺组号应报错");
  const bad2 = validatePartId("foo", "body");
  assert.ok(!bad2.ok);
  const g = buildPartId("outfit_top", { costumeGroup: 1 });
  assert.equal(g, "PARTS_01_outfit_top_001");
  assert.equal(parsePartId("PARTS_02_face_001")?.costumeGroup, 1);
});

test("manifest 校验（含成人部件）", () => {
  const manifest: Manifest = {
    schemaVersion: 2, id: "t", name: "t", author: "a", grade: "adult",
    displayInfo: { width: 1024, height: 1024, originX: 0, originY: 0, pixelsPerUnit: 1 },
    fileManifest: { textures: ["page_00.png"], parts: "", meshes: "", params: "", motions: "", expressions: "" },
  };
  const parts: Part[] = [
    { id: "PARTS_01_face", name: "脸", category: "body", type: "face_skin", costumeGroup: null, parent: null, visible: true, drawOrder: 0, opacity: 1, blendMode: "normal", texturePage: 0, uvBounds: { x: 0, y: 0, w: 1, h: 1 }, diffs: [] },
    { id: "PARTS_01_adult_genital", name: "阴部", category: "body", type: "genital", costumeGroup: null, parent: null, visible: true, drawOrder: 1, opacity: 1, blendMode: "normal", texturePage: 0, uvBounds: { x: 0, y: 0, w: 1, h: 1 }, diffs: [] },
    { id: "PARTS_01_outfit_top_001", name: "上衣", category: "clothing", type: "top", costumeGroup: 1, parent: null, visible: true, drawOrder: 2, opacity: 1, blendMode: "normal", texturePage: 0, uvBounds: { x: 0, y: 0, w: 1, h: 1 }, diffs: [] },
  ];
  const meshes: Mesh[] = [
    { id: "m0", partId: "PARTS_01_face", vertices: [{ x: 0, y: 0, u: 0, v: 0 }, { x: 1, y: 0, u: 1, v: 0 }, { x: 0, y: 1, u: 0, v: 1 }], triangles: [0, 1, 2], weights: [] },
  ];
  const params: ParamDef[] = [
    { id: "PARAM_ANGLE_X", name: "角度X", standard: true, min: -30, max: 30, defaultValue: 0 },
    { id: "PARAM_ANGLE_Y", name: "角度Y", standard: true, min: -30, max: 30, defaultValue: 0 },
    { id: "PARAM_ANGLE_Z", name: "角度Z", standard: true, min: -30, max: 30, defaultValue: 0 },
    { id: "PARAM_EYE_L_OPEN", name: "左眼开合", standard: true, min: 0, max: 1, defaultValue: 1 },
    { id: "PARAM_EYE_R_OPEN", name: "右眼开合", standard: true, min: 0, max: 1, defaultValue: 1 },
    { id: "PARAM_MOUTH_OPEN_Y", name: "口开合", standard: true, min: 0, max: 1, defaultValue: 0 },
    { id: "PARAM_BODY_ANGLE_X", name: "体转X", standard: true, min: -30, max: 30, defaultValue: 0 },
    { id: "PARAM_BODY_ANGLE_Y", name: "体转Y", standard: true, min: -30, max: 30, defaultValue: 0 },
    { id: "PARAM_BODY_ANGLE_Z", name: "体转Z", standard: true, min: -30, max: 30, defaultValue: 0 },
    { id: "PARAM_BUST_Y", name: "胸摆", standard: true, min: -10, max: 10, defaultValue: 0 },
    { id: "PARAM_HAIR_FRONT", name: "前发摆", standard: true, min: -10, max: 10, defaultValue: 0 },
    { id: "PARAM_HAIR_BACK", name: "后发摆", standard: true, min: -10, max: 10, defaultValue: 0 },
  ];
  const groups: Groups = { paramGroups: [{ target: "Parameter", name: "EyeBlink", ids: ["PARAM_EYE_L_OPEN"] }], partGroups: [] };
  const motions: Motion[] = [{ meta: { duration: 3, fps: 30, loop: true }, curves: [{ target: "Parameter", id: "PARAM_ANGLE_X", segments: [0, 0, 1, 1] }] }];
  const v = validateManifest(manifest, parts, meshes, params, groups, motions, [], undefined);
  assert.ok(v.ok, JSON.stringify(v.issues, null, 2));
});

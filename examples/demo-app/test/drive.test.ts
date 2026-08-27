// drive.test.ts —— 「全功能演示」纯函数面（无 DOM）：按角色生成 JSONL 的判定矩阵
import { test } from "node:test";
import assert from "node:assert/strict";
import { driveFeature, type DriveHost, FEATURE_LABELS } from "../src/drive.ts";
import type { AppCharacter } from "../src/chars.ts";

function host(cfg: {
  params: string[];
  costumes?: AppCharacter["costumes"];
  motions?: AppCharacter["motions"];
  expressions?: AppCharacter["expressions"];
}): DriveHost {
  const character: AppCharacter = {
    id: "t", label: "T", file: "", kind: "semantic", desc: "", mouthParam: null,
    envOverrides: {}, presets: [],
    ...(cfg.motions ? { motions: cfg.motions } : {}),
    ...(cfg.expressions ? { expressions: cfg.expressions } : {}),
    ...(cfg.costumes ? { costumes: cfg.costumes } : {}),
  };
  const values: Record<string, number> = {};
  for (const p of cfg.params) values[p] = 0;
  return {
    character,
    params: () => values,
    setOutfit: (g) => [JSON.stringify({ op: "set", sem: "衣装组" + g, value: 1 })],
  };
}

test("drive: rig 角色（腿摆/身摆/服装组）——行走/换装/点头可用，微笑不可用", () => {
  const h = host({
    params: ["呼吸", "身转", "头转向", "头点头", "身摆", "腿摆", "衣装组1", "衣装组2"],
    costumes: [
      { group: 1, param: "衣装组1", partIds: ["a"] },
      { group: 2, param: "衣装组2", partIds: ["b"] },
    ],
  });
  const walk = driveFeature(h, "walk")!;
  assert.equal(walk.label, "行走（腿摆/身摆 步态）");
  assert.deepEqual(walk.lines, ['{"op":"play","asset":"walk"}', '{"op":"set","sem":"身摆","value":0.3}']);
  assert.ok(driveFeature(h, "outfit1"));
  assert.ok(driveFeature(h, "outfit2"));
  assert.equal(driveFeature(h, "outfit1")!.label, "换装·组1");
  assert.ok(driveFeature(h, "nod")!.lines.some((l) => l.includes("头点头")));
  assert.equal(driveFeature(h, "smile"), null, "无嘴部部件/表情 → 微笑不可用");
});

test("drive: 语义角色（play/face 资产）——微笑走 face，点头不可用", () => {
  const h = host({
    params: ["微笑", "尾巴摆", "头转向"],
    motions: {
      微笑点头: { durationMs: 1000, loop: true, curves: [{ id: "微笑", segments: [0, 0, 0, 0.5, 1, 0, 1, 0] }] },
    },
    expressions: { 开心: { parameters: [{ id: "微笑", value: 0.3, blend: "Add" }] } },
  });
  const smile = driveFeature(h, "smile")!;
  assert.equal(smile.label, "脸部·微笑（face 开心）");
  assert.ok(smile.lines[0]!.includes('"face"'));
  assert.equal(driveFeature(h, "nod"), null, "无 头点头/ParamAngleY → 点头不可用");
  assert.equal(driveFeature(h, "outfit1"), null, "无服装组 → 换装不可用");
});

test("drive: 创作角色（walk/blink/surprise 动作资产）——优先走 play", () => {
  const mk = (name: string) => ({ durationMs: 900, loop: name === "walk", curves: [{ id: "头转向", segments: [0, 0, 0, 1, 0] }] });
  const h = host({
    params: ["头转向", "头点头", "腿摆", "嘴开", "眼闭左", "眼闭右", "眉左升", "眉右升"],
    motions: { walk: mk("walk"), blink: mk("blink"), surprise: mk("surprise") },
  });
  assert.deepEqual(driveFeature(h, "walk")!.lines, ['{"op":"play","asset":"walk"}']);
  assert.deepEqual(driveFeature(h, "blink")!.lines, ['{"op":"play","asset":"blink"}']);
  assert.deepEqual(driveFeature(h, "surprised")!.lines, ['{"op":"play","asset":"surprise"}']);
  assert.ok(driveFeature(h, "open")!.lines.some((l) => l.includes("嘴开")));
});

test("drive: reset / 未知功能 / 标签表", () => {
  const h = host({ params: ["头转向"] });
  assert.equal(driveFeature(h, "reset")!.label, "复位参数");
  assert.deepEqual(driveFeature(h, "reset")!.lines, []);
  assert.equal(driveFeature(h, "whatever"), null);
  assert.ok(FEATURE_LABELS["walk"] && FEATURE_LABELS["surprised"]);
});

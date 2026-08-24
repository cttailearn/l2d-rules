// demo-p4b A5：全链自动化断言——原图→拆解→LLM 标注(mock)→自修复绑定→驱动→渲染（确定性，CI 可复现）
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ColorKeySegmenter, encodePng } from "@l2dp/cutout";
import { createWithSelfRepair, RuleReviewer } from "@l2dp/create";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator } from "@l2dp/driver";
import { LlmLabeler } from "@l2dp/host";

// 透明底立绘（内存绘制）
const W = 320, H = 400;
const img = { width: W, height: H, data: new Uint8Array(W * H * 4) };
const SHAPES = [
  [20, 20, 180, 120, [60, 55, 90], "hair_back", "left"],
  [120, 70, 120, 130, [214, 188, 162], "face", "left"],
  [150, 60, 110, 122, [96, 84, 130], "hair_front", "left"],
  [200, 160, 48, 24, [240, 196, 192], "eye", "left"],
  [210, 192, 40, 22, [196, 108, 120], "mouth", "left"],
  [96, 200, 120, 80, [120, 150, 205], "body_upper", "left"],
];
for (const [x, y, w, h, c] of SHAPES) {
  for (let yy = y; yy < Math.min(y + h, H); yy++) {
    for (let xx = x; xx < Math.min(x + w, W); xx++) {
      const o = (yy * W + xx) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
}

// 确定性 mock LLM 标注器（与 bridge-llm.mjs 同哲学：宿主接真实模型时替换）
const truth = SHAPES.map((s) => ({ sem: s[5], side: s[6] }));
const mockProvider = {
  capabilities() { return { structured: "text" }; },
  async createCompletion(req) {
    const content = req.messages[req.messages.length - 1].content;
    const ids = [...content.matchAll(/\[(r\d+)\]/g)].map((m) => m[1]);
    const assignments = ids.map((id, i) => ({ candidateId: id, semantic: truth[i % truth.length].sem, side: truth[i % truth.length].side }));
    return { text: JSON.stringify({ assignments }), finishReason: "stop" };
  },
};

test("A5: 全链——原图→拆解→LLM 标注→自修复→绑定→驱动→渲染", async () => {
  const labeler = new LlmLabeler({ provider: mockProvider });
  const outcome = await createWithSelfRepair({
    character: "a5-chan", image: img, canvas: { width: W, height: H },
    segmenter: new ColorKeySegmenter({ tol: 8, minArea: 60 }),
    labeler,
    reviewer: new RuleReviewer(),
    maxRounds: 3,
  });
  assert.equal(outcome.ok, true, "日志:\n" + outcome.log.join("\n") + "\n问题:" + outcome.issues.join(";"));
  const { model, rig, motions } = outcome.result!;
  assert.ok(rig.report.ok, "rig 校验通过");
  assert.ok(model.parts.length >= 5, "部件数 ≥5");
  assert.ok(motions.length >= 1, "动作资产 ≥1");

  // 引擎直驱 + 渲染（预览帧哈希确定性）
  const sw = new SoftwareRenderer();
  const player = new L2dmPlayer(model, new Map());
  player.render(sw);
  const h1 = createHash("sha256").update(sw.readPixels()!).digest("hex");
  player.params.reset(); player.render(sw);
  const h2 = createHash("sha256").update(sw.readPixels()!).digest("hex");
  assert.equal(h1, h2, "渲染确定性（同 rest 同哈希）");

  // JSONL 驱动栈（play 动作 + 环境层）→ 帧参数有非默认变化
  const defs = model.parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def, group: p.group }));
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed: 7 });
  const ing = new StreamIngestor({
    manifest: { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) },
    library: { motions: motions.map((m) => ({ name: m.name })), expressions: [], behaviors: [] },
    assets: { motions: new Map(motions.map((m) => [m.name, m.motion])), expressions: new Map() },
    stack, env, seed: 7,
  });
  let anyNonDefault = false;
  const ev = new Evaluator(stack, env, defs, { apply(_c, p) {
    for (const d of defs) if (Math.abs((p[d.id] ?? 0) - (d.def ?? 0)) > 1e-6) anyNonDefault = true;
  } });
  const idle = motions.find((m) => m.name === "idle");
  if (idle) ing.feedLine(JSON.stringify({ op: "play", asset: idle.name }), 0);
  for (let i = 0; i < 20; i++) ev.onFrame(16);
  assert.equal(anyNonDefault, true, "驱动后参数面有非默认变化");
  void encodePng;
});
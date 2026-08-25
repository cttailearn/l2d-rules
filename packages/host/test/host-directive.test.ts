// @l2dp/host P4 LLM 创作通道测试：sanitizeCreationDirective / LlmDesigner（few-shot）/ LlmRepairer（自修复）
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePng, pngToDataUri, type CutoutPart, type RgbaImage } from "@l2dp/cutout";
import { validateCreation, type CreationDirective } from "@l2dp/create";
import type { ChatRequest, ChatResult, RuntimeProvider } from "@l2dp/driver";
import {
  LlmDesigner,
  LlmRepairer,
  buildDesignPrompt,
  buildRepairPrompt,
  dominantColorOfPart,
  sanitizeCreationDirective,
  semanticPaletteColor,
} from "../src/index.ts";

class StubProvider implements RuntimeProvider {
  structured: unknown;
  lastReq: ChatRequest | null = null;
  calls = 0;
  capabilities(): { structured: "text" } { return { structured: "text" }; }
  async createCompletion(req: ChatRequest): Promise<ChatResult> {
    this.calls++;
    this.lastReq = req;
    return { text: JSON.stringify(this.structured), structured: this.structured, finishReason: "stop" };
  }
}

function solidRectPart(id: string, semantic: string, x: number, y: number, w: number, h: number, rgb: [number, number, number]): CutoutPart {
  const img = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) };
  for (let yy = y; yy < Math.min(y + h, 64); yy++) {
    for (let xx = x; xx < Math.min(x + w, 64); xx++) {
      const o = (yy * 64 + xx) * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
  }
  const uri = pngToDataUri(encodePng(64, 64, img.data));
  return { id, semantic, bbox: { x, y, width: w, height: h }, confidence: 1, maskArea: w * h, image: { dataUri: uri } };
}

const FACE = solidRectPart("r1", "face", 8, 8, 24, 24, [230, 180, 160]);
const EYE = solidRectPart("r2", "eye", 12, 12, 8, 8, [20, 20, 20]);

test("P4: dominantColorOfPart——从内嵌 PNG 提取主色（0..1）", () => {
  const c = dominantColorOfPart(FACE)!;
  assert.ok(c.length === 4);
  assert.ok(Math.abs(c[0] - 230 / 255) < 0.05, "R≈230/255 actual=" + c[0]);
  assert.equal(c[3], 1);
});

test("P4: sanitizeCreationDirective——坏字段确定性清洗（钳 bbox/补色/滤非法帧/去 image）", () => {
  const raw = {
    v: 1, character: "c", canvas: { width: 64, height: 64 },
    parts: [
      { id: "p1", semantic: "face", bbox: { x: -5, y: 100, width: -3, height: 9 }, color: [9, 0.5, 0.5, 0.5] },
      { id: "p2", semantic: "eye", bbox: { x: 10, y: 10, width: 8, height: 8 } },
    ],
    motions: [{ name: "", kind: "weird", durationMs: -1, curves: [{ param: "微笑", keys: [[2, 0], [1, 1], [3, 0]] }] }],
  };
  const d = sanitizeCreationDirective(raw, { character: "c", canvas: { width: 64, height: 64 } });
  assert.equal(d.v, 1);
  assert.equal(d.parts.length, 2);
  const p1 = d.parts[0]!;
  assert.ok(p1.bbox.x >= 0 && p1.bbox.width >= 1, "bbox 钳制入画布");
  assert.ok((p1 as { image?: unknown }).image === undefined, "不保留 image");
  assert.deepEqual(p1.color, [9, 0.5, 0.5, 0.5].map((v) => Math.min(1, Math.max(0, v))) as never); // 越界色已钳
  assert.equal(d.motions![0]!.kind, "idle", "非法 kind 回退 idle");
  assert.equal(d.motions![0]!.durationMs, 4000);
  assert.deepEqual(d.motions![0]!.curves[0]!.keys, [[2, 0], [3, 0]], "关键帧 t 递增过滤（丢弃回退帧，保持原序）");
});

test("P4: semanticPaletteColor——确定性（同语义同色）", () => {
  assert.deepEqual(semanticPaletteColor("face"), semanticPaletteColor("face"));
});

test("P4: LlmDesigner——few-shot：候选 → 结构指令 → 主色/调色板兜底并可通过校验", async () => {
  const provider = new StubProvider();
  provider.structured = {
    v: 1, character: "mychan", canvas: { width: 64, height: 64 },
    parts: [
      { id: "r1", semantic: "face", bbox: { x: 8, y: 8, width: 24, height: 24 } },
      { id: "r2", semantic: "eye", side: "left", bbox: { x: 12, y: 12, width: 8, height: 8 } },
    ],
    hinge: { x: 32, y: 50 }, physics: true,
    motions: [{ name: "idle", kind: "idle", loop: true, durationMs: 4000, curves: [{ param: "微笑", keys: [[0, 0], [2, 1], [4, 0]] }] }],
  };
  const designer = new LlmDesigner({ provider });
  const d = await designer.design({ character: "mychan", canvas: { width: 64, height: 64 }, parts: [FACE, EYE], image: { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) } });
  assert.equal(designer.name, "llm");
  assert.equal(d.character, "mychan");
  assert.equal(d.parts.length, 2);
  assert.ok(d.parts.every((p) => Array.isArray(p.color) && (p as { image?: unknown }).image === undefined), "全部转 color 表达");
  const face = d.parts.find((p) => p.id === "r1")!;
  assert.ok(Math.abs(face.color![0] - 230 / 255) < 0.05, "face 用主色兜底");
  assert.ok(provider.lastReq!.messages.find((m) => m.role === "user")!.content.includes("切图候选"), "提示词含候选");
  const issues = validateCreation(d);
  assert.deepEqual(issues, [], "设计产物应直接通过创作校验：" + JSON.stringify(issues));
});

test("P4: LlmRepairer——问题回注 → LLM 修正指令（异步 Repairer 契约）", async () => {
  const provider = new StubProvider();
  provider.structured = { v: 1, character: "c", canvas: { width: 64, height: 64 }, parts: [{ id: "p1", semantic: "face", bbox: { x: 2, y: 2, width: 10, height: 10 }, color: [1, 0.8, 0.8, 1] }] };
  const repairer = new LlmRepairer({ provider });
  const broken: CreationDirective = { v: 1, character: "c", canvas: { width: 64, height: 64 }, parts: [] };
  const r = await repairer.repair(broken, [{ rule: "PARTS_EMPTY", path: "parts", message: "至少需要一个部件" }]);
  assert.equal(repairer.name, "llm");
  assert.ok(r.fixes.length >= 1);
  assert.equal(r.directive.parts.length, 1);
  assert.ok((r.directive.parts[0] as { image?: unknown }).image === undefined);
  assert.ok(provider.lastReq!.messages.find((m) => m.role === "user")!.content.includes("校验问题"));
});

test("P4: buildDesignPrompt/buildRepairPrompt smoke", () => {
  const dp = buildDesignPrompt({ character: "c", canvas: { width: 64, height: 64 }, parts: [FACE] });
  assert.ok(dp.includes("[r1]") && dp.includes("CreationDirective"));
  const rp = buildRepairPrompt({ v: 1, character: "c", parts: [] }, [{ rule: "PARTS_EMPTY", path: "parts", message: "x" }]);
  assert.ok(rp.includes("PARTS_EMPTY"));
});

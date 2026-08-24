// @l2dp/host P4c 测试：HttpClient / ComfyUI 桥 / HttpSegmenter / LlmLabeler / LlmReviewer / P4c 装配 / mask 辅助
import { test } from "node:test";
import assert from "node:assert/strict";
import { ColorKeySegmenter, encodePng, decodePng, type RgbaImage } from "@l2dp/cutout";
import { HttpClient, HttpError } from "../src/http.ts";
import { ComfyUIBridge, maskRgbaToCandidate } from "../src/comfyui.ts";
import { HttpSegmenter } from "../src/http-segmenter.ts";
import { LlmLabeler } from "../src/llm-labeler.ts";
import { LlmReviewer } from "../src/llm-reviewer.ts";
import { labelResponseSchema, buildLabelPrompt, buildReviewPrompt, reviewResponseSchema } from "../src/llm.ts";
import { buildP4cBridges } from "../src/host.ts";
import type { ChatMessage, ChatRequest, ChatResult, RuntimeProvider } from "@l2dp/driver";

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetchStub(handler: (url: string, init: RequestInit, bodyText: string) => Response): (url: string, init: RequestInit) => Promise<Response> {
  return async (url, init) => handler(url, init, typeof init?.body === "string" ? init.body : "");
}

function solid(w: number, h: number, r: number, g: number, b: number, a = 0): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i*4]=r; data[i*4+1]=g; data[i*4+2]=b; data[i*4+3]=a; }
  return { width: w, height: h, data };
}
function rectIn(img: RgbaImage, x: number, y: number, w: number, h: number, r: number, g: number, b: number, a = 255): void {
  for (let yy = y; yy < Math.min(y + h, img.height); yy++) {
    for (let xx = x; xx < Math.min(x + w, img.width); xx++) {
      const o = (yy * img.width + xx) * 4;
      img.data[o]=r; img.data[o+1]=g; img.data[o+2]=b; img.data[o+3]=a;
    }
  }
}

class StubProvider implements RuntimeProvider {
  lastReq: ChatRequest | null = null;
  structured: unknown;
  calls = 0;
  capabilities(): { structured: "text" } { return { structured: "text" }; }
  async createCompletion(req: ChatRequest): Promise<ChatResult> {
    this.calls++;
    this.lastReq = req;
    return { text: JSON.stringify(this.structured), structured: this.structured, finishReason: "stop" };
  }
}

test("P4c: HttpClient——GET/POST/URL 拼接/非 2xx 抛 HttpError", async () => {
  const calls: string[] = [];
  const fx = fetchStub((url, _init, body) => {
    calls.push(url + "|body=" + body);
    if (url.endsWith("/boom")) return jsonResp({ e: 1 }, 500);
    return jsonResp({ ok: true });
  });
  const http = new HttpClient({ baseUrl: "https://svc.example", fetcher: fx });
  const g = await http.getJson<{ ok: boolean }>("/health");
  assert.equal(g.ok, true);
  assert.equal(calls[0]!.startsWith("https://svc.example/health"), true);
  const p = await http.postJson<{ ok: boolean }>("/seg", { image: "data:" });
  assert.equal(p.ok, true);
  assert.equal(calls[1]!.includes("data:"), true);
  await assert.rejects(() => http.getJson("/boom"), HttpError);
});

test("P4c: ComfyUIBridge——提交/轮询/收集图片/imageUrl/fetchImage 解码", async () => {
  // 1x1 红点 mask PNG
  const mask = solid(2, 2, 255, 0, 0, 255);
  const maskBytes = encodePng(2, 2, mask.data);
  const passPNG = String.fromCharCode(...maskBytes);
  const fx = fetchStub((url, _init) => {
    if (url.endsWith("/prompt")) return jsonResp({ prompt_id: "p1" });
    if (url.includes("/history/p1")) {
      return jsonResp({ p1: { outputs: { "9": { images: [{ filename: "m0.png", type: "temp" }] } }, status: { completed: true, status_str: "success" } } });
    }
    if (url.includes("/view")) return new Response(passPNG, { status: 200 });
    return jsonResp({}, 404);
  });
  const bridge = new ComfyUIBridge({ baseUrl: "http://cf.example:8188", fetchImpl: fx, clientId: "t", pollMs: 1 });
  const id = await bridge.submit({ dummy: true });
  assert.equal(id, "p1");
  const run = await bridge.run({ dummy: true });
  assert.equal(run.completed, true);
  assert.equal(run.images.length, 1);
  assert.equal(run.images[0]!.filename, "m0.png");
  assert.equal(bridge.imageUrl({ filename: "m0.png", type: "temp" }).includes("filename=m0.png"), true);
  const rgba = await bridge.fetchImage({ filename: "m0.png" });
  assert.equal(rgba.width, 2);
  assert.equal(rgba.data[0], 255);
});

test("P4c: maskRgbaToCandidate——mask/bbox/color", () => {
  const img = solid(20, 20, 0, 0, 0, 0);
  rectIn(img, 5, 6, 8, 8, 10, 20, 30, 255);
  const cand = maskRgbaToCandidate(img, "m", 0.9);
  assert.deepEqual(cand.bbox, { x: 5, y: 6, width: 8, height: 8 });
  assert.equal(cand.mask!.length, 400);
  assert.equal(cand.mask![6 * 20 + 5], 1);
  assert.deepEqual(cand.color, [10, 20, 30]);
  assert.equal(cand.confidence, 0.9);
});

test("P4c: HttpSegmenter——mask PNG 候选 + bbox 兜底", async () => {
  const mask = solid(16, 16, 0, 0, 0, 0);
  rectIn(mask, 2, 2, 6, 6, 200, 100, 50, 255);
  const maskUri = "data:image/png;base64," + Buffer.from(encodePng(16, 16, mask.data)).toString("base64");
  const fx = fetchStub((_url, _init, bodyText) => {
    const b = JSON.parse(bodyText);
    assert.ok(Boolean(b.image) && String(b.image).startsWith("data:image/png;base64,"));
    return jsonResp({ regions: [
      { id: "r1", bbox: { x: 2, y: 2, width: 6, height: 6 }, maskPng: maskUri, confidence: 0.95 },
      { id: "r2", bbox: { x: 10, y: 10, width: 4, height: 4 }, color: [1, 2, 3] },
    ] });
  });
  const seg = new HttpSegmenter({ url: "http://seg.example/cut", fetchImpl: fx });
  const cands = await seg.segment(mask);
  assert.equal(cands.length, 2);
  assert.deepEqual(cands[0]!.bbox, { x: 2, y: 2, width: 6, height: 6 });
  const c2 = cands[1]!;
  assert.equal(c2.mask![12 * 16 + 11], 1);
});

test("P4c: LlmLabeler——provider 结构化输出 → CutoutPart", async () => {
  const img = solid(64, 64, 0, 0, 0, 0);
  rectIn(img, 8, 8, 20, 20, 220, 50, 60, 255);
  rectIn(img, 8, 40, 20, 20, 40, 160, 90, 255);
  const seg = new ColorKeySegmenter({ tol: 8, minArea: 40 });
  const cands = await seg.segment(img);
  assert.equal(cands.length, 2);
  const provider = new StubProvider();
  provider.structured = { assignments: [
    { candidateId: cands[0]!.id, semantic: "face" },
    { candidateId: cands[1]!.id, semantic: "eye", side: "left" },
    { candidateId: "ghost", semantic: "mouth" }, // 不存在的候选 → 忽略
  ] };
  const labeler = new LlmLabeler({ provider });
  const parts = await labeler.label(cands, img);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => p.semantic).sort(), ["eye", "face"]);
  assert.equal(parts.find((p) => p.semantic === "eye")!.side, "left");
  assert.ok(provider.lastReq !== null);
  const user = provider.lastReq.messages.find((m) => m.role === "user")!.content;
  assert.ok(user.includes("候选区"), "提示词应含候选区");
  assert.ok(user.includes("[" + cands[0]!.id + "]"), "提示词应列出候选 id");
  assert.ok(user.includes("semantic"), "提示词应提示输出语义");
});

test("P4c: LlmReviewer——渲染帧 + 判定解析", async () => {
  const model = {
    formatVersion: 1,
    id: "t",
    canvas: { width: 48, height: 48 },
    parameters: [{ id: "头转向", min: -30, max: 30, def: 0, group: "Head" }],
    parts: [{ id: "face", order: 0, color: [1, 0.3, 0.3, 1], mesh: { vertices: [8, 8, 40, 8, 40, 40, 8, 40], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] } }],
  };
  const ok = new StubProvider();
  ok.structured = { ok: true, confidence: 0.9, issues: [], suggestions: [] };
  const reviewer = new LlmReviewer({ provider: ok });
  const verdict = await reviewer.review(model as never);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.confidence, 0.9);
  assert.ok(ok.lastReq!.messages.find((m) => m.role === "user")!.content.includes("data:image/png;base64"), "帧应作为 data URI 附入");

  const bad = new StubProvider();
  bad.structured = { ok: false, confidence: 0.3, issues: ["部件撕裂"], suggestions: ["修复网格"] };
  const reviewer2 = new LlmReviewer({ provider: bad });
  const v2 = await reviewer2.review(model as never);
  assert.equal(v2.ok, false);
  assert.deepEqual(v2.issues, ["部件撕裂"]);
});

test("P4c: Schema/提示词 smoke + buildP4cBridges 装配", async () => {
  const ls = labelResponseSchema() as { properties: Record<string, unknown> };
  assert.ok(ls.properties.assignments !== undefined);
  const rs = reviewResponseSchema() as { required: string[] };
  assert.ok(rs.required.includes("ok"));
  const prompt = buildLabelPrompt([{ id: "r1", bbox: { x: 0, y: 0, width: 5, height: 5 }, color: [1, 2, 3] }]);
  assert.ok(prompt.includes("[r1]"));
  const rp = buildReviewPrompt(["data:image/png;base64,abc"], "c1");
  assert.ok(rp.includes("c1"));

  const bridges = buildP4cBridges({
    segment: { url: "http://seg.example/x", authToken: "t" },
    llm: { provider: new StubProvider() },
    review: false,
  });
  assert.equal(bridges.segmenter.name, "http");
  assert.equal(bridges.labeler.name, "llm");
  assert.equal(bridges.reviewer, null);
  assert.throws(() => buildP4cBridges({ llm: { provider: new StubProvider() } }), /需要 segment/);
});

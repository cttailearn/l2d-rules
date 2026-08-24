// bridge-llm.mjs —— P4 收尾：真实 OpenAI 兼容 LLM 接线段（env 无 key 时确定性 mock 兜底）
// 分割(ColorKey 兜底) → 标注(LlmLabeler：真实 LLM 或 mock) → 自修复绑定 → 审核 → 出图
// 环境变量：LLM_API_KEY / LLM_BASE_URL / LLM_MODEL（缺 key → mock 走确定性路径并打印提示）
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ColorKeySegmenter, encodePng } from "@l2dp/cutout";
import { createWithSelfRepair, RuleReviewer } from "@l2dp/create";
import { OpenAIProvider } from "@l2dp/driver";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { LlmLabeler, LlmReviewer } from "@l2dp/host";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
await mkdir(OUT, { recursive: true });

// ---------- 场景（透明底立绘） ----------
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
      img.data[o]=c[0]; img.data[o+1]=c[1]; img.data[o+2]=c[2]; img.data[o+3]=255;
    }
  }
}

// ---------- LLM 通道：真实 OpenAI 兼容 or 确定性 mock ----------
const key = process.env.LLM_API_KEY;
const mode = key ? "真实 LLM (" + (process.env.LLM_MODEL ?? "gpt-4o") + ")" : "确定性 mock（未设 LLM_API_KEY）";
console.log("[bridge-llm] LLM 通道 = " + mode);

let provider;
if (key) {
  provider = new OpenAIProvider({ baseUrl: process.env.LLM_BASE_URL, apiKey: key, model: process.env.LLM_MODEL ?? "gpt-4o" });
} else {
  // mock：从提示词提取候选 id，按 SHAPES 真值轮转（演示性确定性；宿主接入真实模型时替换）
  const truth = SHAPES.map((s) => ({ sem: s[5], side: s[6] }));
  provider = {
    capabilities() { return { structured: "text" }; },
    async createCompletion(req) {
      const ids = [...req.messages.at(-1).content.matchAll(/\[(r\d+)\]/g)].map((m) => m[1]);
      const assignments = ids.map((id, i) => ({ candidateId: id, semantic: truth[i % truth.length].sem, side: truth[i % truth.length].side }));
      return { text: JSON.stringify({ assignments }), finishReason: "stop" };
    },
  };
}

// 标注走 LLM；审核：真实多模态端点用 LlmReviewer，否则规则兜底
const labeler = new LlmLabeler({ provider });
const reviewer = key ? new LlmReviewer({ provider }) : new RuleReviewer();

const outcome = await createWithSelfRepair({
  character: "llm-chan",
  image: img,
  canvas: { width: W, height: H },
  segmenter: new ColorKeySegmenter({ tol: 8, minArea: 60 }),
  labeler,
  reviewer,
  maxRounds: 3,
});

await writeFile(join(OUT, "41-llm-model.l2dm"), JSON.stringify(outcome.result ? outcome.result.model : {}), "utf8");
if (outcome.result) {
  const player = new L2dmPlayer(outcome.result.model, new Map());
  const sw = new SoftwareRenderer();
  player.render(sw);
  await writeFile(join(OUT, "41-llm-preview.png"), Buffer.from(encodePng(W, H, sw.readPixels())));
}
console.log(outcome.log.join("\n"));
console.log("ok=" + outcome.ok + " parts=" + outcome.directive.parts.length + " motions=" + (outcome.result ? outcome.result.motions.length : 0) + " → out/41-llm-model.l2dm");

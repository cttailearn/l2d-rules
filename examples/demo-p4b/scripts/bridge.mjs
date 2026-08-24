// bridge.mjs —— P4c 宿主桥接演示：真实 HTTP 分割服务(HttpSegmenter) + LLM 标注/审核(LlmLabeler/LlmReviewer, mock provider) → createWithSelfRepair
// 与 run.mjs 的纯 SDK 链路不同：分割/标注/审核都走'宿主桥接'（HTTP + provider 注入），证明 @l2dp/host 骨架可在真实服务环下驱动全链。
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ColorMapLabeler, encodePng } from "@l2dp/cutout";
import { createWithSelfRepair, RuleReviewer } from "@l2dp/create";
import { HttpSegmenter, LlmLabeler } from "@l2dp/host";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
await mkdir(OUT, { recursive: true });

// ---------- 画布与场景（透明底，模拟已抠图上传统一局） ----------
const W = 320, H = 400;
const img = { width: W, height: H, data: new Uint8Array(W * H * 4) };
const SHAPES = [
  [20, 20, 180, 120, [60, 55, 90], "hair_back"],
  [120, 70, 120, 130, [214, 188, 162], "face"],
  [150, 60, 110, 122, [96, 84, 130], "hair_front"],
  [200, 160, 40, 22, [240, 204, 190], "eye"],
  [198, 146, 44, 26, [202, 176, 210], "eye"],
  [210, 192, 36, 22, [182, 96, 94], "mouth"],
  [96, 200, 120, 80, [120, 150, 205], "body_upper"],
];
for (const [x, y, w, h, c] of SHAPES) {
  for (let yy = y; yy < Math.min(y + h, H); yy++) {
    for (let xx = x; xx < Math.min(x + w, W); xx++) {
      const o = (yy * W + xx) * 4;
      img.data[o]=c[0]; img.data[o+1]=c[1]; img.data[o+2]=c[2]; img.data[o+3]=255;
    }
  }
}

// ---------- 1. 真实本地 HTTP 分割服务（宿主骨架契约的占位实现：POST /cut → {regions}） ----------
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    if (req.url === "/cut" && req.method === "POST") {
      // 占位：真实宿主这里跑 U2Net/SAM2 返回候选掩码；demo 用形状 bbox 直接应答
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ regions: sampleRegions() }));
    } else {
      res.writeHead(404); res.end("not found");
    }
  });
});
function sampleRegions() {
  return SHAPES.map(([x, y, w, h, c], i) => ({ id: "http-r" + (i + 1), bbox: { x, y, width: w, height: h }, color: c, confidence: 0.9 }));
}
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
console.log("[bridge] 宿主分割服务 http://127.0.0.1:" + port + "/cut 已启动");

// ---------- 2. LLM（mock provider）：标注 + 审核 ----------
const SEMS = ["hair_back", "face", "hair_front", "eye", "eye", "mouth", "body_upper"];
const provider = {
  idx: 0,
  capabilities() { return { structured: "text" }; },
  async createCompletion(req) {
    // 演示性确定性 LLM：从提示词提取候选 id，逐一给语义（宿主接真实模型时替换此处）
    const ids = [...req.messages.at(-1).content.matchAll(/\[(http-r\d+)\]/g)].map((m) => m[1]);
    return {
      text: JSON.stringify({ assignments: ids.map((id, i) => ({ candidateId: id, semantic: SEMS[i % SEMS.length], side: SEMS[i % SEMS.length] === "eye" ? (i % 2 === 0 ? "left" : "right") : undefined })) }),
      finishReason: "stop",
    };
  },
};
const labeler = new LlmLabeler({ provider });
const reviewer = new RuleReviewer(); // 审核用确定规则（也可换 LlmReviewer({provider}) 走多模态）

// ---------- 3. 自修复全链（走宿主桥接的 Segmenter + LLM Labeler） ----------
const segmenter = new HttpSegmenter({ url: "http://127.0.0.1:" + port + "/cut" });
const outcome = await createWithSelfRepair({
  character: "bridge-chan",
  image: img,
  canvas: { width: W, height: H },
  segmenter,
  labeler,
  reviewer,
  maxRounds: 3,
});
await writeFile(join(OUT, "31-bridge-model.l2dm"), JSON.stringify(outcome.result ? outcome.result.model : {}), "utf8");
await writeFile(join(OUT, "32-bridge-report.txt"), outcome.log.join("\n") + "\n", "utf8");
console.log(outcome.log.join("\n"));
console.log("ok=" + outcome.ok + " parts=" + outcome.directive.parts.length + " motions=" + (outcome.result ? outcome.result.motions.length : 0));
server.close();

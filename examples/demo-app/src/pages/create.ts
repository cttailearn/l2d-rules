// pages/create.ts —— 界面②「人物创建」浏览器入口
// 从「用户上传的真实 PNG 立绘」构建可驱动 Live2D（cutout → create → rig → engine）。
// - 不使用任何内置合成示例：未上传真实图像前「构建」不可用。
// - 上传后做质量预检（候选区数量/覆盖率）并友好提示。
// - 可接入真实服务（@l2dp/host：HttpSegmenter + LLM 标注/审核）提升复杂图效果。
// - 构建成功可下载成品 .l2dm（自包含）到本地 / 或保存到 sessionStorage 供其他页用。
import { ColorKeySegmenter, decodePng, type Labeler, type RgbaImage, type Segmenter } from "@l2dp/cutout";
import { SoftwareRenderer, L2dmPlayer, type EngineMotion, type L2dmModel, type Tex2D } from "@l2dp/engine";
import { OpenAIProvider } from "@l2dp/driver";
import { buildP4cBridges } from "@l2dp/host";
import type { RigReviewer } from "@l2dp/create";
import { buildFromImage, makeCreatedCharacter } from "../creator.ts";
import { decodeModelAtlas } from "../texture.ts";
import { saveCreated } from "../stage.ts";
import { need, needInput, needBtn } from "../dom.ts";

const dropEl = need("drop");
const tolEl = needInput("tol");
const minAreaEl = needInput("minArea");
const tolVEl = need("tolV");
const minAreaVEl = need("minAreaV");
const btnBuild = needBtn("btnBuild");
const btnDownload = need("btnDownload") as HTMLAnchorElement;
const chatLink = need("chatLink") as HTMLAnchorElement;
const featLink = need("featLink") as HTMLAnchorElement;
const cvSrc = need("cvSrc") as HTMLCanvasElement;
const cvCut = need("cvCut") as HTMLCanvasElement;
const cvModel = need("cvModel") as HTMLCanvasElement;
const createLogEl = need("createLog");
const createStatusEl = need("createStatus");

// 真实服务接入区
const hostEnable = need("hostEnable") as HTMLInputElement;
const segUrl = needInput("segUrl");
const llmBase = needInput("llmBase");
const llmKey = needInput("llmKey");
const llmModel = needInput("llmModel");

const createdId = "created";
let currentSource: RgbaImage | null = null;

// ---------------- 画布助手 ----------------
function setImageRows(canvas: HTMLCanvasElement, img: RgbaImage): void {
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const id0 = ctx.createImageData(img.width, img.height);
  id0.data.set(img.data);
  ctx.putImageData(id0, 0, 0);
}

function logCreate(lines: string[], tone: "busy" | "ok" | "err" | "" = ""): void {
  createLogEl.className = "create-log" + (tone ? " " + tone : "");
  createLogEl.textContent = lines.join("\n");
}

function setSourceImage(img: RgbaImage): void {
  currentSource = img;
  setImageRows(cvSrc, img);
  cvCut.width = 240;
  cvCut.height = 320;
  cvModel.width = 240;
  cvModel.height = 320;
  btnBuild.disabled = false;
  btnBuild.textContent = "构建 Live2D";
  btnDownload.hidden = true;
  chatLink.hidden = true;
  featLink.hidden = true;
  cvModel.classList.remove("created-ok");
  createStatusEl.textContent = "" + img.width + "×" + img.height + " 真实图像已载入 → 点「构建 Live2D」";
  void precheck(img);
}

// ---------------- 质量预检（上传后即时） ----------------
async function precheck(img: RgbaImage): Promise<void> {
  const tol = Number(tolEl.value);
  const minArea = Number(minAreaEl.value);
  try {
    const regions = await new ColorKeySegmenter({ tol, minArea }).segment(img);
    const area = img.width * img.height;
    const cover = regions.reduce((s, r) => s + r.bbox.width * r.bbox.height, 0) / area;
    const tips: string[] = [];
    if (regions.length < 3) tips.push("候选区过少（图太素/接近单色）");
    if (regions.length > 70) tips.push("候选区过多（可能碎块，建议调大最小面积）");
    if (cover < 0.03) tips.push("前景覆盖过小（可能整底是纯色/需裁剪）");
    if (cover > 0.98) tips.push("覆盖近乎全图（可能是照片，建议开启真实服务）");
    createStatusEl.textContent =
      "预检：候选区 " + regions.length + " 件 · 覆盖 " + (cover * 100).toFixed(1) + "%" +
      (tips.length ? " → " + tips.join(" / ") : " ✓ 适合内置确定性链") +
      "（调「容差/最小面积」后再次上传或直接构建）";
  } catch (e) {
    createStatusEl.textContent = "预检失败（仍可构建）：" + (e as Error).message;
  }
}

function drawCut(img: RgbaImage, parts: readonly { bbox: { x: number; y: number; width: number; height: number } }[]): void {
  cvCut.width = img.width;
  cvCut.height = img.height;
  const ctx = cvCut.getContext("2d");
  if (!ctx) return;
  setImageRows(cvCut, img);
  const palette = [
    "#4d9fff", "#b18cff", "#7ee787", "#f85149", "#e3b341", "#56d4dd", "#ff9ad5", "#a3ff5e",
    "#ffd166", "#ef476f", "#06d6a0", "#118ab2", "#f78c6b", "#c792ea",
  ];
  parts.forEach((p, i) => {
    const color = palette[i % palette.length]!;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = color;
    ctx.fillRect(p.bbox.x, p.bbox.y, p.bbox.width, p.bbox.height);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.bbox.x + 0.5, p.bbox.y + 0.5, p.bbox.width, p.bbox.height);
  });
  ctx.globalAlpha = 1;
}

function drawModelPreview(model: L2dmModel, atlas: Map<string, Tex2D>, motion?: EngineMotion): void {
  const sw = new SoftwareRenderer();
  const player = new L2dmPlayer(model, atlas);
  if (motion) player.play(motion);
  for (let f = 0; f < 24; f++) player.tick(16);
  player.render(sw);
  const px = sw.readPixels();
  if (!px) return;
  cvModel.width = model.canvas.width;
  cvModel.height = model.canvas.height;
  const ctx = cvModel.getContext("2d");
  if (!ctx) return;
  const id0 = ctx.createImageData(model.canvas.width, model.canvas.height);
  id0.data.set(px);
  ctx.putImageData(id0, 0, 0);
  cvModel.classList.add("created-ok");
}

/** 友好化构建失败：从 outcome.log 里找原因类别，给出可操作建议。 */
function friendlyFailure(outcome: { cutout: { parts: unknown[]; coveragePct: number; overlapPct: number } }, log: readonly string[]): string[] {
  const j = log.join(" ");
  const reasons: string[] = [];
  if (outcome.cutout.parts.length < 3) reasons.push("切出的部件过少（立绘太素/同色区域粘连）。");
  if (outcome.cutout.overlapPct > 30) reasons.push("候选区重叠过高（部件相互盖住，可能语义标错）。");
  if (/越界|out of canvas|越界/.test(j)) reasons.push("存在越界部件。");
  if (/碎片|微部件|micro/.test(j)) reasons.push("存在碎片/微部件。");
  return reasons.length
    ? reasons
    : ["未能通过规则审核。"];
}

// ---------------- 构建 ----------------
async function onBuild(): Promise<void> {
  if (!currentSource) return;
  logCreate(["切图 + 标注 + 校验/自修复 + 绑定 + 动作生成中…"], "busy");
  btnBuild.disabled = true;
  const t0 = performance.now();
  try {
    const useHost = hostEnable.checked && segUrl.value.trim().length > 0;
    let segmenter: Segmenter | undefined;
    let labeler: Labeler | undefined;
    let reviewer: RigReviewer | null | undefined;
    if (useHost) {
      if (!llmKey.value.trim()) throw new Error("启用真实服务需要填写 LLM API Key（用于标注/审核）");
      const bridges = buildP4cBridges({
        segment: { url: segUrl.value.trim() },
        llm: { provider: new OpenAIProvider({ baseUrl: llmBase.value.trim() || undefined, apiKey: llmKey.value.trim(), model: llmModel.value.trim() || "gpt-4o-mini" }) },
      });
      segmenter = bridges.segmenter;
      labeler = bridges.labeler;
      reviewer = bridges.reviewer;
    }
    const outcome = await buildFromImage(currentSource, {
      tol: Number(tolEl.value),
      minArea: Number(minAreaEl.value),
      character: "created-app",
      maxRounds: 3,
      segmenter,
      labeler,
      reviewer,
    });
    const ms = Math.round(performance.now() - t0);
    const head = `完成 ${ms}ms · ok=${outcome.ok} · 自修复 ${outcome.rounds}/3 轮 · ${useHost ? "真实服务" : "内置确定性链"}`;
    const cut = `候选→切图 ${outcome.cutout.parts.length} 件 · 覆盖率 ${outcome.cutout.coveragePct}% · 重叠 ${outcome.cutout.overlapPct}%`;
    if (outcome.ok && outcome.result) {
      const made = makeCreatedCharacter(createdId, outcome);
      if (!made) throw new Error("创作结果不可装配（角色为空）");
      const modelAtlas = decodeModelAtlas(outcome.result.model.atlas);
      drawCut(currentSource, outcome.cutout.parts);
      const idle = outcome.result.motions.find((x) => x.name === "idle");
      drawModelPreview(outcome.result.model, modelAtlas, idle?.motion);
      const modelText = JSON.stringify(outcome.result.model);
      saveCreated({ character: made.char, reactions: made.reactionLines, modelText });
      const fileName = "created-" + Date.now().toString(36) + ".l2dm";
      btnDownload.href = URL.createObjectURL(new Blob([modelText], { type: "application/json" }));
      btnDownload.download = fileName;
      btnDownload.hidden = false;
      logCreate(
        [head, cut, ...outcome.log, `✅ 已生成可驱动角色「我的创作」：${outcome.result.model.parts.length} 部件 / ${outcome.result.model.parameters.length} 参数 / 动作 ${outcome.result.motions.map((x) => x.name).join(",")}`],
        "ok",
      );
      chatLink.hidden = false;
      featLink.hidden = false;
      chatLink.href = "/?character=" + createdId;
      featLink.href = "/features.html?character=" + createdId;
      createStatusEl.textContent = "构建成功 → 下载 .l2dm / 去聊天 / 去全功能演示";
    } else {
      const reasons = friendlyFailure(outcome, outcome.log);
      logCreate(
        [head, cut, ...outcome.log, "❌ " + reasons.join(" "), "建议：换更清晰的平坦色立绘 · 调「容差/最小面积」 · 或开启下方「真实服务接入」用真实分割+LLM标注"],
        "err",
      );
      createStatusEl.textContent = "构建未通过（查看日志与建议）";
    }
  } catch (e) {
    logCreate(["构建失败: " + (e as Error).message, "若开启了「真实服务接入」，请检查分割服务 URL / LLM Key / 网络与 CORS。"], "err");
    createStatusEl.textContent = "构建失败";
  } finally {
    btnBuild.disabled = false;
    btnBuild.textContent = "构建 Live2D";
  }
}

// ---------------- 文件选择 + 拖拽（仅真实上传） ----------------
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "image/png,image/*";
fileInput.style.display = "none";
document.body.appendChild(fileInput);
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  void f.arrayBuffer().then((buf) => {
    try {
      setSourceImage(decodePng(new Uint8Array(buf)));
    } catch (err) {
      createStatusEl.textContent = "图片解码失败: " + (err as Error).message;
    }
  });
});
dropEl.addEventListener("click", () => fileInput.click());
dropEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});
for (const ev of ["dragover", "dragenter"]) {
  dropEl.addEventListener(ev, (e) => {
    e.preventDefault();
    dropEl.classList.add("dragover");
  });
}
for (const ev of ["dragleave", "drop"]) {
  dropEl.addEventListener(ev, (e) => {
    e.preventDefault();
    dropEl.classList.remove("dragover");
  });
}
dropEl.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  void f.arrayBuffer().then((buf) => {
    try {
      setSourceImage(decodePng(new Uint8Array(buf)));
    } catch (err) {
      createStatusEl.textContent = "图片解码失败: " + (err as Error).message;
    }
  });
});

// ---------------- 参数滑杆 / 真实服务开关 ----------------
tolEl.addEventListener("input", () => {
  tolVEl.textContent = String(tolEl.value);
  if (currentSource) void precheck(currentSource);
});
minAreaEl.addEventListener("input", () => {
  minAreaVEl.textContent = String(minAreaEl.value);
  if (currentSource) void precheck(currentSource);
});
hostEnable.addEventListener("change", () => {
  const on = hostEnable.checked;
  for (const id of ["segUrl", "llmBase", "llmKey", "llmModel"]) {
    const el = need(id) as HTMLInputElement;
    el.disabled = !on;
  }
});
btnBuild.addEventListener("click", () => void onBuild());

createStatusEl.textContent = "请上传一张真实 PNG 立绘以开始构建";

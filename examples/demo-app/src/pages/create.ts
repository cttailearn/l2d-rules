// pages/create.ts —— 界面②「人物创建」浏览器入口
// 从「用户上传的真实 PNG 立绘」构建可驱动 Live2D（cutout → create → rig → engine）。
// 不使用任何内置合成示例：未上传真实图像前构建按钮不可用。
import { decodePng, type RgbaImage } from "@l2dp/cutout";
import { SoftwareRenderer, L2dmPlayer, type EngineMotion, type L2dmModel, type Tex2D } from "@l2dp/engine";
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
const chatLink = need("chatLink") as HTMLAnchorElement;
const featLink = need("featLink") as HTMLAnchorElement;
const cvSrc = need("cvSrc") as HTMLCanvasElement;
const cvCut = need("cvCut") as HTMLCanvasElement;
const cvModel = need("cvModel") as HTMLCanvasElement;
const createLogEl = need("createLog");
const createStatusEl = need("createStatus");

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
  chatLink.hidden = true;
  featLink.hidden = true;
  cvModel.classList.remove("created-ok");
  logCreate([], "");
  createStatusEl.textContent = "" + img.width + "×" + img.height + " 真实图像已载入 → 点「构建 Live2D」";
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

// ---------------- 构建 ----------------
async function onBuild(): Promise<void> {
  if (!currentSource) return;
  logCreate(["切图 + 标注 + 校验/自修复 + 绑定 + 动作生成中…"], "busy");
  btnBuild.disabled = true;
  const t0 = performance.now();
  try {
    const outcome = await buildFromImage(currentSource, {
      tol: Number(tolEl.value),
      minArea: Number(minAreaEl.value),
      character: "created-app",
      maxRounds: 3,
      // 默认 PositionLabeler（任意真实上传）；复杂照片可注入 @l2dp/host 的真实 Segmenter/Labeler
    });
    const ms = Math.round(performance.now() - t0);
    const head = `完成 ${ms}ms · ok=${outcome.ok} · 自修复 ${outcome.rounds}/3 轮`;
    const cut = `候选→切图 ${outcome.cutout.parts.length} 件 · 覆盖率 ${outcome.cutout.coveragePct}% · 重叠 ${outcome.cutout.overlapPct}%`;
    if (outcome.ok && outcome.result) {
      const made = makeCreatedCharacter(createdId, outcome);
      if (!made) throw new Error("创作结果不可装配（角色为空）");
      const modelAtlas = decodeModelAtlas(outcome.result.model.atlas);
      drawCut(currentSource, outcome.cutout.parts);
      const idle = outcome.result.motions.find((x) => x.name === "idle");
      drawModelPreview(outcome.result.model, modelAtlas, idle?.motion);
      // 持久化到 sessionStorage，供「聊天助手 / 全功能演示」页作为「我的创作」复用
      saveCreated({ character: made.char, reactions: made.reactionLines, modelText: JSON.stringify(outcome.result.model) });
      logCreate(
        [head, cut, ...outcome.log, `✅ 已生成可驱动角色「我的创作」：${outcome.result.model.parts.length} 部件 / ${outcome.result.model.parameters.length} 参数 / 动作 ${outcome.result.motions.map((x) => x.name).join(",")}`],
        "ok",
      );
      chatLink.hidden = false;
      featLink.hidden = false;
      chatLink.href = "/?character=" + createdId;
      featLink.href = "/features.html?character=" + createdId;
      createStatusEl.textContent = "构建成功 → 去聊天 / 全功能演示用「我的创作」";
    } else {
      logCreate([head, cut, ...outcome.log, "❌ 未通过——调整容差/最小面积，或换一张更清晰的立绘"], "err");
      createStatusEl.textContent = "构建未通过（看日志）";
    }
  } catch (e) {
    logCreate(["构建失败: " + (e as Error).message], "err");
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

// ---------------- 参数滑杆 ----------------
tolEl.addEventListener("input", () => (tolVEl.textContent = String(tolEl.value)));
minAreaEl.addEventListener("input", () => (minAreaVEl.textContent = String(minAreaEl.value)));
btnBuild.addEventListener("click", () => void onBuild());

createStatusEl.textContent = "请上传一张真实 PNG 立绘以开始构建";

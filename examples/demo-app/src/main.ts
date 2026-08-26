// main.ts —— demo-app 浏览器入口（DOM 胶水）
// 组装「小型使用应用」：聊天输入 → AppCore（两跳决策 + 台词 + 说话口型 + SceneStage 渲染）→ 语音播报。
// 同一核心由 scripts/run.mjs（无头）与 test/app.test.ts（CI）共用。
import {
  SoftwareRenderer,
  createWebGL2Renderer,
  loadL2dm,
  L2dmPlayer,
  type EngineMotion,
  type GL2,
  type L2dmModel,
  type RenderSink,
  type Tex2D,
} from "@l2dp/engine";
import { decodePng, type RgbaImage } from "@l2dp/cutout";
import { AppCore, type ReplyOutcome, type SpeakNotice } from "./core.ts";
import { APP_CHARACTERS, CHARACTER_LIST, type AppCharacter, type Emotion } from "./chars.ts";
import { buildFromImage, makeCreatedCharacter, sampleImage, sampleLabeler } from "./creator.ts";
import { decodeModelAtlas } from "./texture.ts";

// ---------------- DOM ----------------
function need(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error("缺少 #" + id);
  return node;
}
const badgesEl = need("badges");
const charBtnsEl = need("charBtns");
const presetsEl = need("presets");
const outfitRow = need("outfitRow");
const outfitBtnsEl = need("outfitBtns");
const metricsEl = need("metrics");
const logEl = need("log");
const chatNameEl = need("chatName");
const chipsEl = need("chips");
const inputEl = need("input") as HTMLInputElement;
const sendBtn = need("send") as HTMLButtonElement;
const soundToggle = need("soundToggle");
const companionToggle = need("companionToggle");
const stageWrap = need("stageWrap");
const bubbleEl = need("bubble");
const zoomIn = need("zoomIn") as HTMLButtonElement;
const zoomOut = need("zoomOut") as HTMLButtonElement;
const chatStatsEl = need("chatStats");

// 创作面板（上传图像 → 构建 Live2D）
const dropEl = need("drop");
const tolEl = need("tol") as HTMLInputElement;
const minAreaEl = need("minArea") as HTMLInputElement;
const tolVEl = need("tolV");
const minAreaVEl = need("minAreaV");
const btnSample = need("btnSample") as HTMLButtonElement;
const btnBuild = need("btnBuild") as HTMLButtonElement;
const btnChat = need("btnChat") as HTMLButtonElement;
const cvSrc = need("cvSrc") as HTMLCanvasElement;
const cvCut = need("cvCut") as HTMLCanvasElement;
const cvModel = need("cvModel") as HTMLCanvasElement;
const createLogEl = need("createLog");
const createStatusEl = need("createStatus");

const STAGE_W = 560;
const STAGE_H = 720;
const FRAME_INTERVAL_MS = 33; // 软件兜底节流 ~30fps（WebGL2 不经此路径）

// ---------------- 状态 ----------------
let core: AppCore | null = null;
let rendererKind: "webgl2" | "software" = "webgl2";
let lastRenderAt = 0;
const hopCounts: Record<"1" | "2", number> = { "1": 0, "2": 0 };
let soundOn = true;
let companionOn = false;
let currentChar = initialCharFromUrl();
let zoom = 1;
let bubbleHideAt = 0;
let softCtx: CanvasRenderingContext2D | null = null;
let softImage: ImageData | null = null;

function initialCharFromUrl(): string {
  const c = new URLSearchParams(location.search).get("character");
  return c && APP_CHARACTERS[c] ? c : "costume";
}

// 模型缓存：文本 + 解码纹理，避免切角色反复拉取大文件
const modelCache = new Map<string, { text: string; atlas: Map<string, Tex2D> }>();
// 运行时注册的回流模型（浏览器内「上传构建」出的角色：无需文件请求）
const runtimeModels = new Map<string, { text: string; atlas: Map<string, Tex2D> }>();
const charReactions = new Map<string, Record<string, string[]>>();

async function ensureModel(charId: string): Promise<{ text: string; atlas: Map<string, Tex2D> }> {
  const rt = runtimeModels.get(charId);
  if (rt) return rt;
  const hit = modelCache.get(charId);
  if (hit) return hit;
  const char = APP_CHARACTERS[charId];
  const res = await fetch("/" + char.file);
  if (!res.ok) throw new Error("fetch " + char.file + " -> " + res.status);
  const text = await res.text();
  const loaded = loadL2dm(text);
  if (!loaded.ok || !loaded.model) throw new Error("模型加载失败: " + (loaded.ok ? "?" : loaded.error));
  const atlas = decodeModelAtlas(loaded.model.atlas);
  const entry = { text, atlas };
  modelCache.set(charId, entry);
  return entry;
}

// ---------------- 渲染器 / 画布 ----------------
function replaceCanvas(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.id = "canvas";
  cv.width = STAGE_W;
  cv.height = STAGE_H;
  const old = stageWrap.querySelector("#canvas") as HTMLCanvasElement | null;
  if (old) old.replaceWith(cv);
  else stageWrap.appendChild(cv);
  return cv;
}

function makeSink(cv: HTMLCanvasElement): { sink: RenderSink; kind: "webgl2" | "software" } {
  try {
    const glc = cv.getContext("webgl2", { alpha: true, premultipliedAlpha: true });
    if (glc) return { sink: createWebGL2Renderer(glc as unknown as GL2, { filter: "linear" }), kind: "webgl2" };
  } catch {
    // 回退软件
  }
  softCtx = cv.getContext("2d");
  softImage = null;
  return { sink: new SoftwareRenderer({ filter: "linear" }), kind: "software" };
}

// ---------------- 聊天 ----------------
function pushUser(text: string): void {
  const m = document.createElement("div");
  m.className = "msg user";
  m.textContent = text;
  logEl.appendChild(m);
  logEl.scrollTop = logEl.scrollHeight;
}

function pushChar(outcome: ReplyOutcome): void {
  const empty = logEl.querySelector(".msg.empty");
  if (empty) empty.remove();

  const m = document.createElement("div");
  m.className = "msg char";
  m.textContent = outcome.replyText;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent =
    "hop=" + outcome.hop +
    (outcome.behaviorId ? " · " + outcome.behaviorId : "") +
    (outcome.usedSound ? " · 🔊" : "") +
    " · " + outcome.lines.length + " 行 JSONL · 生效 " +
    (outcome.applied - outcome.skipped) + " 行 · 台词 " + outcome.speechMs + "ms";
  m.appendChild(meta);
  logEl.appendChild(m);
  logEl.scrollTop = logEl.scrollHeight;
}

function speakNotice(n: SpeakNotice): void {
  bubbleText = n.text;
  bubbleHideAt = performance.now() + n.speechMs + 250;
  bubbleEl.textContent = n.text;
  bubbleEl.hidden = false;
  if (soundOn && n.sound) {
    const a = new Audio("/sounds/" + n.sound);
    a.volume = 0.9;
    void a.play().catch(() => void 0);
  }
}

let bubbleText = "";

async function send(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text || !core) return;
  inputEl.value = "";
  pushUser(text);
  try {
    const outcome = await core.handleUserText(text);
    hopCounts[String(outcome.hop) as "1" | "2"]++;
    pushChar(outcome);
    refreshMetrics();
  } catch (e) {
    pushSystem("（我好像卡住了：" + (e as Error).message + "）");
  }
}

function pushSystem(text: string): void {
  const m = document.createElement("div");
  m.className = "msg char";
  m.textContent = text;
  m.style.color = "var(--bad)";
  logEl.appendChild(m);
  logEl.scrollTop = logEl.scrollHeight;
}

// ---------------- UI 重建（切角色） ----------------
async function bootChar(charId: string, withCompanion: boolean): Promise<void> {
  try {
    const char = APP_CHARACTERS[charId];
    const hero = await ensureModel(charId);
    const buddy = withCompanion ? await ensureModel("demo") : null;

    const cv = replaceCanvas();
    const { sink, kind } = makeSink(cv);
    rendererKind = kind;

    core = new AppCore({
      modelJson: hero.text,
      atlas: hero.atlas,
      sink,
      character: char,
      seed: 42,
      stage: { width: STAGE_W, height: STAGE_H },
      background: currentBackground(),
      companionModelJson: buddy ? buddy.text : undefined,
      companionAtlas: buddy ? buddy.atlas : undefined,
      reactionLines: charReactions.get(charId),
      onSpeak: speakNotice,
    });

    // 角色按钮高亮
    for (const b of charBtnsEl.querySelectorAll("button")) {
      b.classList.toggle("active", b.dataset.char === charId);
    }

    chatNameEl.textContent = char.label;
    inputEl.placeholder = "和「" + char.label.split("（")[0] + "」聊天… Enter 发送";
    inputEl.focus();

    // 动作预置
    presetsEl.innerHTML = "";
    for (const p of char.presets) {
      const b = document.createElement("button");
      b.textContent = p.label;
      b.addEventListener("click", () => {
        if (!core) return;
        if (p.lines.length === 0) core.reset();
        else core.feedLines(p.lines);
        refreshMetrics();
      });
      presetsEl.appendChild(b);
    }

    // 换装（仅 rig 角色）
    outfitRow.hidden = !char.costumes;
    outfitBtnsEl.innerHTML = "";
    if (char.costumes) {
      for (const c of char.costumes) {
        const b = document.createElement("button");
        b.className = "wear";
        b.textContent = "服装组 " + c.group;
        b.addEventListener("click", () => {
          if (!core) return;
          core.setOutfit(c.group);
          for (const x of outfitBtnsEl.querySelectorAll("button")) x.classList.toggle("active", x === b);
          refreshMetrics();
        });
        outfitBtnsEl.appendChild(b);
      }
    }

    refreshMetrics();
  } catch (e) {
    console.error("boot 失败:", e);
    pushSystem("（角色加载失败：" + (e as Error).message + "）");
  }
}

function currentBackground(): [number, number, number, number] {
  const sel = document.querySelector("#bgBtns button.active")?.getAttribute("data-bg") ?? "clear";
  switch (sel) {
    case "night": return [14, 20, 46, 255];
    case "sunset": return [58, 34, 24, 255];
    case "forest": return [14, 40, 26, 255];
    case "purple": return [34, 22, 56, 255];
    default: return [0, 0, 0, 0];
  }
}

function providerCalls(): number {
  const p = core?.provider as { calls?: number } | undefined;
  return p?.calls ?? 0;
}

function sampleParams(): string {
  if (!core) return "";
  const p = core.params();
  const wanted = ["ParamMouthOpenY", "ParamAngleX", "微笑", "尾巴摆", "头转向", "衣装组1", "衣装组2"];
  const out: string[] = [];
  for (const k of wanted) if (k in p) out.push(k + "=" + p[k]!.toFixed(2));
  const all = Object.keys(p);
  if (out.length === 0 && all.length > 0) out.push(all[0]! + "=" + p[all[0]!]!.toFixed(2));
  return out.slice(0, 4).join("  ");
}

function refreshMetrics(): void {
  if (!core) return;
  const model = core.model;
  const warpCount = model.parts.reduce(
    (n, p) => n + (p.mesh?.warps?.length ?? 0) + (p.mesh?.warp2d?.length ?? 0),
    0,
  );
  const atlasCount = Object.keys(model.atlas ?? {}).length;
  badgesEl.innerHTML =
    '<span class="badge ok">' + core.character.id + "</span>" +
    '<span class="badge">参数 ' + model.parameters.length + "</span>" +
    '<span class="badge">部件 ' + model.parts.length + "</span>" +
    '<span class="badge">warp ' + warpCount + "</span>" +
    '<span class="badge">纹理 ' + atlasCount + "</span>" +
    '<span class="badge">渲染 ' + rendererKind + "</span>";
  metricsEl.textContent =
    "两跳：第一跳(本地规则) " + hopCounts["1"] + " · 第二跳(Provider) " + hopCounts["2"] +
    "　|　Provider 调用 " + providerCalls() +
    "　|　渲染 " + rendererKind + " · 同伴 " + (core.hasCompanion ? "开" : "关") +
    "　|　已投喂 " + core.ing.applied + " 行 · 坏行隔离 " + core.ing.skipped;
  chatStatsEl.textContent =
    "累计消息 " + (hopCounts["1"] + hopCounts["2"]) +
    " · 参数读数：" + sampleParams() +
    " · 台词确定性应答器，行为两跳决策（真实 LLM：npm run start + LLM_API_KEY）";
}

// ---------------- 事件 ----------------
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void send(inputEl.value);
});
sendBtn.addEventListener("click", () => void send(inputEl.value));

soundToggle.addEventListener("click", () => {
  soundOn = !soundOn;
  soundToggle.classList.toggle("on", soundOn);
  soundToggle.textContent = soundOn ? "🔊 语音：开" : "🔇 语音：关";
});

companionToggle.addEventListener("click", () => {
  companionOn = !companionOn;
  companionToggle.classList.toggle("on", companionOn);
  void bootChar(currentChar, companionOn);
});

zoomIn.addEventListener("click", () => {
  zoom = Math.min(1.6, zoom + 0.15);
  core?.zoomTo(zoom);
});
zoomOut.addEventListener("click", () => {
  zoom = Math.max(0.7, zoom - 0.15);
  core?.zoomTo(zoom);
});

for (const b of document.querySelectorAll("#bgBtns button")) {
  b.addEventListener("click", () => {
    for (const x of document.querySelectorAll("#bgBtns button")) x.classList.remove("active");
    b.classList.add("active");
    core?.setBackground(currentBackground());
  });
}

const CHIPS = ["你好呀！", "你好可爱～", "摇摇尾巴", "我好开心呀", "说点什么吧", "再见啦"];
for (const text of CHIPS) {
  const b = document.createElement("button");
  b.textContent = text;
  b.addEventListener("click", () => void send(text));
  chipsEl.appendChild(b);
}

for (const c of CHARACTER_LIST) {
  const b = document.createElement("button");
  b.dataset.char = c.id;
  b.textContent = c.id === "haru" ? "Haru" : c.id === "demo" ? "小骨架" : "衣装酱";
  b.title = c.desc;
  b.addEventListener("click", () => {
    currentChar = c.id;
    void bootChar(c.id, companionOn);
  });
  charBtnsEl.appendChild(b);
}

// ---------------- 上传图像 → 构建 Live2D ----------------
let currentSource: RgbaImage | null = null;
let currentLabeler: ReturnType<typeof sampleLabeler> | undefined = sampleLabeler();
const createdId = "created";

function setImageRows(canvas: HTMLCanvasElement, img: RgbaImage): void {
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const id0 = ctx.createImageData(img.width, img.height);
  id0.data.set(img.data);
  ctx.putImageData(id0, 0, 0);
}

function setSourceImage(img: RgbaImage, labeler?: ReturnType<typeof sampleLabeler>): void {
  currentSource = img;
  currentLabeler = labeler;
  setImageRows(cvSrc, img);
  cvCut.width = 240;
  cvCut.height = 320;
  cvModel.width = 240;
  cvModel.height = 320;
  btnBuild.disabled = false;
  btnChat.hidden = true;
  cvModel.classList.remove("created-ok");
  createLogEl.className = "create-log";
  createLogEl.textContent = "";
  createStatusEl.textContent = "" + img.width + "×" + img.height + " 已载入 → 点「构建 Live2D」";
}

function logCreate(lines: string[], tone: "busy" | "ok" | "err" | "" = ""): void {
  createLogEl.className = "create-log" + (tone ? " " + tone : "");
  createLogEl.textContent = lines.join("\n");
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

function registerCreatedCharacter(
  charId: string,
  char: AppCharacter,
  reactionLines: Record<Emotion, string[]>,
  model: L2dmModel,
  atlas: Map<string, Tex2D>,
): void {
  APP_CHARACTERS[charId] = char;
  charReactions.set(charId, reactionLines);
  runtimeModels.set(charId, { text: JSON.stringify(model), atlas });
  if (!charBtnsEl.querySelector('[data-char="' + charId + '"]')) {
    const b = document.createElement("button");
    b.dataset.char = charId;
    b.textContent = "✨ 我的创作";
    b.title = char.desc;
    b.addEventListener("click", () => {
      currentChar = charId;
      void bootChar(charId, companionOn);
    });
    charBtnsEl.appendChild(b);
  }
}

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
      labeler: currentLabeler,
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
      registerCreatedCharacter(createdId, made.char, made.reactionLines, outcome.result.model, modelAtlas);
      logCreate(
        [head, cut, ...outcome.log, `✅ 已生成可驱动角色「我的创作」：${outcome.result.model.parts.length} 部件 / ${outcome.result.model.parameters.length} 参数 / 动作 ${outcome.result.motions.map((x) => x.name).join(",")}`],
        "ok",
      );
      btnChat.hidden = false;
      createStatusEl.textContent = "构建成功 → 可直接聊天";
    } else {
      logCreate([head, cut, ...outcome.log, "❌ 未通过——调整容差/最小面积，或换一张平坦色立绘"], "err");
      createStatusEl.textContent = "构建未通过（看日志）";
    }
  } catch (e) {
    logCreate(["构建失败: " + (e as Error).message], "err");
    createStatusEl.textContent = "构建失败";
  } finally {
    btnBuild.disabled = false;
  }
}

// 文件选择 + 拖拽
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
      const img = decodePng(new Uint8Array(buf));
      setSourceImage(img);
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

// 参数滑杆显示 + 内置示例
tolEl.addEventListener("input", () => (tolVEl.textContent = String(tolEl.value)));
minAreaEl.addEventListener("input", () => (minAreaVEl.textContent = String(minAreaEl.value)));
btnSample.addEventListener("click", () => setSourceImage(sampleImage(), sampleLabeler()));
btnBuild.addEventListener("click", () => void onBuild());
btnChat.addEventListener("click", () => {
  currentChar = createdId;
  for (const b of charBtnsEl.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.char === createdId);
  }
  void bootChar(createdId, companionOn);
  btnChat.hidden = true;
});

// 需要一个初始示例立绘（开箱即有内容；色板已知 → ColorMapLabeler 语义精确）
setSourceImage(sampleImage(), sampleLabeler());
void onBuild();

function draw(now: number): void {
  requestAnimationFrame(draw);
  if (!core) return;
  if (rendererKind === "software" && now - lastRenderAt < FRAME_INTERVAL_MS) return;
  lastRenderAt = now;

  core.onFrame(16);

  if (rendererKind === "software") {
    const img = softImage;
    const ctx = softCtx;
    if (img && ctx) {
      const px = core.sink.readPixels?.();
      if (px) {
        img.data.set(px);
        ctx.putImageData(img, 0, 0);
      }
    }
  }

  if (now >= bubbleHideAt && !core.isSpeaking()) {
    bubbleEl.hidden = true;
  }
}

// ---------------- 启动 ----------------
for (const b of document.querySelectorAll("#bgBtns button")) {
  if (b.getAttribute("data-bg") === "night") b.classList.add("active");
}
void bootChar(currentChar, false);
draw(performance.now());

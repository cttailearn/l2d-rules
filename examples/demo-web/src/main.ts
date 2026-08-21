// main.ts —— 浏览器入口（DOM 胶水）：模型切换 → 纹理解码(atlas) → scene(JSONL→driver→engine)
// → 双后端渲染（WebGL2 优先，软件光栅兜底；都启用线性过滤 = 官方平滑观感）→ rAF 画布。
// 透明背景：与官方 Live2D 呈现一致（角色浮于透明棋盘上，无黑底）。
// UI 演示四个包：l2dp(格式/词表) 、convert(模型产物) 、engine(渲染/形变) 、driver(JSONL 流式/校验/分层/环境层)。
import {
  loadL2dm,
  SoftwareRenderer,
  createWebGL2Renderer,
  type GL2,
  type L2dmModel,
  type RenderSink,
  type Tex2D,
} from "@l2dp/engine";
import { createDemoScene, type DemoScene } from "./scene.ts";
import { decodeModelAtlas } from "./texture.ts";

// ---------------- DOM ----------------
function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error("缺少 #" + id);
  return node;
}
const stage = el("stage");
const input = el("input") as HTMLTextAreaElement;
const statusEl = el("status");
const metricsEl = el("metrics");
const paramsEl = el("params");
const modelInfoEl = el("modelInfo");
const presetsEl = el("presets");
const presetHintEl = el("presetHint");
const slidersEl = el("sliders");
const feedBtn = el("feed") as HTMLButtonElement;
const clearBtn = el("clear") as HTMLButtonElement;
const stopBtn = el("stop") as HTMLButtonElement;
const badlineBtn = el("badline") as HTMLButtonElement;
const loadHaruBtn = el("loadHaru") as HTMLButtonElement;
const loadDemoBtn = el("loadDemo") as HTMLButtonElement;

const rendererChoice = new URLSearchParams(location.search).get("renderer") ?? "auto";

// ---------------- 状态 ----------------
let canvasEl = el("canvas") as HTMLCanvasElement;
let scene: DemoScene | null = null;
let sink: RenderSink | null = null;
let rendererKind: "webgl2" | "software" = "webgl2";
let tMs = 0;
let running = true;
let lastRenderAt = 0;
let okCount = 0;
let badCount = 0;
let lastBadReason = "";
// 软件兜底节流 ~30fps（WebGL2 不经此路径）
const FRAME_INTERVAL_MS = 33;

function setStatus(msg: string, bad = false): void {
  statusEl.textContent = msg;
  statusEl.classList.toggle("bad", bad);
}
function refreshMetrics(): void {
  metricsEl.textContent =
    "行统计：已生效 " + okCount + " · 坏行隔离 " + badCount +
    (lastBadReason ? " · 最近原因 " + lastBadReason : "") +
    "　|　渲染：" + rendererKind + " · " + (scene?.textureFilter ?? "nearest") + " 过滤";
}

// ---------------- 小工具 ----------------
function badge(label: string, value: string, tone: "ok" | "warn" | "" = ""): string {
  const cls = tone === "ok" ? " ok" : tone === "warn" ? " warn" : "";
  return '<span class="badge' + cls + '">' + label + ": " + value + "</span>";
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.id = "canvas";
  cv.width = width;
  cv.height = height;
  canvasEl.replaceWith(cv);
  canvasEl = cv;
  return cv;
}

// ---------------- 模型感知：预置 + 滑杆 ----------------
interface Preset {
  label: string;
  lines: string[];
}

function isOfficialParams(model: L2dmModel): boolean {
  return model.parameters.length > 0 && model.parameters.some((p) => p.id.startsWith("Param"));
}

function buildPresets(model: L2dmModel): Preset[] {
  if (isOfficialParams(model)) {
    const set = (sem: string, value: number): string => JSON.stringify({ op: "set", sem, value });
    return [
      { label: "😊 微笑嘴", lines: [set("ParamMouthForm", 1)] },
      { label: "😮 张嘴", lines: [set("ParamMouthOpenY", 1)] },
      { label: "👁 闭眼", lines: [set("ParamEyeLOpen", 0.2), set("ParamEyeROpen", 0.2)] },
      { label: "👀 睁眼", lines: [set("ParamEyeLOpen", 1.6), set("ParamEyeROpen", 1.6)] },
      { label: "↔ 转头", lines: [set("ParamAngleX", 16)] },
      { label: "↕ 抬头", lines: [set("ParamAngleY", 12)] },
      { label: "↕ 低头", lines: [set("ParamAngleY", -12)] },
      { label: "👈 视线左", lines: [set("ParamEyeBallX", -0.8)] },
      { label: "👉 视线右", lines: [set("ParamEyeBallX", 0.8)] },
      { label: "⟲ 重置默认", lines: model.parameters.map((p) => set(p.id, p.def ?? 0)) },
    ];
  }
  // demo.l2dm（语义参数 + warp 形变）
  return [
    { label: "😊 微笑点头", lines: [JSON.stringify({ op: "play", asset: "微笑点头" })] },
    { label: "🦊 尾巴摇", lines: [JSON.stringify({ op: "play", asset: "尾巴摇" })] },
    { label: "🙈 害羞低头", lines: [JSON.stringify({ op: "play", asset: "害羞低头" })] },
    { label: "😀 表情·开心", lines: [JSON.stringify({ op: "face", expression: "开心", weight: 0.5 })] },
  ];
}

const PRESET_HINTS: Record<string, string> = {
  official:
    "haru-full.l2dm = 官方 .moc3 真实几何 + 真实纹理（84 ArtMesh / 42 参数）。预置动作演示 @l2dp/driver 的 set·override 语义（参数面读数实时变化）。注意：真实几何的动画形变（warp keyform）是 @l2dp/convert 的下一个里程碑；动作驱动与官方同步对比见「并排对比页」。",
  semantic:
    "demo.l2dm = 语义参数 + warp 网格形变：play/face 预置会真实地让网格动起来——直接演示 @l2dp/engine 的 ParameterStore → Warp 形变核心。",
};

function buildSliders(model: L2dmModel): void {
  slidersEl.innerHTML = "";
  const targets = model.parameters.filter((p) => p.group !== "Ambient").slice(0, 12);
  if (targets.length === 0) {
    slidersEl.innerHTML = '<span class="hint">（无可驱动参数）</span>';
    return;
  }
  for (const p of targets) {
    const row = document.createElement("div");
    row.className = "slider-row";
    const label = document.createElement("label");
    label.textContent = p.id;
    label.title = p.id + " [" + p.min + ", " + p.max + "]";
    const range = document.createElement("input");
    range.type = "range";
    range.min = String(p.min);
    range.max = String(p.max);
    range.step = String(Math.max((p.max - p.min) / 100, 0.001));
    range.value = String(p.def ?? 0);
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = (p.def ?? 0).toFixed(2);
    range.addEventListener("input", () => {
      const v = Number(range.value);
      val.textContent = v.toFixed(2);
      if (scene) {
        const r = scene.ingest(JSON.stringify({ op: "set", sem: p.id, value: v }), tMs);
        if (r.ok) okCount++;
        else { badCount++; lastBadReason = r.reason ?? "?"; }
        refreshMetrics();
      }
    });
    row.append(label, range, val);
    slidersEl.append(row);
  }
}

function injectPreset(preset: Preset): void {
  if (!scene) return;
  for (const line of preset.lines) {
    const r = scene.ingest(line, tMs);
    if (r.ok) okCount++;
    else { badCount++; lastBadReason = r.reason ?? "?"; }
  }
  refreshMetrics();
}

// ---------------- 模型加载 ----------------
async function bootModel(modelName: string): Promise<void> {
  try {
    setStatus("加载 " + modelName + " …");
    const res = await fetch("/" + modelName);
    if (!res.ok) throw new Error("fetch " + modelName + " -> " + res.status);
    const modelJson = await res.text();
    const loaded = loadL2dm(modelJson);
    if (!loaded.ok) throw new Error(loaded.error);
    const model: L2dmModel = loaded.model;
    const atlas: Map<string, Tex2D> = decodeModelAtlas(model.atlas);

    // 新建画布（切换模型时换 context 类型）
    const { width, height } = model.canvas;
    const cv = makeCanvas(width, height);

    // 渲染器选择：WebGL2(linear) 优先；?renderer=software 强制软件
    let chosenSink: RenderSink | null = null;
    let kind: "webgl2" | "software" = "software";
    if (rendererChoice !== "software") {
      try {
        const glc = cv.getContext("webgl2", { alpha: true, premultipliedAlpha: true });
        if (glc) {
          chosenSink = createWebGL2Renderer(glc as unknown as GL2, { filter: "linear" });
          kind = "webgl2";
        }
      } catch {
        chosenSink = null;
      }
    }
    if (!chosenSink) {
      cv.getContext("2d");
      chosenSink = new SoftwareRenderer({ filter: "linear" });
      kind = "software";
    }
    sink = chosenSink;
    rendererKind = kind;

    scene = createDemoScene(modelJson, { atlas, sink, filter: "linear" });

    // 模型信息
    const warpCount = model.parts.reduce(
      (n, p) => n + (p.mesh?.warps?.length ?? 0) + (p.mesh?.warp2d?.length ?? 0),
      0,
    );
    modelInfoEl.innerHTML =
      badge("模型", modelName) +
      badge("参数 " + model.parameters.length, "") +
      badge("部件 " + model.parts.length, "") +
      badge("纹理", String(atlas.size), atlas.size > 0 ? "ok" : "warn") +
      badge("warp " + warpCount, "", warpCount > 0 ? "ok" : "warn") +
      badge("渲染", kind + " · " + (scene.textureFilter ?? "nearest"), kind === "webgl2" ? "ok" : "") +
      badge("画布", width + "×" + height, "");

    // 预置 + 滑杆 + 提示
    const presets = buildPresets(model);
    presetsEl.innerHTML = "";
    for (const pr of presets) {
      const btn = document.createElement("button");
      btn.textContent = pr.label;
      btn.addEventListener("click", () => injectPreset(pr));
      presetsEl.append(btn);
    }
    presetHintEl.textContent = isOfficialParams(model) ? PRESET_HINTS.official : PRESET_HINTS.semantic;
    buildSliders(model);

    // 默认 JSONL 内容（模型感知）
    input.value = isOfficialParams(model)
      ? '{"op":"set","sem":"ParamAngleX","value":-8}\n{"op":"set","sem":"ParamEyeBallX","value":0.5}\n{"op":"wait","ms":1500}\n{"op":"set","sem":"ParamAngleX","value":0}'
      : '{"op":"play","asset":"微笑点头"}\n{"op":"play","asset":"尾巴摇"}\n{"op":"face","expression":"开心","weight":0.5}\n{"op":"wait","ms":2000}\n{"op":"play","asset":"害羞低头"}';

    // e2e/测试钩子
    (window as unknown as { __demoInfo?: Record<string, unknown> }).__demoInfo = {
      model: modelName,
      atlasSize: atlas.size,
      canvas: [width, height],
      renderer: kind,
      filter: scene.textureFilter,
      warpCount,
    };

    tMs = 0;
    okCount = 0;
    badCount = 0;
    lastBadReason = "";
    const texNote = atlas.size > 0 ? "真实纹理" : "纯色骨架";
    setStatus(
      "已加载 " + modelName + " · " + texNote +
      " · " + kind + " 渲染 / " + (scene.textureFilter ?? "nearest") + " 过滤 · 透明背景（与官方呈现一致）",
    );
    refreshMetrics();
  } catch (e) {
    setStatus("模型加载失败: " + (e as Error).message, true);
  }
}

// ---------------- 渲染主循环 ----------------
function draw(now: number): void {
  requestAnimationFrame(draw);
  if (!scene || !running) return;
  if (rendererKind === "software" && now - lastRenderAt < FRAME_INTERVAL_MS) return;
  lastRenderAt = now;

  scene.onFrame(16);

  // 软件后端：读像素 → putImageData（WebGL2 直接渲到画布，无需读回）
  if (rendererKind === "software" && sink) {
    const img = ctx2dPix();
    if (img) {
      const px = sink.readPixels();
      if (px) {
        img.data.set(px);
        img.putData();
      }
    }
  }

  // 参数读数
  const p = scene.params();
  paramsEl.innerHTML = Object.keys(p)
    .slice(0, 300)
    .map((k) => "<b>" + k + "</b>: " + p[k]!.toFixed(2))
    .join("　");
  tMs += 16;
}

// 软件路径取 2D 上下文（惰性；ctx 在 boot 时已建）
let softCtx: CanvasRenderingContext2D | null = null;
let softImage: ImageData | null = null;
function ctx2dPix(): { data: Uint8ClampedArray; putData(): void } | null {
  if (rendererKind !== "software") return null;
  if (!softCtx) softCtx = canvasEl.getContext("2d");
  if (!softCtx) return null;
  if (!softImage || softImage.width !== canvasEl.width || softImage.height !== canvasEl.height) {
    softImage = softCtx.createImageData(canvasEl.width, canvasEl.height);
  }
  return {
    data: softImage.data,
    putData(): void {
      softCtx!.putImageData(softImage!, 0, 0);
    },
  };
}

// ---------------- 事件 ----------------
function feedLines(text: string): void {
  if (!scene) return;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const r = scene.ingest(trimmed, tMs);
    if (r.ok) okCount++;
    else {
      badCount++;
      lastBadReason = r.reason ?? "?";
      setStatus("坏行跳过: " + trimmed.slice(0, 60) + " → " + r.reason, true);
    }
  }
  refreshMetrics();
}

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    feedLines(input.value);
  }
});
feedBtn.addEventListener("click", () => feedLines(input.value));
clearBtn.addEventListener("click", () => {
  input.value = "";
  okCount = 0;
  badCount = 0;
  lastBadReason = "";
  refreshMetrics();
});
stopBtn.addEventListener("click", () => {
  running = !running;
  stopBtn.textContent = running ? "暂停 / 继续" : "继续";
});
badlineBtn.addEventListener("click", () => {
  feedLines(
    '{"op":"play","asset":"不存在的动作"}\n{"op":"nope"}\n这不是 JSON',
  );
});
loadHaruBtn.addEventListener("click", () => void bootModel("haru-full.l2dm"));
loadDemoBtn.addEventListener("click", () => void bootModel("demo.l2dm"));

const initial = new URLSearchParams(location.search).get("model") ?? "haru-full.l2dm";
void bootModel(initial);
draw(performance.now());

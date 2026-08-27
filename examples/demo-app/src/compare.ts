// compare.ts —— 并排对比页逻辑（compare.html）—— 上传驱动
// 用户选择一个 Live2D 模型目录（或拖入 .zip / 文件夹），两侧用同一上传模型：
//   左侧：@l2dp/convert 前端实时转换 → .l2dm → 自研引擎（软件光栅）渲染
//   右侧：官方 Cubism SDK（pixi-live2d-display）用 model3 blob URL 渲染真实 .moc3
// 同一官方 motion 曲线同时驱动两侧（左侧采样曲线写参数，右侧交官方 motionManager 播放）。
import { loadL2dm } from "@l2dp/engine";
import { unzipSync } from "fflate";
import { decodeModelAtlas } from "./texture.ts";
import { createLeftCompare, type CompareMotionCurve, type LeftCompare } from "./compare-left.ts";
import { createRightCompare, type RightCompare } from "./compare-right.ts";
import {
  buildLeftL2dm,
  buildRightModelUrl,
  collectUpload,
  readModel3Raw,
} from "./compare-upload.ts";

interface MotionEntry {
  group: string;
  no: number;
  name: string;
  file: string;
}

let left: LeftCompare | null = null;
let right: RightCompare | null = null;
let revokeRight: (() => void) | null = null;
let motions: MotionEntry[] = [];
let currentMotion: CompareMotionCurve[] = [];
let motionClockMs = 0;
let playing = true;
let loopStarted = false;

function getEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少 #${id}`);
  return el;
}

const canvasLeft = getEl("canvas-left") as HTMLCanvasElement;
const canvasRight = getEl("canvas-right") as HTMLCanvasElement;
const statusLeft = getEl("status-left") as HTMLDivElement;
const statusRight = getEl("status-right") as HTMLDivElement;
const motionSelect = getEl("motionSelect") as HTMLSelectElement;
const playBtn = getEl("playBtn") as HTMLButtonElement;
const modeNote = getEl("mode-note") as HTMLDivElement;
const fileInput = getEl("fileInput") as HTMLInputElement;
const dropZone = getEl("dropZone") as HTMLDivElement;

async function selectMotion(index: number): Promise<void> {
  const m = motions[index];
  if (!m) return;
  try {
    const json = (await (await fetch(m.file)).json()) as {
      Curves?: { Id: string; Segments: number[] }[];
      Meta?: { Duration?: number };
    };
    currentMotion = (json.Curves ?? [])
      .map((c) => ({ id: c.Id, segments: c.Segments }))
      .filter((c) => c.segments.length >= 4);
    motionClockMs = 0;
    const ok = right?.playMotion(m.group, m.no) ?? false;
    const extra = ok ? "" : "（右侧官方播放该 motion 失败，仅左侧在动）";
    modeNote.textContent =
      `同步播放：${m.name}（左侧=自研采样曲线，右侧=官方 runtime）· ${(json.Meta?.Duration ?? 0).toFixed(1)}s ${extra}`;
  } catch (e) {
    modeNote.textContent = `加载 motion 失败: ${(e as Error).message}`;
  }
}

function startLoop(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, W: number, H: number): void {
  if (loopStarted) return;
  loopStarted = true;
  let last = performance.now();
  const loop = (): void => {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dtMs = Math.min((now - last) / 1000, 0.1) * 1000;
    last = now;
    if (!playing) return;
    motionClockMs += dtMs;
    if (left) {
      if (currentMotion.length > 0) left.driveCurves(currentMotion, motionClockMs);
      left.onFrame(dtMs);
      const px = left.pixels();
      if (px && canvas.width === W) {
        const img = ctx.createImageData(W, H);
        img.data.set(px);
        ctx.putImageData(img, 0, 0);
      }
    }
    right?.update();
  };
  loop();
}

async function onModelFiles(files: File[]): Promise<void> {
  statusLeft.textContent = "正在解析上传模型…";
  statusLeft.classList.remove("bad");
  statusRight.classList.remove("bad");
  try {
    const { byPath, model3Rel } = collectUpload(files);
    const model3Text = await readModel3Raw(byPath, model3Rel);

    // ---- 左侧：前端转换 → .l2dm → 自研引擎 ----
    const { modelJson, warnings } = await buildLeftL2dm(byPath, model3Rel, model3Text);
    const loaded = loadL2dm(modelJson);
    if (!loaded.ok) throw new Error(`生成 .l2dm 校验失败: ${loaded.error}`);
    const atlas = decodeModelAtlas(loaded.model.atlas);
    const W = loaded.model.canvas.width;
    const H = loaded.model.canvas.height;
    canvasLeft.width = W;
    canvasLeft.height = H;

    const ctx = canvasLeft.getContext("2d");
    if (!ctx) throw new Error("左侧无法取 2D context");

    const leftEngine = createLeftCompare(modelJson, atlas);
    left = leftEngine;
    statusLeft.textContent =
      `自研引擎 · 已转换 ${model3Rel}（参数 ${loaded.model.parameters.length} · 部件 ${loaded.model.parts.length} · 纹理 ${atlas.size} 张）` +
      (warnings.length ? ` · 警告 ${warnings.length} 条` : "");

    // ---- 右侧：官方 SDK（blob model3）----
    if (revokeRight) { try { revokeRight(); } catch { /* 忽略 */ } revokeRight = null; }
    const rUrl = buildRightModelUrl(byPath, model3Rel, model3Text);
    revokeRight = rUrl.revoke;

    right?.destroy?.();
    right = await createRightCompare(canvasRight, rUrl.model3Url);
    if (right.ready) {
      statusRight.textContent = "官方 Cubism SDK · 已加载上传模型 .moc3 真实几何";
      canvasRight.style.display = "";
    } else {
      statusRight.textContent = right.error ?? "官方 SDK 加载失败";
      statusRight.classList.add("bad");
      canvasRight.style.display = "none";
    }

    // ---- 枚举 motions ----
    const m3 = JSON.parse(model3Text) as {
      FileReferences?: { Motions?: Record<string, { File: string }[]> };
    };
    motions = [];
    const baseDir = model3Rel.split("/").slice(0, -1).join("/");
    const mot = m3.FileReferences?.Motions ?? {};
    for (const [group, list] of Object.entries(mot)) {
      list.forEach((m, no) => {
        const name = (m.File.split("/").pop() ?? "").replace(/\.motion3\.json$/, "") || `${group}[${no}]`;
        const fileRel = baseDir ? `${baseDir}/${m.File}` : m.File;
        const found = byPath.get(fileRel) ?? byPath.get(m.File);
        const file = found ? URL.createObjectURL(found) : `${baseDir}/${m.File}`;
        motions.push({ group, no, name: `${group} / ${name}`, file });
      });
    }
    motionSelect.innerHTML = motions.map((m, i) => `<option value="${i}">${m.name}</option>`).join("");
    currentMotion = [];
    if (motions.length > 0) void selectMotion(0);

    startLoop(canvasLeft, ctx, W, H);
    modeNote.textContent = `已加载 ${model3Rel} · 选择 motion 同步播放两侧`;
  } catch (e) {
    statusLeft.textContent = `加载失败: ${(e as Error).message}`;
    statusLeft.classList.add("bad");
  }
}

// ---- 上传交互 ----
fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files ?? []);
  if (files.length) void onModelFiles(files);
  fileInput.value = "";
});

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("over");
  void handleDrop(e.dataTransfer);
});

async function handleDrop(dt: DataTransfer | null): Promise<void> {
  if (!dt) return;
  const files = Array.from(dt.files ?? []);
  const zips = files.filter((f) => /\.zip$/i.test(f.name));
  if (zips.length > 0) {
    const zf = zips[0];
    const buf = new Uint8Array(await zf.arrayBuffer());
    const unzipped = unzipSync(buf);
    const out: File[] = [];
    for (const [path, data] of Object.entries(unzipped)) {
      if (!path) continue;
      const name = path.split("/").pop() || "file";
      const f = new File([data], name, { type: mimeFromName(name) });
      (f as File & { webkitRelativePath: string }).webkitRelativePath = path.replace(/^\/+/, "").replace(/\\/g, "/");
      out.push(f);
    }
    if (out.length) { void onModelFiles(out); return; }
  } else if (files.length) {
    void onModelFiles(files);
  }
}

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "json") return "application/json";
  return "application/octet-stream";
}

playBtn.addEventListener("click", () => {
  playing = !playing;
  playBtn.textContent = playing ? "暂停" : "继续";
});
motionSelect.addEventListener("change", () => void selectMotion(Number(motionSelect.value)));

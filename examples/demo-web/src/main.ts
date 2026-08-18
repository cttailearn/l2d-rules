// main.ts —— 浏览器入口（DOM 胶水）：JSONL 逐行 → scene → rAF → canvas ImageData
import { createDemoScene } from "./scene.ts";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const input = document.getElementById("input") as HTMLTextAreaElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const paramsEl = document.getElementById("params") as HTMLDivElement;
const feedBtn = document.getElementById("feed") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;

const ctx = canvas.getContext("2d")!;
const img = ctx.createImageData(canvas.width, canvas.height);
const ctx2d = ctx as CanvasRenderingContext2D;

let scene: ReturnType<typeof createDemoScene> | null = null;
let tMs = 0;
let running = true;

async function boot(): Promise<void> {
  const res = await fetch("/demo.l2dm");
  const modelJson = await res.text();
  scene = createDemoScene(modelJson, 42);
  setStatus("模型已加载。逐行粘贴 JSONL 或点击“逐行注入”。");
}

function setStatus(msg: string, bad = false): void {
  statusEl.textContent = msg;
  statusEl.classList.toggle("bad", bad);
}

function feedLines(text: string): void {
  if (!scene) return;
  let okCount = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const r = scene.ingest(trimmed, tMs);
    if (r.ok) okCount++;
    else setStatus(`坏行跳过: ${trimmed.slice(0, 60)} → ${r.reason}`, true);
  }
  setStatus(okCount > 0 ? `已生效 ${okCount} 行。` : statusEl.textContent ?? "");
}

function draw(): void {
  requestAnimationFrame(draw);
  if (!scene || !running) return;
  scene.onFrame(16);
  const data = scene.renderer.readPixels();
  if (!data) return;
  img.data.set(data);
  ctx2d.putImageData(img, 0, 0);
  const p = scene.params();
  paramsEl.textContent = Object.entries(p)
    .map(([k, v]) => `${k}: ${v.toFixed(3)}`)
    .join("   ");
  tMs += 16;
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
  tMs = 0;
});
stopBtn.addEventListener("click", () => {
  running = !running;
  stopBtn.textContent = running ? "暂停/继续" : "继续";
});

void boot();
draw();

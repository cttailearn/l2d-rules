// e2e/parity.ts —— WebGL2 ↔ 软件渲染 逐像素一致性自检（浏览器端）
// 在真实 Chromium WebGL2 上下文里跑 WebGL2Renderer，与 SoftwareRenderer 同输入逐像素对比，
// 差异 ±1 内视为一致；结果写入 window.__parity 供 Playwright 断言（M3 DoD 的真实执行路径）。

import { SoftwareRenderer, createWebGL2Renderer, type RenderMesh, type Tex2D, type RenderSink } from "@l2dp/engine";

export interface ParityResult {
  pass: boolean;
  maxDelta: number;
  diffs: number;
  total: number;
  scenes: string[];
  error?: string;
  webgl2: boolean;
}

const W = 10;
const H = 10;

declare global {
  interface Window { __parity?: ParityResult }
}

function compareScene(name: string, draw: (r: RenderSink) => void, out: ParityResult): void {
  // 软件渲染（top-down 数据）
  const sw = new SoftwareRenderer();
  sw.begin(W, H);
  draw(sw);
  sw.end();
  const swData = sw.readPixels()!;

  // WebGL2 渲染（真实上下文；readPixels 为 bottom-up，需垂直翻转再比）
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  // 关闭 MSAA（samples:0）：软件光栅是像素中心二元判据；默认 4x MSAA 的亚样本覆盖在
  // 斜边附近像素上会解析出 0.25/0.5/0.75 的混合 alpha（本机 SwiftShader 实测），永远
  // 无法与软件逐位一致。parity 契约针对的是颜色管线（RenderSink 三阶段 / NEAREST /
  // 透明混合 / 投影）而非超采样——MSAA 属宿主 canvas 的呈现层选择，不属于本 SDK 渲染
  // 语义。关闭后 GL 与软件同为「像素中心是否落在三角形内」的二元覆盖，可严格对比。
  const gl = canvas.getContext("webgl2", { samples: 0, antialias: false });
  if (!gl) {
    out.pass = false;
    out.webgl2 = false;
    out.error = "当前浏览器/环境无 WebGL2 上下文";
    return;
  }
  const gr = createWebGL2Renderer(gl);
  gr.begin(W, H);
  draw(gr);
  gr.end();
  const glData = gr.readPixels()!;

  out.scenes.push(name);
  for (let y = 0; y < H; y++) {
    const galRow = (H - 1 - y) * W * 4; // GL bottom-up → 与软件一致的 top-down
    const swRow = y * W * 4;
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 4; c++) {
        out.total++;
        const d = Math.abs(swData[swRow + x * 4 + c] - glData[galRow + x * 4 + c]);
        if (d > out.maxDelta) out.maxDelta = d;
        if (d > 1) out.diffs++;
      }
    }
  }
}

export function runParity(): ParityResult {
  const out: ParityResult = { pass: false, maxDelta: 0, diffs: 0, total: 0, scenes: [], webgl2: true };

  // 场景 1：M3「纯色三角形」同输入（轴对齐边、实心单色）
  // 斜边取 (10,0)→(0,9)（9x+10y=90）：像素中心 (x+.5,y+.5) 代入得 9x+10y=80.5，
  // 整数无解 → 无像素中心恰落在斜边上。避免退化情形——GL 默认 4x MSAA 对边缘中心
  // 解析出 0.5 覆盖（alpha≈128），而软件光栅是二元边缘判据（全覆盖），此差异属
  // 覆盖约定而非颜色数学，M3 DoD 的逐像素一致性只针对非退化场景。
  compareScene("solid-triangle", (r) => {
    r.draw({
      verts: new Float32Array([0, 0, 10, 0, 0, 9]),
      uvs: new Float32Array(6),
      indices: [0, 1, 2],
      texId: null,
      color: [255, 0, 0, 255],
    });
  }, out);

  // 场景 2：全画布实心四边形（轴对齐、逐像素全覆盖，无边缘歧义）
  compareScene("solid-quad", (r) => {
    r.draw({
      verts: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
      uvs: new Float32Array(8),
      indices: [0, 1, 2, 0, 2, 3],
      texId: null,
      color: [64, 128, 255, 255],
    });
  }, out);

  // 场景 3：单色纹理 + 灰色 tint（NEAREST 采样 + 透明混合；单色纹理规避垂直翻转歧义）
  compareScene("textured-uniform", (r) => {
    const tex: Tex2D = { width: 1, height: 1, data: new Uint8Array([200, 100, 50, 255]) };
    r.uploadTexture("u", tex);
    r.draw({
      verts: new Float32Array([0, 0, 10, 0, 0, 9]), // 同场景 1：斜边不经过像素中心
      uvs: new Float32Array([0, 0, 1, 1, 0, 1]),
      indices: [0, 1, 2],
      texId: "u",
      color: [128, 128, 128, 255],
    });
  }, out);

  out.pass = out.diffs === 0 && out.maxDelta <= 1;
  return out;
}

// 页面加载即执行（Playwright 等待 window.__parity 就绪）
window.__parity = runParity();

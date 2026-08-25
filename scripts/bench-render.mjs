// bench-render.mjs（R-P2-3）：SoftwareRenderer 渲染吞吐基准——多帧 × 多部件规模，报告 fps/帧/部件成本 + 确定性
import { createHash } from "node:crypto";
import { L2DM_FORMAT_VERSION, L2dmPlayer, SoftwareRenderer, mulberry32 } from "@l2dp/engine";

function buildModel(partCount) {
  const cols = Math.min(16, partCount);
  const rnd = mulberry32(12345);
  const z = (n) => new Array(n).fill(0);
  const cell = 12;
  const C = cols * cell;
  const H = Math.ceil(partCount / cols) * cell;
  const parts = [];
  for (let i = 0; i < partCount; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const x0 = c * cell, y0 = r * cell, x1 = x0 + cell - 1, y1 = y0 + cell - 1;
    parts.push({
      id: "p" + i, order: i, color: [rnd.next(), rnd.next(), rnd.next(), 1],
      mesh: {
        vertices: [x0, y0, x1, y0, x1, y1, x0, y1],
        uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3],
        warps: i % 5 === 0 ? [{ parameter: "sway", keyforms: [{ value: 0, offsets: z(8) }, { value: 1, offsets: [0, 2, 0, 2, 0, 2, 0, 2] }] }] : undefined,
      },
    });
  }
  return {
    formatVersion: L2DM_FORMAT_VERSION, id: "bench",
    canvas: { width: C, height: H },
    parameters: [{ id: "sway", min: 0, max: 1, def: 0, group: "Custom" }],
    parts,
  };
}

function bench(partCount, frames) {
  const model = buildModel(partCount);
  const player = new L2dmPlayer(model, new Map());
  const sw = new SoftwareRenderer();
  // 预热
  player.render(sw); sw.readPixels();
  const t0 = performance.now();
  let last = "";
  let lastOpaque = 0;
  for (let f = 0; f < frames; f++) {
    player.params.set("sway", (f % 10) / 9);
    player.render(sw);
    const buf = sw.readPixels();
    last = createHash("sha256").update(buf).digest("hex");
    if (f === frames - 1) { lastOpaque = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) lastOpaque++; }
  }
  const dt = performance.now() - t0;
  const fps = frames / (dt / 1000);
  return { partCount, frames, dtMs: dt.toFixed(1), fps: fps.toFixed(1), msPerFrame: (dt / frames).toFixed(3), lastHash: last.slice(0, 16), lastOpaque };
}

console.log("[bench-render] SoftwareRenderer 吞吐基准（无 GPU，确定性）");
console.log(bench(20, 100));
console.log(bench(84, 100));
console.log(bench(200, 100));
// 确定性：同规模同 seed 重建 → 同末帧哈希
const a = bench(84, 50), b = bench(84, 50);
console.log("确定性: " + (a.lastHash === b.lastHash ? "OK（" + a.lastHash + "）" : "FAIL " + a.lastHash + " vs " + b.lastHash));
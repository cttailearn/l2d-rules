// render-preview.mjs —— P4a 出图预览：demo-chan rig → 软件渲染 → RGBA PNG（无第三方 PNG 编码器，fflate zlib + 手写 chunk/CRC32）
// 用法：node packages/rig/scripts/render-preview.mjs   → 输出 packages/rig/out/preview-<状态>.png
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { zlibSync } from "fflate";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { rigCharacter } from "../src/index.ts";
import { sampleSpec } from "../test/sample.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");

// ---- 最小 PNG 编码器（8-bit RGBA color type 6） ----
const CRC_TABLE = new Int32Array(256).map(() => 0);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter none
    const row = y * width * 4;
    for (let x = 0; x < width * 4; x++) raw[o++] = rgba[row + x];
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- 场景 ----
const { model } = rigCharacter(sampleSpec());
const player = new L2dmPlayer(model, new Map());
const sw = new SoftwareRenderer();
const scenes = [
  ["rest", () => {}],
  ["blink", (ps) => { ps.set("眼闭左", 1); ps.set("眼闭右", 1); }],
  ["turn-left", (ps) => ps.set("头转向", 25)],
  ["turn-right", (ps) => ps.set("头转向", -25)],
  ["nod", (ps) => ps.set("头点头", 20)],
  ["talk", (ps) => ps.set("嘴开", 0.8)],
  ["smile", (ps) => ps.set("嘴笑", 1)],
  ["surprised", (ps) => { ps.set("眉左升", 1); ps.set("眉右升", 1); ps.set("嘴开", 0.9); }],
  ["hair-sway", (ps) => ps.set("发摆", 1)],
];

await mkdir(OUT, { recursive: true });
const written = [];
for (const [name, apply] of scenes) {
  player.params.reset();
  apply(player.params);
  player.render(sw);
  const px = sw.readPixels();
  const file = join(OUT, `preview-${name}.png`);
  await writeFile(file, encodePng(model.canvas.width, model.canvas.height, px));
  written.push(`preview-${name}.png (${sw.countNonTransparent()} 非透明像素)`);
}
console.log("已写出:");
console.log(written.map((w) => "  " + w).join("\n"));

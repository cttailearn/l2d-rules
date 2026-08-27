// texture.ts —— 宿主纹理解码：.l2dm 内嵌 atlas(data URI) → engine Tex2D(RGBA)
// 职责边界：engine README 明确"纹理解码/上传管理归宿主"；本文件即 demo-web 宿主的解码器。
// - 纯 TS + fflate（Node/浏览器双端）：inflateSync 解 IDAT，实现 PNG 滤波器重建 → RGBA
// - 支持：bitDepth=8；colorType 0(gray)/2(rgb)/3(palette)/4(gray+alpha)/6(rgba)；非交织(0)
// - 单遍重建：滤波行缓冲 + 扩容输出；确定性纯函数。
// - decodeModelAtlas(model.atlas) → Map<string, Tex2D> 交给 L2dmPlayer

import { unzlibSync } from "fflate";
import type { Tex2D } from "@l2dp/engine";

/** data URI（或裸 base64）→ bytes。Node 用 Buffer，浏览器用 atob。 */
export function dataUriToBytes(uri: string): Uint8Array {
  const comma = uri.indexOf(",");
  const b64 = comma === -1 ? uri : uri.slice(comma + 1);
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------- PNG 解码 ----------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * 解码 8-bit 非交织 PNG → RGBA Tex2D。
 * @throws 签名/位深/颜色类型/交织不支持时抛错。
 */
export function decodePng(bytes: Uint8Array): Tex2D {
  if (bytes.length < 8 || !PNG_SIG.every((v, i) => bytes[i] === v)) {
    throw new Error("不是 PNG 文件（签名不符）");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let palette: number[] = [];
  let trns: number[] = [];

  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const start = off + 8;
    const end = start + len;
    if (end > bytes.length) break;
    const data = bytes.subarray(start, end);
    off = end + 4; // +crc
    if (type === "IHDR") {
      width = dv.getUint32(start);
      height = dv.getUint32(start + 4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") {
      palette = [...data];
    } else if (type === "tRNS") {
      trns = [...data];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error(`不支持 bitDepth=${bitDepth}（仅 8）`);
  if (interlace !== 0) throw new Error("不支持交织 PNG（interlace>0）");
  const channels = [1, 0, 3, 1, 2, 0, 4][colorType];
  if (channels === undefined || channels === 0) throw new Error(`不支持 colorType=${colorType}`);

  const total = idat.reduce((n, c) => n + c.length, 0);
  const rawAll = new Uint8Array(total);
  let w = 0;
  for (const c of idat) {
    rawAll.set(c, w);
    w += c.length;
  }
  // PNG IDAT 是 zlib（RFC1950）→ unzlibSync
  const raw = unzlibSync(rawAll);
  void rawAll;

  const stride = width * channels;
  const rowBuf = new Uint8Array(stride);
  const prevBuf = new Uint8Array(stride);
  const data = new Uint8Array(width * height * 4);
  const isTrns = (r: number, g: number, b: number): number =>
    colorType === 2 && trns.length >= 6
      ? r === trns[0]! && g === trns[2]! && b === trns[4]! ? 0 : 255
      : 255;

  let di = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[di]!;
    di += 1;
    if (raw.length < di + stride) throw new Error("IDAT 数据不完整");
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[di + x]!;
      const left = x >= channels ? rowBuf[x - channels]! : 0;
      const up = y > 0 ? prevBuf[x]! : 0;
      const upLeft = x >= channels && y > 0 ? prevBuf[x - channels]! : 0;
      let v: number;
      switch (filter) {
        case 0: v = rawByte; break;
        case 1: v = rawByte + left; break;
        case 2: v = rawByte + up; break;
        case 3: v = rawByte + ((left + up) >> 1); break;
        case 4: v = rawByte + paeth(left, up, upLeft); break;
        default: throw new Error(`未知滤波类型 ${filter}`);
      }
      rowBuf[x] = v & 0xff;
    }
    di += stride;

    const o0 = y * width * 4;
    for (let x = 0; x < width; x++) {
      const o = o0 + x * 4;
      const b0 = x * channels;
      switch (colorType) {
        case 0: { const g = rowBuf[b0]!; data[o] = data[o + 1] = data[o + 2] = g; data[o + 3] = 255; break; }
        case 4: { data[o] = data[o + 1] = data[o + 2] = rowBuf[b0]!; data[o + 3] = rowBuf[b0 + 1]!; break; }
        case 2: { data[o] = rowBuf[b0]!; data[o + 1] = rowBuf[b0 + 1]!; data[o + 2] = rowBuf[b0 + 2]!; data[o + 3] = isTrns(data[o]!, data[o + 1]!, data[o + 2]!); break; }
        case 6: { data[o] = rowBuf[b0]!; data[o + 1] = rowBuf[b0 + 1]!; data[o + 2] = rowBuf[b0 + 2]!; data[o + 3] = rowBuf[b0 + 3]!; break; }
        case 3: {
          const idx = rowBuf[b0]! * 3;
          data[o] = palette[idx] ?? 0;
          data[o + 1] = palette[idx + 1] ?? 0;
          data[o + 2] = palette[idx + 2] ?? 0;
          data[o + 3] = idx / 3 < trns.length ? (trns[idx / 3] ?? 255) : 255;
          break;
        }
      }
    }
    prevBuf.set(rowBuf);
  }

  return { width, height, data };
}

/** 把 .l2dm 内嵌 atlas（文件名 → data URI）解码成 engine 的 Tex2D 表。 */
export function decodeModelAtlas(atlas: Record<string, string> | undefined): Map<string, Tex2D> {
  const out = new Map<string, Tex2D>();
  for (const [key, uri] of Object.entries(atlas ?? {})) {
    try {
      out.set(key, decodePng(dataUriToBytes(uri)));
    } catch (e) {
      throw new Error(`atlas '${key}' 解码失败: ${(e as Error).message}`);
    }
  }
  return out;
}

/**
 * 浏览器加速解码：用 createImageBitmap + OffscreenCanvas 走原生解码（大幅快于软解码大 PNG）；
 * 环境不支持时回退到软解码。Node（无 OffscreenCanvas/ImageBitmap）始终走 decodePng。
 */
export async function decodePngBitmap(bytes: Uint8Array): Promise<Tex2D> {
  if (typeof createImageBitmap === "undefined") return decodePng(bytes);
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
    const oc = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = oc.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2d 不可用");
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close();
    return { width: bmp.width, height: bmp.height, data: new Uint8Array(img.data.buffer) };
  } catch (e) {
    console.warn("createImageBitmap 解码失败，回退软解码:", (e as Error).message);
    return decodePng(bytes);
  }
}

/** 浏览器加速：atlas(data URI) → Tex2D 表（createImageBitmap），失败回退软解码。 */
export async function decodeModelAtlasBitmap(atlas: Record<string, string> | undefined): Promise<Map<string, Tex2D>> {
  const out = new Map<string, Tex2D>();
  for (const [key, uri] of Object.entries(atlas ?? {})) {
    try {
      out.set(key, await decodePngBitmap(dataUriToBytes(uri)));
    } catch (e) {
      throw new Error(`atlas '${key}' 解码失败: ${(e as Error).message}`);
    }
  }
  return out;
}

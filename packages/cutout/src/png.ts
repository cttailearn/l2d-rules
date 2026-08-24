// png.ts —— 最小 PNG 编解码（rgba 8bit；fflate zlib）
// decode：支持 bitdepth 8 的 gray/RGB/RGBA/gray+alpha/palette（filter 0–4 全实现）
// encode：colortype 6（RGBA）filter 0
import { unzlibSync, zlibSync } from "fflate";
import type { RgbaImage } from "./types.ts";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function readU32(d: Uint8Array, o: number): number {
  return ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const sig = Uint8Array.from(SIG);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = new Uint8Array((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), o);
    o += width * 4;
  }
  const crc = (type: string, data: Uint8Array): Uint8Array => {
    const body = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
    body.set(data, 4);
    let c = 0xffffffff;
    for (let i = 0; i < body.length; i++) c = CRC_TABLE[(c ^ body[i]!) & 0xff]! ^ (c >>> 8);
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, (c ^ 0xffffffff) >>> 0);
    return out;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length);
    const out = new Uint8Array(12 + data.length);
    out.set(len, 0);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    out.set(crc(type, data), 8 + data.length);
    return out;
  };
  const idat = zlibSync(raw, { level: 9 }) as Uint8Array;
  const out = new Uint8Array(sig.length + chunk("IHDR", ihdr).length + chunk("IDAT", idat).length + chunk("IEND", new Uint8Array(0)).length);
  let p = 0;
  out.set(sig, p); p += sig.length;
  out.set(chunk("IHDR", ihdr), p); p += chunk("IHDR", ihdr).length;
  out.set(chunk("IDAT", idat), p); p += chunk("IDAT", idat).length;
  out.set(chunk("IEND", new Uint8Array(0)), p);
  return out;
}

export function pngToDataUri(bytes: Uint8Array): string {
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return "data:image/png;base64," + btoa(b64);
}

export function dataUriToBytes(uri: string): Uint8Array {
  const b64 = uri.replace(/^data:image\/[a-z0-9.+-]+;base64,/, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 解析 PNG 为 RGBA 图像（支持 colortype 0/2/3/4/6，bitdepth 8）。 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 8 || SIG.some((b, i) => bytes[i] !== b)) {
    throw new Error("不是 PNG 文件（签名不匹配）");
  }
  let o = 8;
  let width = 0; let height = 0; let bitDepth = 0; let colorType = 0;
  let idat = new Uint8Array(0);
  let plte = new Uint8Array(0);
  let trns = new Uint8Array(0);
  const datas: Uint8Array[] = [];
  let gotIhdr = false;
  while (o + 8 <= bytes.length) {
    const len = readU32(bytes, o);
    const type = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!);
    const data = bytes.subarray(o + 8, o + 8 + len);
    o += 12 + len;
    switch (type) {
      case "IHDR": {
        width = readU32(data, 0);
        height = readU32(data, 4);
        bitDepth = data[8]!;
        colorType = data[9]!;
        gotIhdr = true;
        break;
      }
      case "IDAT": datas.push(data); break;
      case "PLTE": plte = data.slice(); break;
      case "tRNS": trns = data.slice(); break;
      case "IEND": o = bytes.length; break;
      default: break; // ignore ancillary
    }
  }
  if (!gotIhdr) throw new Error("缺少 IHDR");
  if (bitDepth !== 8) throw new Error("仅支持 bitdepth 8，得到 " + bitDepth);
  let channels: number;
  switch (colorType) {
    case 0: channels = 1; break;
    case 2: channels = 3; break;
    case 3: channels = 1; break; // palette: indexed
    case 4: channels = 2; break;
    case 6: channels = 4; break;
    default: throw new Error("不支持的 colortype " + colorType);
  }
  const total = datas.reduce((a, b) => a + b.length, 0);
  const idatAll = new Uint8Array(total);
  let q = 0;
  for (const d of datas) { idatAll.set(d, q); q += d.length; }
  const raw = unzlibSync(idatAll);

  const stride = channels * width;
  const out = new Uint8Array(width * height * 4);
  const get = (row: number, col: number, ch: number): number => {
    const i = row * (1 + stride) + 1 + col * channels + ch;
    return i < raw.length ? raw[i]! : 0;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (1 + stride)]!;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        const i = y * (1 + stride) + 1 + x * channels + c;
        const rawV = raw[i]!;
        const left = x > 0 ? get(y, x - 1, c) : 0;
        const up = y > 0 ? get(y - 1, x, c) : 0;
        const ul = x > 0 && y > 0 ? get(y - 1, x - 1, c) : 0;
        let v: number;
        switch (filter) {
          case 0: v = rawV; break;
          case 1: v = rawV + left; break;
          case 2: v = rawV + up; break;
          case 3: v = rawV + ((left + up) >> 1); break;
          case 4: {
            const p = left + up - ul;
            const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
            const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
            v = rawV + pr;
            break;
          }
          default: throw new Error("未知 filter " + filter);
        }
        raw[i] = v & 0xff; // 就地写回，供后续行 Up/filter 参考
      }
    }
  }
  // 组装 RGBA
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oo = (y * width + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      if (colorType === 6) {
        const i0 = y * (1 + stride) + 1 + x * 4;
        r = raw[i0]!; g = raw[i0 + 1]!; b = raw[i0 + 2]!; a = raw[i0 + 3]!;
      } else if (colorType === 2) {
        const i0 = y * (1 + stride) + 1 + x * 3;
        r = raw[i0]!; g = raw[i0 + 1]!; b = raw[i0 + 2]!;
      } else if (colorType === 0) {
        const v = raw[y * (1 + stride) + 1 + x]!;
        r = g = b = v;
      } else if (colorType === 4) {
        const i0 = y * (1 + stride) + 1 + x * 2;
        const v = raw[i0]!;
        r = g = b = v; a = raw[i0 + 1]!;
      } else if (colorType === 3) {
        const idx = raw[y * (1 + stride) + 1 + x]!;
        r = plte[idx * 3]!; g = plte[idx * 3 + 1]!; b = plte[idx * 3 + 2]!;
        a = idx < trns.length ? trns[idx]! : 255;
      }
      out[oo] = r; out[oo + 1] = g; out[oo + 2] = b; out[oo + 3] = a;
    }
  }
  return { width, height, data: out };
}

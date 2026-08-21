// moc3/moc3.ts —— .moc3 完整读取器（自研；镜像 py-moc3 / moc3-reader-re 读路径）
// 产出：header{version,endian} + counts[23] + canvas + sections（Record<name, 数组>）
// 读策略：魔字/版本→SOT(160·u32)@0x40→countInfo@SOT[0]（23·i32/128B）→canvas@SOT[1]（64B）
//   → 分节：SOT[2+i] 定位 buildLayout()[i]，count=counts[countIdx]，RUNTIME 跳过、STR64 固定 64B。

import { Moc3Reader } from "./reader.ts";
import {
  buildLayout,
  ElemSize,
  MOC3_CANVAS_SIZE,
  MOC3_COUNT_INFO,
  MOC3_COUNT_INFO_SIZE,
  MOC3_DEFAULT_OFFSET,
  MOC3_HEADER_SIZE,
  MOC3_MAGIC,
  MOC3_SOT_COUNT,
} from "./format.ts";

export interface Moc3Canvas {
  pixelsPerUnit: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  flag: number;
}

export interface Moc3Data {
  version: number;
  endian: number;
  counts: number[];
  canvas: Moc3Canvas;
  sections: Record<string, Array<number | string | boolean>>;
  sot: number[];
}

export type Moc3Result = { ok: true; moc: Moc3Data } | { ok: false; error: string };

export function readMoc3(bytes: Uint8Array): Moc3Result {
  const r = new Moc3Reader(bytes);
  try {
    // ---- 头部 ----
    const magic = r.ascii(0, 4);
    if (magic !== MOC3_MAGIC) return { ok: false, error: `魔字不是 ${MOC3_MAGIC}（得 "${magic}"）` };
    const version = bytes[4]!;
    const endian = bytes[5]!;

    // ---- SOT：160 × u32 @ 0x40 ----
    const sot: number[] = [];
    for (let i = 0; i < MOC3_SOT_COUNT; i++) sot.push(r.u32(MOC3_HEADER_SIZE + i * 4));

    // ---- countInfo @SOT[0]（通常 0x7C0）----
    let pos = sot[0]! > 0 ? sot[0]! : MOC3_DEFAULT_OFFSET;
    const counts: number[] = [];
    for (let i = 0; i < MOC3_COUNT_INFO; i++) {
      const v = r.i32(pos);
      counts.push(v);
      pos += 4;
    }
    pos = (sot[0]! > 0 ? sot[0]! : MOC3_DEFAULT_OFFSET) + MOC3_COUNT_INFO_SIZE;

    // ---- canvas @SOT[1] ----
    if (sot[1]! > 0 && sot[1]! > pos) pos = sot[1]!;
    const canvasStart = pos;
    const pixelsPerUnit = r.f32(pos); pos += 4;
    const originX = r.f32(pos); pos += 4;
    const originY = r.f32(pos); pos += 4;
    const width = r.f32(pos); pos += 4;
    const height = r.f32(pos); pos += 4;
    const flag = r.u8(pos);
    pos = canvasStart + MOC3_CANVAS_SIZE;
    const canvas: Moc3Canvas = { pixelsPerUnit, originX, originY, width, height, flag };

    // ---- 分节 ----
    const layout = buildLayout(version);
    const sections: Moc3Data["sections"] = {};

    for (let i = 0; i < layout.length; i++) {
      const def = layout[i]!;
      const sotIdx = i + 2;
      if (sotIdx < sot.length) {
        const target = sot[sotIdx]!;
        if (target > pos && target < r.size) pos = target;
      }
      const count = def.countIdx >= 0 ? (counts[def.countIdx] ?? 0) : 0;

      if (def.type === "RUNTIME") {
        if (count > 0) pos += count * ElemSize.RUNTIME;
        sections[def.name] = [];
        continue;
      }
      if (count <= 0) {
        sections[def.name] = [];
        continue;
      }

      const arr: Array<number | string | boolean> = [];
      for (let k = 0; k < count; k++) {
        switch (def.type) {
          case "STR64": arr.push(r.ascii(pos, 64)); pos += 64; break;
          case "BOOL": arr.push(r.i32(pos) === 1); pos += 4; break;
          case "I32": arr.push(r.i32(pos)); pos += 4; break;
          case "I16": arr.push(r.i16(pos)); pos += 2; break;
          case "U8": arr.push(r.u8(pos)); pos += 1; break;
          default: arr.push(r.f32(pos)); pos += 4; break;
        }
      }
      sections[def.name] = arr;
    }

    return { ok: true, moc: { version, endian, counts: counts.slice(0, 23), canvas, sections, sot } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

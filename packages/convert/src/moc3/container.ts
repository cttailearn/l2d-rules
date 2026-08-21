// moc3/container.ts —— 容器层速览：头部 + Section Offset Table（160 项）
// 完整读取（counts/canvas/分节）见 ./moc3.ts（readMoc3）。这里只做轻量容器校验/定位。

import { Moc3Reader } from "./reader.ts";
import { MOC3_HEADER_SIZE, MOC3_MAGIC, MOC3_SOT_COUNT } from "./format.ts";

export interface Moc3Header {
  magic: string;
  /** byte4：版本（Moc3Version） */
  version: number;
  /** byte5：端序（0=LE） */
  endian: number;
  /** SOT 160 × u32：sot[0]=countInfo、sot[1]=canvas、sot[2+i]=buildLayout()[i] */
  sot: readonly number[];
}

export type Moc3HeaderResult = { ok: true; header: Moc3Header } | { ok: false; error: string };

export function parseMoc3Header(bytes: Uint8Array): Moc3HeaderResult {
  const r = new Moc3Reader(bytes);
  try {
    const magic = r.ascii(0, 4);
    if (magic !== MOC3_MAGIC) return { ok: false, error: `魔字不是 ${MOC3_MAGIC}（得 "${magic}"）` };
    const version = bytes[4]!;
    const endian = bytes[5]!;
    const sot: number[] = [];
    for (let i = 0; i < MOC3_SOT_COUNT; i++) sot.push(r.u32(MOC3_HEADER_SIZE + i * 4));
    return { ok: true, header: { magic, version, endian, sot } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

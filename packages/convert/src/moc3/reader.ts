// moc3/reader.ts —— .moc3 二进制安全读取原语（自研，逆向着手点）
// 端序：moc3 数值域以 LE 存储（u32 偏移表已验证）。全部越界检查，坏偏移抛明确错误。
// 纯数据层：零依赖、确定性；DataView 直接读（浏览器/Node 一致）。

export class Moc3OutOfBoundsError extends Error {}

export class Moc3Reader {
  readonly size: number;
  private readonly buf: Uint8Array;
  private readonly view: DataView;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.size = buf.byteLength;
  }

  private check(off: number, n: number): void {
    if (!Number.isInteger(off) || off < 0 || off + n > this.size) {
      throw new Moc3OutOfBoundsError(`越界读取 @0x${off.toString(16)}+${n}（size=0x${this.size.toString(16)}）`);
    }
  }

  /** LE u32 */
  u32(off: number): number {
    this.check(off, 4);
    return this.view.getUint32(off, true);
  }

  /** LE i32 */
  i32(off: number): number {
    this.check(off, 4);
    return this.view.getInt32(off, true);
  }

  /** LE i16（有符号） */
  i16(off: number): number {
    this.check(off, 2);
    return this.view.getInt16(off, true);
  }

  /** u8 */
  u8(off: number): number {
    this.check(off, 1);
    return this.view.getUint8(off);
  }

  /** LE f32 */
  f32(off: number): number {
    this.check(off, 4);
    return this.view.getFloat32(off, true);
  }

  /** 字节切片 */
  bytes(off: number, n: number): Uint8Array {
    this.check(off, n);
    return this.buf.subarray(off, off + n);
  }

  /** 读取 ASCII id 串（遇 \0 或越界停止；非打印字节即停） */
  ascii(off: number, maxLen = 256): string {
    this.check(off, 0);
    let s = "";
    for (let i = 0; i < maxLen && off + i < this.size; i++) {
      const c = this.buf[off + i]!;
      if (c === 0) break;
      if (c >= 32 && c < 127) s += String.fromCharCode(c);
      else break;
    }
    return s;
  }
}

/** 搜索 ASCII 串出现位置（最多 limit 处；地面真值锚点定位） */
export function findAsciiAll(buf: Uint8Array, needle: string, limit = 16): number[] {
  const pat = Array.from(needle, (c) => c.charCodeAt(0));
  const out: number[] = [];
  outer: for (let i = 0; i + pat.length <= buf.length; i++) {
    for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
    out.push(i);
    if (out.length >= limit) break;
  }
  return out;
}

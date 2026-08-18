// .l2dp zip 打包/解包（规格 10.5 导出；fflate 纯 JS，浏览器/Node 通用）
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

export function packL2dp(files: Record<string, Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) entries[path] = bytes;
  return zipSync(entries, { level: 6 });
}

export function unpackL2dp(data: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(data);
}

export function jsonBytes<T>(obj: T): Uint8Array { return strToU8(JSON.stringify(obj)); }
export function bytesToJson<T>(bytes: Uint8Array): T { return JSON.parse(strFromU8(bytes)) as T; }

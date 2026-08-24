// fuzz.test.ts（R-P2-1）：.moc3/.moc 解析鲁棒性——截断/字节翻转/计数损坏/版本篡改 确定性 fuzz
// 断言：坏输入永不抛异常（恒返回 {ok,error}），不悬挂；n 组 fuzz 0 崩溃
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readMoc3, readMoc, moc3ToL2dm, mocToL2dm } from "@l2dp/convert";
import { loadL2dmObject } from "@l2dp/engine";

const LIVE2D = join(import.meta.dirname, "..", "..", "..", "examples", "live2d");
const HARU = join(import.meta.dirname, "..", "..", "..", "examples", "demo-real", "assets-src", "haru", "Haru.moc3");

function collect(root: string, ext: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase().endsWith(ext)) out.push(p); } };
  walk(root);
  return out;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function mutate(src: Uint8Array, rnd: () => number, kind: number): Uint8Array {
  const b = Uint8Array.from(src);
  const len = b.length;
  if (len === 0) return b;
  switch (kind) {
    case 0: return b.subarray(0, Math.max(0, Math.floor(len * rnd())));
    case 1: { const n = Math.max(1, Math.floor(rnd() * 8)); for (let i = 0; i < n; i++) b[Math.floor(rnd() * len)] ^= 0xff; return b; }
    case 2: { const off = Math.floor(rnd() * len); try { new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(off, 0xdeadbeef >>> 0, true); } catch {} return b; }
    case 3: { if (len > 6) b[4] = 99; return b; }
    case 4: return b.subarray(0, Math.max(6, Math.floor(len / 2)));
    default: return new Uint8Array(0);
  }
}

const MOC3_FILES = [HARU, ...collect(LIVE2D, ".moc3")].slice(0, 5);
const MOC_FILES = collect(LIVE2D, ".moc").slice(0, 5);

test(`R-P2-1 fuzz: .moc3 解析鲁棒（${MOC3_FILES.length} 源 x 56 变异 = ${MOC3_FILES.length * 56} 样本）`, () => {
  let crashes = 0, rejected = 0, ok = 0;
  for (let fi = 0; fi < MOC3_FILES.length; fi++) {
    const src = new Uint8Array(readFileSync(MOC3_FILES[fi]!));
    const rnd = mulberry(1000 + fi * 7);
    for (let m = 0; m < 56; m++) {
      const s = mutate(src, rnd, m % 6);
      try {
        const r = readMoc3(s);
        if (r.ok) {
          ok++;
          if (ok % 4 === 0) {
            try { const c = moc3ToL2dm(r.moc, { id: "f", targetHeight: 100 }); loadL2dmObject(c); } catch { rejected++; }
          }
        } else rejected++;
      } catch (e) {
        crashes++;
        assert.fail("readMoc3 抛异常（源 " + MOC3_FILES[fi] + " m=" + m + "）: " + (e instanceof Error ? e.message : String(e)));
      }
    }
  }
  assert.equal(crashes, 0, "moc3 fuzz 应 0 崩溃（实际 " + crashes + "）");
  assert.ok(rejected > 0, "大量坏样本应被拒绝");
});

test(`R-P2-1 fuzz: .moc 解析鲁棒（${MOC_FILES.length} 源 x 56 变异 = ${MOC_FILES.length * 56} 样本）`, () => {
  let crashes = 0, rejected = 0, ok = 0;
  for (let fi = 0; fi < MOC_FILES.length; fi++) {
    const src = new Uint8Array(readFileSync(MOC_FILES[fi]!));
    const rnd = mulberry(7000 + fi * 13);
    for (let m = 0; m < 56; m++) {
      const s = mutate(src, rnd, m % 6);
      try {
        const r = readMoc(s);
        if (r.ok) {
          ok++;
          if (ok % 4 === 0) {
            try { const c = mocToL2dm(r.moc, { id: "f" }); loadL2dmObject(c); } catch { rejected++; }
          }
        } else rejected++;
      } catch (e) {
        crashes++;
        assert.fail("readMoc 抛异常（源 " + MOC_FILES[fi] + " m=" + m + "）: " + (e instanceof Error ? e.message : String(e)));
      }
    }
  }
  assert.equal(crashes, 0, "moc fuzz 应 0 崩溃（实际 " + crashes + "）");
  assert.ok(rejected > 0, "大量坏样本应被拒绝");
});

test("R-P2-1: 空/极短输入（0,1,4,16 字节）不崩", () => {
  for (const n of [0, 1, 4, 16]) {
    const b = new Uint8Array(n);
    assert.equal(readMoc3(b).ok, false, "空 moc3 应拒绝");
    assert.equal(readMoc(b).ok, false, "空 moc 应拒绝");
  }
});

// @l2dp/cutout P4b 测试：PNG 编解码 / 平坦色候选选区 / 按 mask 拆部件 / 质检 / 标注器
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodePng, decodePng, pngToDataUri, dataUriToBytes,
  colorKeyRegions, ColorKeySegmenter, detectBackground,
  cutoutMasked, maskBBox,
  analyzeCutout, finalizeCutout,
  ColorMapLabeler, PositionLabeler,
  type RgbaImage,
} from "../src/index.ts";

function solid(w: number, h: number, r: number, g: number, b: number, a = 255): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return { width: w, height: h, data };
}

function rectIn(image: RgbaImage, x: number, y: number, w: number, h: number, r: number, g: number, b: number, a = 255): void {
  for (let yy = y; yy < Math.min(y + h, image.height); yy++) {
    for (let xx = x; xx < Math.min(x + w, image.width); xx++) {
      const o = (yy * image.width + xx) * 4;
      image.data[o] = r; image.data[o + 1] = g; image.data[o + 2] = b; image.data[o + 3] = a;
    }
  }
}

/** 白底 + 3 个不相接色块：红(上)、绿(左上)、蓝(右) */
function synthScene(): RgbaImage {
  const img = solid(64, 64, 255, 255, 255);
  rectIn(img, 8, 8, 12, 10, 220, 50, 60);   // 红
  rectIn(img, 8, 40, 12, 10, 40, 160, 90);  // 绿
  rectIn(img, 40, 30, 14, 12, 60, 80, 220); // 蓝
  return img;
}

test("P4b: PNG 编解码 roundtrip（RGBA colortype 6）", () => {
  const img = synthScene();
  const bytes = encodePng(img.width, img.height, img.data);
  assert.ok(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);
  const dec = decodePng(bytes);
  assert.equal(dec.width, 64);
  assert.equal(dec.height, 64);
  assert.deepEqual([...dec.data], [...img.data]);
  // dataUri 往返
  const uri = pngToDataUri(bytes);
  assert.ok(uri.startsWith("data:image/png;base64,"));
  const back = decodePng(dataUriToBytes(uri));
  assert.deepEqual([...back.data], [...img.data]);
});

test("P4b: 平坦色连通域候选（背景剔除 + 碎片过滤 + bbox/主色）", () => {
  const img = synthScene();
  const bg = detectBackground(img);
  assert.deepEqual(bg, [255, 255, 255]);
  const regions = colorKeyRegions(img, { tol: 8, minArea: 20 });
  assert.equal(regions.length, 3);
  const colors = regions.map((r) => r.color).sort((a, b) => a[0] - b[0]); // 按 R 排序
  assert.deepEqual(colors[0], [40, 160, 90]); // 绿
  assert.deepEqual(colors[1], [60, 80, 220]); // 蓝
  assert.deepEqual(colors[2], [220, 50, 60]); // 红
  const red = regions.find((r) => r.color[0] === 220)!;
  assert.deepEqual(red.bbox, { x: 8, y: 8, width: 12, height: 10 });
});

test("P4b: 碎片过滤——小于 minArea 的区域被丢弃", () => {
  const img = solid(32, 32, 255, 255, 255);
  rectIn(img, 4, 4, 3, 3, 10, 10, 10);   // 9 px → 小于 20 → 丢弃
  rectIn(img, 20, 20, 8, 8, 10, 10, 10); // 64 px → 保留
  const regions = colorKeyRegions(img, { tol: 4, minArea: 20 });
  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0]!.bbox, { x: 20, y: 20, width: 8, height: 8 });
});

test("P4b: ColorMapLabeler 按色板标注 → 拆部件 + 质检（覆盖率/重叠）", async () => {
  const img = solid(64, 64, 255, 255, 255, 0); // 透明背景（模拟已抠图的原图）
  rectIn(img, 8, 8, 12, 10, 220, 50, 60);
  rectIn(img, 8, 40, 12, 10, 40, 160, 90);
  rectIn(img, 34, 16, 12, 10, 60, 80, 220);
  const seg = new ColorKeySegmenter({ tol: 8, minArea: 20 });
  const cands = await seg.segment(img);
  const labeler = new ColorMapLabeler([
    { color: [220, 50, 60], semantic: "hair_front" },
    { color: [40, 160, 90], semantic: "face" },
    { color: [60, 80, 220], semantic: "mouth" },
  ]);
  const parts = await labeler.label(cands, img);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => p.semantic).sort(), ["face", "hair_front", "mouth"]);
  for (const p of parts) {
    assert.ok(p.image.dataUri.startsWith("data:image/png;base64,"));
    assert.ok(p.bbox.width >= 1 && p.bbox.height >= 1);
  }
  const result = finalizeCutout(img, parts);
  // 3 色块约占画布的 (120+120+168)/4096 ≈ 9.9%，覆盖率只算输入非透明像素（即色块）→ ~100%
  assert.ok(result.coveragePct > 95, "覆盖率 " + result.coveragePct + "%");
  assert.equal(result.overlapPct, 0);
  assert.equal(result.issues.length, 0);
});

test("P4b: PositionLabeler 模板槽按 IoU 分配（含左右）", async () => {
  const img = solid(100, 100, 255, 255, 255);
  rectIn(img, 10, 10, 20, 20, 200, 30, 30);  // 左眼槽
  rectIn(img, 60, 10, 20, 20, 30, 200, 30);  // 右眼槽
  const seg = new ColorKeySegmenter({ tol: 8, minArea: 20 });
  const cands = await seg.segment(img);
  const labeler = new PositionLabeler([
    { semantic: "eye", side: "left", region: { x: 10, y: 10, width: 20, height: 20 } },
    { semantic: "eye", side: "right", region: { x: 60, y: 10, width: 20, height: 20 } },
  ]);
  const parts = await labeler.label(cands, img);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => [p.semantic, p.side ?? null]).sort((a, b) => (a[1] ?? "").localeCompare(b[1] ?? "")), [
    ["eye", "left"],
    ["eye", "right"],
  ]);
});

test("P4b: split/cutout 掩码 bbox 与像素", () => {
  const img = solid(50, 50, 255, 255, 255);
  rectIn(img, 10, 10, 10, 10, 0, 0, 0);
  const mask = new Uint8Array(50 * 50);
  for (let y = 12; y < 20; y++) for (let x = 10; x < 18; x++) mask[y * 50 + x] = 1;
  const bbox = maskBBox(mask, 50, 50);
  assert.deepEqual(bbox, { x: 10, y: 12, width: 8, height: 8 });
  const parts = cutoutMasked(img, [{ region: { mask, pixels: 64 }, semantic: "face" }]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]!.bbox.width, 8);
  const dec = decodePng(dataUriToBytes(parts[0]!.image.dataUri));
  assert.equal(dec.width, 8);
  assert.equal(dec.height, 8);
  assert.equal(dec.data[0], 0); // (10,12) 在原图为黑色方块内，掩码覆盖 → 黑
});

test("P4b: 分割器/标注器确定性（同输入同输出）", async () => {
  const img = synthScene();
  const seg = new ColorKeySegmenter({ tol: 8, minArea: 20 });
  const a = await seg.segment(img);
  const b = await seg.segment(img);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(a[i]!.bbox, b[i]!.bbox);
    assert.deepEqual([...a[i]!.mask!], [...b[i]!.mask!]);
  }
});

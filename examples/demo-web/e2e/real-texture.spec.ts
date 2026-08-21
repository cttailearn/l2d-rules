// e2e/real-texture.spec.ts —— 真实浏览器：demo-web 默认呈现 = 官方 Haru 真实模型
// 覆盖：
//   1) 缺省 ?model=haru-full.l2dm（真实几何 + 真实纹理，WebGL2·线性过滤·透明背景）
//   2) 软件后端像素断言：透明背景（角色外 alpha=0）+ 真实几何铺满（不透明像素大）
//   3) demo.l2dm 显式路径：语义骨架 + warp 形变（向后兼容路径）
import { test, expect } from "@playwright/test";

interface DemoInfo {
  model: string;
  atlasSize: number;
  canvas: [number, number];
  renderer: string;
  filter: string;
  warpCount: number;
}

test("默认加载 haru-full.l2dm：真实模型（WebGL2·线性过滤·透明）", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => (window as unknown as { __demoInfo?: DemoInfo }).__demoInfo !== undefined,
    undefined,
    { polling: 200 },
  );
  const info = (await page.evaluate(
    () => (window as unknown as { __demoInfo: DemoInfo }).__demoInfo,
  )) as DemoInfo;

  expect(info.model).toBe("haru-full.l2dm");
  expect(info.atlasSize).toBe(2); // 浏览器端 PNG 解码成功：2 张 2048² Haru 纹理
  // 真实网格画布（远超占位 80×64 马赛克）
  expect(info.canvas[0]).toBeGreaterThan(500);
  expect(info.canvas[1]).toBeGreaterThan(500);
  expect(info.filter).toBe("linear"); // 官方平滑观感（非像素化）
  expect(info.warpCount).toBe(0); // 真实几何：warp keyform 为 convert 下一里程碑
  // 渲染后端：真实 Chromium 提供 WebGL2，软件为兜底
  expect(["webgl2", "software"]).toContain(info.renderer);
});

test("软件光栅透明显像：背景透明（alpha=0）+ 真实几何铺满", async ({ page }) => {
  await page.goto("/?renderer=software");
  await page.waitForFunction(
    () => (window as unknown as { __demoInfo?: DemoInfo }).__demoInfo !== undefined,
    undefined,
    { polling: 200 },
  );
  await page.waitForTimeout(250); // 等至少一帧渲染
  const r = (await page.evaluate(() => {
    const cv = document.getElementById("canvas") as HTMLCanvasElement;
    const ctx = cv.getContext("2d");
    if (!ctx) return { error: "软件路径应提供 2d context" };
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let opaque = 0;
    let transparent = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i]! > 0) opaque++;
      else transparent++;
    }
    return { opaque, transparent };
  })) as { error?: string; opaque: number; transparent: number };
  if (r.error) throw new Error(r.error);
  // 官方呈现：透明背景（角色外是 alpha=0，非黑底）
  expect(r.transparent).toBeGreaterThan(100_000);
  // 真实几何铺满大量不透明像素
  expect(r.opaque).toBeGreaterThan(100_000);
});

test("demo.l2dm 显式路径：语义骨架 + warp 形变", async ({ page }) => {
  await page.goto("/?model=demo.l2dm");
  await page.waitForFunction(
    () => (window as unknown as { __demoInfo?: DemoInfo }).__demoInfo !== undefined,
    undefined,
    { polling: 200 },
  );
  const info = (await page.evaluate(
    () => (window as unknown as { __demoInfo: DemoInfo }).__demoInfo,
  )) as DemoInfo;
  expect(info.model).toBe("demo.l2dm");
  expect(info.atlasSize).toBe(0);
  expect(info.canvas).toEqual([30, 30]);
  expect(info.warpCount).toBeGreaterThan(0); // 语义骨架带 warp 形变
});

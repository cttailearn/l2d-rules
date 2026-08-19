// e2e/parity.spec.ts —— M3 DoD：WebGL2.readPixels 与软件渲染逐像素一致（容差 ±1）
// 真实 Chromium WebGL2 上下文执行（非 stub），关闭空洞的「跳过即算过」。

import { test, expect } from "@playwright/test";
import type { ParityResult } from "./parity.ts";

test("M3: WebGL2 readPixels 与软件渲染逐像素一致（容差 ±1）", async ({ page }) => {
  await page.goto("/e2e/parity.html");
  await page.waitForFunction(() => (window as unknown as { __parity?: ParityResult }).__parity !== undefined);
  const r = await page.evaluate(() => (window as unknown as { __parity?: ParityResult }).__parity!) as ParityResult;

  // 三个场景都跑通，且确实用了 WebGL2（拒绝环境缺失时静默跳过）
  expect(r.webgl2, "环境应提供 WebGL2 上下文（Chromium 默认开启）").toBe(true);
  expect(r.error).toBeUndefined();
  expect(r.scenes).toEqual(["solid-triangle", "solid-quad", "textured-uniform"]);

  // 逐像素一致性：差异像素 0，最大通道差 ≤ 1
  expect(r.diffs, `存在 ${r.diffs} 个通道差异超出容差 ±1`).toBe(0);
  expect(r.maxDelta).toBeLessThanOrEqual(1);
  expect(r.pass).toBe(true);
});

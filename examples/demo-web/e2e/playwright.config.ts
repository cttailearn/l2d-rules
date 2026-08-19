// e2e/playwright.config.ts —— 真实浏览器端 WebGL2 逐像素一致性（M3 DoD 执行路径）
import { defineConfig } from "@playwright/test";

export default defineConfig({
  // 配置文件本身就在 e2e/ 内：testDir 相对配置目录解析，故为 "."（曾误写 "./e2e" → 指向 e2e/e2e，"No tests found"）
  testDir: ".",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5199",
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "npm run dev -- --port 5199 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

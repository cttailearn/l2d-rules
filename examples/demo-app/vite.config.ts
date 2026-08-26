import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// demo-app：浏览器端直接编译工作区 TS 源码（零构建产物，alias 直指各包 src）
const pkg = (name: string): string => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@l2dp/engine": pkg("engine"),
      "@l2dp/driver": pkg("driver"),
      "@l2dp/l2dp": pkg("l2dp"),
      "@l2dp/cutout": pkg("cutout"),
      "@l2dp/create": pkg("create"),
      "@l2dp/rig": pkg("rig"),
    },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
  },
  build: { outDir: "dist" },
});

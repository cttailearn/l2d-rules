// prepare-official.mjs —— 把 demo-real 的官方 Haru sample 复制到 demo-web/public/official-haru
// 目的：官方向 Cubism SDK（右侧）加载真实 .model3/.moc3 资源；也与当前引擎的 .l2dm（左侧）做并排对比。
// 只复制用户本地合法的官方 sample 文件，不复制/分发官方 SDK 代码（CDN 运行时加载）。
// 运行：node scripts/prepare-official.mjs（or npm run prepare:official）
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..", "demo-real", "assets-src", "haru");
const OUT = join(here, "..", "public", "official-haru");

await mkdir(OUT, { recursive: true });
// 递归复制官方 Haru 目录（model3/moc3/cdi3/physics3/pose3/userdata3/expressions/motions/textures）
await cp(SRC, OUT, { recursive: true });
console.log(`✅ 已复制官方 Haru sample → ${OUT}`);
const files = [];
async function walk(d) {
  const { readdir, stat } = await import("node:fs/promises");
  for (const e of await readdir(d)) {
    const p = join(d, e);
    if ((await stat(p)).isDirectory()) await walk(p);
    else files.push(p);
  }
}
await walk(OUT);
console.log(`   共 ${files.length} 个文件（含 Haru.model3.json / Haru.moc3 / 纹理 / motions / expressions）`);

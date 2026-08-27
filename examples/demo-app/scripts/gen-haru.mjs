// gen-haru.mjs - 生成 demo-app 的自包含真实几何模型（public/haru-full.l2dm）
// 链路：Haru.moc3 二进制 + 官方 CubismCore 运行时（examples/live2d/live2d_3/js，Node 内 vm 加载）
//      -> 提取每个 ArtMesh 的「默认姿态」真实几何（vertexPositions/indices/vertexUvs/drawOrder/纹理）
//      -> 按默认姿态 opacity 过滤（剔除可切换的隐藏手臂/衣物层）→ 烘焙为自包含 .l2dm（与官方渲染基准一致）。
// 说明：build-time 脚本用官方 Core 提取基准姿态；@l2dp/convert 的 moc3ToL2dm 保持零平台依赖，
//      其「keyform 形变管线（warp 动画）」为下一里程碑（见 docs/MOC3-PHASE2-PLAN.md）。
// 运行：node scripts/gen-haru.mjs（or npm run gen:haru）

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import vm from "node:vm";
import { loadL2dmObject } from "@l2dp/engine";
import { readMoc3 } from "@l2dp/convert";

const here = dirname(fileURLToPath(import.meta.url));
const HARU = join(here, "..", "public", "official-haru") + sep;
const CORE_JS = join(here, "..", "..", "..", "examples", "live2d", "live2d_3", "js", "live2dcubismcore.min.js");
const OUT = join(here, "..", "public", "haru-full.l2dm");
const TARGET_HEIGHT = 1100;

/** 在 Node 里加载官方 CubismCore（asm.js，vm 全局执行）并返回全局命名空间。 */
function loadCubismCore() {
  const src = readFileSync(CORE_JS, "utf8");
  vm.runInThisContext(src);
  const L = globalThis.Live2DCubismCore;
  if (!L || !L.Moc || !L.Model) throw new Error("live2dcubismcore 加载失败");
  return L;
}

async function main() {
  const model3Raw = JSON.parse(await readFile(join(HARU, "Haru.model3.json"), "utf8"));
  const mocBytes = new Uint8Array(await readFile(join(HARU, model3Raw.FileReferences.Moc)));
  const texNames = model3Raw.FileReferences.Textures ?? [];

  // ---- 用官方 CubismCore 提取基准姿态几何 ----
  const L = loadCubismCore();
  const moc = L.Moc.fromArrayBuffer(mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength));
  const model = L.Model.fromMoc(moc);
  model.update();
  const D = model.drawables;

  const ids = Array.from(D.ids ?? []);
  const vp = D.vertexPositions ?? [];
  const vu = D.vertexUvs ?? [];
  const idx = D.indices ?? [];
  const texIdx = Array.from(D.textureIndices ?? []);
  // 绘制顺序：官方 renderOrder（若 Core 提供）优先，否则用 drawable 索引
  const renderOrders = Array.from(D.renderOrders ?? []);
  // 默认姿态可见性：官方模型常把「可切换的手臂/衣物层」默认隐藏（参数 opacity=0），
  // 烘焙若全部导出会出现“多双手重叠/多套衣身”。只保留默认姿态 opacity>阈值的网格。
  const opacities = D.opacities != null ? Array.from(D.opacities) : null;
  const opacityAt = (i) => {
    if (!opacities) return 1; // Core 未暴露 → 全部保留（兼容旧环境）
    const v = opacities[i];
    return typeof v === "number" ? v : 1;
  };

  // ---- 可见网格的基准姿态包围盒（目标高度 TARGET_HEIGHT 缩放）----
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const visible = [];
  for (let i = 0; i < ids.length; i++) {
    const arr = vp[i];
    if (!arr || arr.length < 6) continue;
    if (!(opacityAt(i) > 0.5)) continue; // 隐藏层（默认姿态不可见）不导出 → 修复“多手臂重叠”
    for (let k = 0; k < arr.length; k += 2) {
      const x = arr[k], y = arr[k + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    visible.push(i);
  }
  if (!Number.isFinite(minX)) throw new Error("没有读到任何顶点");
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = TARGET_HEIGHT / spanY;
  const cw = Math.max(1, Math.round((maxX - minX) * scale));
  const toPxX = (x) => (x - minX) * scale;
  const toPxY = (y) => (maxY - y) * scale;

  // ---- 每 drawable -> .l2dm part（按官方 renderOrder 升序；三角形归一为 CCW）----
  const orderList = visible.map((i) => ({ i, o: (renderOrders[i] ?? i) }));
  orderList.sort((a, b) => a.o - b.o);
  const parts = [];
  orderList.forEach((entry, orderIdx) => {
    const i = entry.i;
    const posArr = vp[i];
    const idxArr = idx[i];
    const uvArr = vu[i];
    if (!posArr || !idxArr || idxArr.length % 3 !== 0) return;
    const vertices = [];
    const uvs = [];
    for (let k = 0; k < posArr.length; k += 2) {
      vertices.push(toPxX(posArr[k]), toPxY(posArr[k + 1]));
    }
    for (let k = 0; k < uvArr.length; k += 2) {
      // moc3 UV 的 v=0 在底（OpenGL 约定）-> .l2dm/引擎 v=0 在顶 -> 翻转
      uvs.push(uvArr[k], 1 - uvArr[k + 1]);
    }
    // 归一化为 CCW：y 翻转会把楔形反转，软件光栅只画 CCW（edge 函数要求同号）
    const indices = Array.from(idxArr);
    const tri = (n) => vertices[n * 2];
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = indices[t], b2 = indices[t + 1], c2 = indices[t + 2];
      const cross = (tri(b2) - tri(a)) * (vertices[c2 * 2 + 1] - vertices[a * 2 + 1]) - (tri(c2) - tri(a)) * (vertices[b2 * 2 + 1] - vertices[a * 2 + 1]);
      if (cross < 0) { indices[t + 1] = c2; indices[t + 2] = b2; }
    }
    const ti = texIdx[i];
    const part = {
      id: ids[i] ?? ("drawable_" + i),
      order: orderIdx + 1,
      color: [1, 1, 1, 1],
      texture: Number.isInteger(ti) && ti >= 0 && ti < texNames.length ? texNames[ti] : undefined,
      mesh: { vertices, uvs, indices },
    };
    parts.push(part);
  });

  // ---- 参数面（cdi3/moc3 权威值）----
  const parsed = readMoc3(mocBytes);
  if (!parsed.ok) throw new Error("readMoc3 失败: " + parsed.error);
  const S = parsed.moc.sections;
  const num = (name) => S[name] ?? [];
  const pIds = num("parameter.ids");
  const pMax = num("parameter.max_values");
  const pMin = num("parameter.min_values");
  const pDef = num("parameter.default_values");
  const parameters = pIds.map((id, i) => ({
    id: String(id),
    min: pMin[i] ?? 0,
    max: pMax[i] ?? 0,
    def: pDef[i] ?? (pMin[i] ?? 0),
  }));

  const l2dm = {
    formatVersion: 1,
    id: "Haru",
    canvas: { width: cw, height: TARGET_HEIGHT },
    parameters,
    parts,
  };

  // ---- 内嵌纹理 atlas -> 自包含 ----
  const textures = [];
  for (const t of texNames) {
    try { textures.push({ file: t, bytes: new Uint8Array(await readFile(join(HARU, t))) }); }
    catch { /* 缺纹理也允许 */ }
  }
  const atlas = {};
  for (const t of textures) {
    const b64 = Buffer.from(t.bytes).toString("base64");
    atlas[t.file] = "data:image/png;base64," + b64;
  }
  l2dm.atlas = atlas;

  const v = loadL2dmObject(l2dm);
  if (!v.ok) throw new Error("engine 校验失败: " + v.error);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(l2dm));
  const size = (await stat(OUT)).size;
  const meshes = parts.filter((p) => p.mesh).length;
  console.log("已生成 " + OUT);
  console.log("大小 " + (size / 1024 / 1024).toFixed(2) + " MB ArtMesh " + parts.length + " 网格 " + meshes + " 参数 " + parameters.length + " 画布 " + cw + "x" + TARGET_HEIGHT + " 纹理 " + Object.keys(atlas).length);
  console.log("几何来源 = 官方 CubismCore 基准姿态提取（与官方渲染基准一致）；warp 形变管线为 convert 下一里程碑");
}

main().catch((e) => { console.error("生成失败:", e); process.exit(1); });
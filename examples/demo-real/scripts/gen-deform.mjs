// gen-deform.mjs - 烘焙官方精确动画：官方 CubismCore 逐参数关键帧 → .l2dm mesh.warps
// 链路：Haru.moc3 + 官方 Core（Node vm）→ 每参数关键帧的精确形变体积 → 自包含 .l2dm（真实索引/UV/纹理 + warps）
// 与 gen-real.mjs 同哲学：构建期用官方 Core 提取基准；产物零运行时依赖，引擎逐参数插值即官方动画级一致。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { loadL2dmObject } from "@l2dp/engine";
import { readMoc3, bandAxis } from "@l2dp/convert";

const here = dirname(fileURLToPath(import.meta.url));
const HARU = join(here, "..", "assets-src", "haru") + "/";
const CORE_JS = join(here, "..", "..", "..", "examples", "live2d", "live2d_3", "js", "live2dcubismcore.min.js");
const OUT = join(here, "..", "out", "haru-anim.l2dm");
const TARGET_HEIGHT = 1100;

function loadCore() {
  vm.runInThisContext(readFileSync(CORE_JS, "utf8"));
  const L = globalThis.Live2DCubismCore;
  if (!L || !L.Moc || !L.Model) throw new Error("official core load failed");
  return L;
}

async function main() {
  const model3Raw = JSON.parse(await readFile(join(HARU, "Haru.model3.json"), "utf8"));
  const mocBytes = new Uint8Array(await readFile(join(HARU, model3Raw.FileReferences.Moc)));
  const texNames = model3Raw.FileReferences.Textures ?? [];
  const parsed = readMoc3(mocBytes);
  if (!parsed.ok) throw new Error(parsed.error);
  const S = parsed.moc.sections;
  const num = (n) => S[n] ?? [];
  const pIds = num("parameter.ids").map((s) => String(s));
  const pMax = num("parameter.max_values");
  const pMin = num("parameter.min_values");
  const pDef = num("parameter.default_values");

  const L = loadCore();
  const moc = L.Moc.fromArrayBuffer(mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength));
  const model = L.Model.fromMoc(moc);
  const P = model.parameters;
  const pv = P.values;
  pv.fill(0); // 全部默认（Haru 默认全 0）
  const D = model.drawables;
  const snap = () => Array.from(D.vertexPositions).map((a) => Array.from(a));

  model.update();
  const REST = snap();
  // 包围盒（可见 drawable）→ 目标高度像素帧
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < REST.length; i++) {
    const arr = REST[i];
    if (!arr || arr.length < 6) continue;
    for (let k = 0; k < arr.length; k += 2) {
      if (!Number.isFinite(arr[k]) || !Number.isFinite(arr[k + 1])) continue;
      if (arr[k] < minX) minX = arr[k]; if (arr[k] > maxX) maxX = arr[k];
      if (arr[k + 1] < minY) minY = arr[k + 1]; if (arr[k + 1] > maxY) maxY = arr[k + 1];
    }
  }
  if (!Number.isFinite(minX)) throw new Error("no vertices");
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = TARGET_HEIGHT / spanY;
  const canvas = { width: Math.max(1, Math.round((maxX - minX) * scale)), height: TARGET_HEIGHT };
  const px = (x, y) => [(x - minX) * scale, (maxY - y) * scale];

  // 每 drawable 关键帧值集合：bandAxis 聚合 + 默认
  const keySets = pIds.map(() => null);
  for (let mi = 0; mi < 82; mi++) { }
  // 遍历 warp/art/deformer band → param 的 key 值
  const relevant = new Set([]);
  const keysFor = new Map();
  for (const bandName of ["warp_deformer", "rotation_deformer", "deformer", "art_mesh", "part"]) {
    const bandArr = num(bandName + ".keyform_binding_band_indices");
    for (let i = 0; i < bandArr.length; i++) {
      const b = bandArr[i];
      if (b === undefined || b < 0) continue;
      const ax = bandAxis(parsed.moc, b);
      if (!ax.param || !ax.keys.length) continue;
      relevant.add(ax.param);
      const cur = keysFor.get(ax.param) ?? new Set();
      for (const k of ax.keys) cur.add(+k.toFixed(2));
      keysFor.set(ax.param, cur);
    }
  }

  // 结构（索引/UV/纹理/绘制顺序）用 @l2dp/convert 的 moc3ToL2dm 装配，顶点用官方 rest 覆盖，warps 用官方体积烘焙
  const convertPkg = await import("@l2dp/convert");
  const skeleton = convertPkg.moc3ToL2dm(parsed.moc, {
    id: "Haru",
    groups: [],
    textures: texNames.map((t) => t),
    targetHeight: TARGET_HEIGHT,
    deform: false, // 结构仅；顶点/形变由官方烘焙覆盖
  });

  // 官方参数名顺序（Core）与 pIds 一致
  const pidArr = Array.from(P.ids);
  const warpsByPart = skeleton.parts.map(() => []);
  const B = 0;
  // 基态（全部默认）已取 REST
  const restPx = REST.map((arr) => {
    const o = [];
    for (let k = 0; k < arr.length; k += 2) o.push(...px(arr[k], arr[k + 1]));
    return o;
  });
  for (let pi = 0; pi < pIds.length; pi++) {
    const pid = pIds[pi];
    let values = keysFor.get(pid) ? [...keysFor.get(pid)] : [];
    const def = pDef[pi] ?? 0;
    if (values.length === 0) {
      // 无 keyform 绑定的参数：采样默认即静止（跳过，避免无意义烘焙）
      continue;
    }
    if (!values.includes(+def.toFixed(2))) values.push(+def.toFixed(2));
    values.sort((a, b) => a - b);
    options: for (let vi = 0; vi < values.length; vi++) {
      const v = values[vi];
      if (Math.abs(v - def) < 1e-4) continue; // 默认帧零偏移，不用烘焙
      pv[pi] = v; model.update();
      const FRAME = snap();
      for (let di = 0; di < FRAME.length; di++) {
        const part = skeleton.parts[di];
        if (!part || !part.mesh) continue;
        const rest = restPx[di];
        const off = [];
        for (let q = 0; q < FRAME[di].length; q += 2) {
          const [dx, dy] = [(FRAME[di][q] - REST[di][q]) * scale, -(FRAME[di][q + 1] - REST[di][q + 1]) * scale];
          off.push(+(+dx).toFixed(4), +(+dy).toFixed(4));
        }
        if (off.length === rest.length) {
          if (!warpsByPart[di]) warpsByPart[di] = [];
          warpsByPart[di].push({ parameter: pid, keyforms: [{ value: v, offsets: off }] });
        }
      }
    }
    pv[pi] = def;
  }
  // 重置其余参数（并保证默认）
  pv.fill(0);

  // 装配：顶点=官方 rest；合并同参数 keyforms 单调排序；内嵌纹理
  skeleton.parts.forEach((part, di) => {
    if (!part.mesh) return;
    part.mesh.vertices = restPx[di];
    const ws = warpsByPart[di] ?? [];
    if (ws.length) {
      const byP = new Map();
      for (const w of ws) {
        if (!byP.has(w.parameter)) byP.set(w.parameter, []);
        byP.get(w.parameter).push(...w.keyforms);
      }
      part.mesh.warps = [...byP.entries()].map(([parameter, keyforms]) => {
        keyforms.sort((a, b) => a.value - b.value);
        // 校验要求 ≥2：默认帧（value=def, 零偏移）必须存在
        const def = skeleton.parameters.find((q) => q.id === parameter)?.def ?? 0;
        const hasDef = keyforms.some((k) => Math.abs(k.value - def) < 1e-3);
        if (!hasDef && part.mesh) {
          keyforms.unshift({ value: def, offsets: new Array(part.mesh.vertices.length).fill(0) });
          keyforms.sort((a, b) => a.value - b.value);
        }
        return { parameter, keyforms };
      });
    }
  });
  skeleton.canvas = canvas;
  // 内嵌纹理
  const atlas = {};
  for (const t of texNames) {
    try {
      const b = new Uint8Array(await readFile(join(HARU, t)));
      atlas[t] = "data:image/png;base64," + Buffer.from(b).toString("base64");
    } catch { }
  }
  skeleton.atlas = atlas;

  const v = loadL2dmObject(skeleton);
  if (!v.ok) throw new Error("engine validate: " + v.error);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(skeleton));
  const nW = skeleton.parts.filter((p) => p.mesh?.warps?.length).length;
  let nKf = 0; for (const p of skeleton.parts) for (const w of p.mesh?.warps ?? []) nKf += w.keyforms.length;
  console.log("wrote " + OUT);
  console.log("canvas " + canvas.width + "x" + canvas.height + " parts " + skeleton.parts.length + " warpedParts " + nW + " keyframes " + nKf + " params " + pIds.length);
}

main().catch((e) => { console.error("gen-deform failed:", e); process.exit(1); });

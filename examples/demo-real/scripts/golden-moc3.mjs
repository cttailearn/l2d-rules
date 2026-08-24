// golden-moc3.mjs - M5 像素 golden：引擎(L2dmPlayer+warps) vs 官方 CubismCore（同一光栅化器、同一纯色方案）
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { L2dmPlayer, SoftwareRenderer, loadL2dmObject } from "@l2dp/engine";

const here = dirname(fileURLToPath(import.meta.url));
const HARU = join(here, "..", "assets-src", "haru") + "/";
const CORE_JS = join(here, "..", "..", "..", "examples", "live2d", "live2d_3", "js", "live2dcubismcore.min.js");
const ANIM = join(here, "..", "out", "haru-anim.l2dm");
const TARGET_HEIGHT = 1100;

vm.runInThisContext(readFileSync(CORE_JS, "utf8"));
const L = globalThis.Live2DCubismCore;
const model3Raw = JSON.parse(readFileSync(join(HARU, "Haru.model3.json"), "utf8"));
const mocBytes = new Uint8Array(readFileSync(join(HARU, model3Raw.FileReferences.Moc)));
const moc = L.Moc.fromArrayBuffer(mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength));
const model = L.Model.fromMoc(moc);
const pv = model.parameters.values;
const pidArr = Array.from(model.parameters.ids);
const D = model.drawables;
const setP = (n, v) => { const i = pidArr.indexOf(n); if (i >= 0) pv[i] = v; };

// ---- 引擎侧：haru-anim.l2dm（内部已有 warps；去纹理用纯色）----
const anim = JSON.parse(readFileSync(ANIM, "utf8"));
const solid = structuredClone(anim);
const gray = (i) => 64 + (i % 6) * 28;
for (let i = 0; i < solid.parts.length; i++) { solid.parts[i].texture = undefined; solid.parts[i].color = [gray(i)/255, gray(i)/255, (255-gray(i))/255, 1]; }
const lr = loadL2dmObject(solid);
if (!lr.ok) throw new Error("engine validate: " + lr.error);
const player = new L2dmPlayer(lr.model, new Map());
const swE = new SoftwareRenderer();
function renderEngine(state) {
  for (const [n, v] of Object.entries(state)) player.params.set(n, v);
  swE.begin(anim.canvas.width, anim.canvas.height);
  player.render(swE);
  swE.end();
  return swE.readPixels();
}

// ---- 官方侧：同一 bbox 映射 + 同一纯色 ----
pv.fill(0); model.update();
const REST = Array.from(D.vertexPositions).map((a) => Array.from(a));
let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
for (const arr of REST) { if (!arr || arr.length < 6) continue; for (let k=0;k<arr.length;k+=2){ const x=arr[k],y=arr[k+1]; if (!Number.isFinite(x)||!Number.isFinite(y)) continue; if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; } }
const spanY = Math.max(maxY-minY, 1e-6);
const scale = TARGET_HEIGHT/spanY;
const canvasW = Math.max(1, Math.round((maxX-minX)*scale));
const px = (x,y) => [(x-minX)*scale, (maxY-y)*scale];
const swO = new SoftwareRenderer();
function renderOfficial(state) {
  pv.fill(0);
  for (const [n, v] of Object.entries(state)) setP(n, v);
  model.update();
  const VP = Array.from(D.vertexPositions).map((a) => Array.from(a));
  swO.begin(canvasW, TARGET_HEIGHT);
  const orderList = anim.parts.map((p, i) => ({ i, o: p.order })).sort((a, b) => a.o - b.o);
  for (const { i } of orderList) {
    const part = anim.parts[i];
    if (!part.mesh || !VP[i]) continue;
    const vp = VP[i];
    const verts = new Float32Array(vp.length);
    for (let k = 0; k < vp.length; k += 2) { const [xp, yp] = px(vp[k], vp[k+1]); verts[k]=xp; verts[k+1]=yp; }
    const g = gray(i);
    swO.draw({ verts, uvs: new Float32Array(part.mesh.uvs), indices: part.mesh.indices, texId: null, color: [g, g, 255-g, 255] });
  }
  swO.end();
  return swO.readPixels();
}

// ---- 对照 ----
const states = [
  { label: "rest", s: {} },
  { label: "BustY+1   (key)", s: { ParamBustY: 10 } },
  { label: "BodyAngleZ+8 (key)", s: { ParamBodyAngleZ: 8 } },
  { label: "BodyAngleZ-6 (interp)", s: { ParamBodyAngleZ: -6 } },
  { label: "EyeLOpen+10 (key)", s: { ParamEyeLOpen: 10 } },
  { label: "AngleZ+10 (interp)", s: { ParamAngleZ: 10 } },
  { label: "combined (interp)", s: { ParamBustY: 7, ParamBodyAngleZ: -5, ParamEyeLOpen: 12, ParamAngleZ: 6 } },
];
let allPass = true;
for (const { label, s } of states) {
  const a = renderEngine(s);
  const b = renderOfficial(s);
  let diffPix = 0, totPix = 0, sumAbs = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]-b[i]);
    sumAbs += d;
    if (d > 2) diffPix++;
    totPix++;
  }
  const pct = (100*diffPix/totPix).toFixed(3);
  const mean = (sumAbs/totPix).toFixed(3);
  const pass = diffPix/totPix < 0.02;
  if (!pass) allPass = false;
  console.log((pass ? "PASS " : "FAIL ") + label + "  像素diff " + pct + "%  meanAbs " + mean + "  (" + diffPix + "/" + totPix + ")");
}
console.log(allPass ? "M5 golden: 全部通过（引擎vs官方 动画级一致）" : "M5 golden: 存在超过 2% 像素差异的状态");

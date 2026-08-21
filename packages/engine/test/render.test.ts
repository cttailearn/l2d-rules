import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareRenderer, type RenderMesh, type GL2, createWebGL2Renderer, type Tex2D } from "../src/index.ts";

// ================= SoftwareRenderer =================

test("M3: 纯色三角形——期望像素", () => {
  const r = new SoftwareRenderer();
  r.begin(10, 10);
  // 一个右上覆盖大半的三角形：占用像素（近似）由光栅化决定
  r.draw({
    verts: new Float32Array([0, 0, 10, 0, 0, 10]),
    uvs: new Float32Array([0, 0, 0, 0, 0, 0]),
    indices: [0, 1, 2],
    texId: null,
    color: [255, 0, 0, 255],
  });
  r.end();
  // 中心像素应为红色
  const c = r.pixel(3, 3);
  assert.deepEqual(c, [255, 0, 0, 255]);
  // 角落（三角形外）应为透明
  const bg = r.pixel(9, 9);
  assert.deepEqual(bg, [0, 0, 0, 0]);
});

test("M3: 纹理三角形——UV 采样", () => {
  const r = new SoftwareRenderer();
  r.uploadTexture("red", { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) });
  // 纹理 2x1：左=红(255,0,0)，右=蓝(0,0,255)；uv(0,0)=左，uv(1,0)=右
  r.begin(8, 8);
  r.draw({
    verts: new Float32Array([0, 0, 8, 0, 0, 8, 8, 8]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    indices: [0, 1, 2, 2, 1, 3],
    texId: "red",
    color: [255, 255, 255, 255],
  });
  r.end();
  // 左侧像素 → 红
  assert.deepEqual(r.pixel(1, 1), [255, 0, 0, 255]);
  // 右侧像素 → 蓝
  assert.deepEqual(r.pixel(7, 7), [0, 0, 255, 255]);
});

test("M3: tint 叠加（着色系数）", () => {
  const r = new SoftwareRenderer();
  r.uploadTexture("white", { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
  r.begin(4, 4);
  r.draw({
    verts: new Float32Array([0, 0, 4, 0, 0, 4]),
    uvs: new Float32Array([0, 0, 0, 0, 0, 0]),
    indices: [0, 1, 2],
    texId: "white",
    color: [255, 0, 0, 255], // 白×红 = 红
  });
  r.end();
  assert.deepEqual(r.pixel(1, 1), [255, 0, 0, 255]);
});

test("M3: draw 必须在 begin 之后", () => {
  const r = new SoftwareRenderer();
  assert.throws(() => {
    r.draw({ verts: new Float32Array(0), uvs: new Float32Array(0), indices: [], texId: null, color: [0, 0, 0, 255] });
  }, /begin/);
});

test("M3: countNonTransparent 统计", () => {
  const r = new SoftwareRenderer();
  r.begin(10, 10);
  r.draw({ verts: new Float32Array([0, 0, 10, 0, 0, 10]), uvs: new Float32Array(6), indices: [0, 1, 2], texId: null, color: [1, 1, 1, 255] });
  r.end();
  assert.ok(r.countNonTransparent() > 0);
  assert.ok(r.countNonTransparent() < 100);
});

// ================= WebGL2（命令记录 stub，Node 无真实上下文） =================

/** GL stub：记录 drawElements 次数与用到的程序/纹理，验证命令顺序（确定性） */
function makeGlStub(): GL2 & { calls: string[]; drawCount: number } {
  const calls: string[] = [];
  const r: GL2 & { calls: string[]; drawCount: number } = {
    calls,
    drawCount: 0,
    drawingBufferWidth: 8,
    drawingBufferHeight: 8,
    isContextLost: () => false,
    getError: () => 0,
    TRIANGLES: 4, ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, COLOR_BUFFER_BIT: 16384,
    TEXTURE_2D: 3553, RGBA: 6408, UNSIGNED_BYTE: 5121, NEAREST: 9728, LINEAR: 9729,
    TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
    CLAMP_TO_EDGE: 33071, BLEND: 3042, SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771,
    COMPILE_STATUS: 35713, LINK_STATUS: 35714, FRAGMENT_SHADER: 35632, VERTEX_SHADER: 35633,
    FLOAT: 5126, ELEMENT_ARRAY_BUFFER: 34963, UNSIGNED_SHORT: 5123,
    createShader: () => ({ tag: "shader" } as WebGLShader),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    createProgram: () => ({ tag: "prog" } as WebGLProgram),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    useProgram: () => calls.push("useProgram"),
    deleteProgram: () => {},
    createBuffer: () => ({} as WebGLBuffer),
    bindBuffer: () => {},
    bufferData: () => {},
    deleteBuffer: () => {},
    createTexture: () => ({} as WebGLTexture),
    bindTexture: () => {},
    texImage2D: () => {},
    texParameteri: (_t: number, _p: number, v: number) => { calls.push("texParam:" + v); },
    deleteTexture: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    uniform1i: () => {},
    uniform4fv: () => {},
    uniform2f: () => {},
    getUniformLocation: () => ({} as WebGLUniformLocation),
    viewport: () => {},
    clearColor: () => {},
    clear: () => calls.push("clear"),
    drawElements: () => { calls.push("drawElements"); r.drawCount++; },
    enable: () => {},
    blendFunc: () => {},
    readPixels: () => {},
    activeTexture: () => {},
  };
  return r;
}

test("M3: WebGL2Renderer 命令序列——上传/清屏/绘制（stub 验证）", () => {
  const gl = makeGlStub();
  const r = createWebGL2Renderer(gl);
  r.uploadTexture("t", { width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) });
  r.begin(8, 8);
  r.draw({
    verts: new Float32Array([0, 0, 8, 0, 0, 8]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: [0, 1, 2],
    texId: "t",
    color: [255, 255, 255, 255],
  });
  r.end();
  assert.ok(gl.calls.includes("useProgram"));
  assert.ok(gl.calls.includes("clear"));
  assert.equal(gl.drawCount, 1);
});

test("M3: WebGL2Renderer 无纹理 mesh 也绘制（纯色路径）", () => {
  const gl = makeGlStub();
  const r = createWebGL2Renderer(gl);
  r.begin(8, 8);
  r.draw({ verts: new Float32Array([0, 0, 8, 0, 0, 8]), uvs: new Float32Array(6), indices: [0, 1, 2], texId: null, color: [1, 1, 1, 255] });
  r.end();
  assert.equal(gl.drawCount, 1);
});

// ================= 纹理过滤（官方效果：双线性平滑） =================

/** 2×1 纹理：左 RED / 右 GREEN；全画布 quad（u,v ∈ 0..1）——跨纹素处线性值可精确计算 */
function gridTexture2x1(): Tex2D {
  return {
    width: 2,
    height: 1,
    data: new Uint8Array([
      255, 0, 0, 255,      // 左 RED
      0, 255, 0, 255,      // 右 GREEN
    ]),
  };
}
function draw2x1(r: SoftwareRenderer): void {
  r.uploadTexture("grid", gridTexture2x1());
  r.begin(8, 8);
  r.draw({
    verts: new Float32Array([0, 0, 8, 0, 0, 8, 8, 8]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    indices: [0, 1, 2, 2, 1, 3],
    texId: "grid",
    color: [255, 255, 255, 255],
  });
  r.end();
}

test("M3: 默认 nearest——像素取单个纹素（确定性基准不变）", () => {
  const r = new SoftwareRenderer();
  assert.equal(r.textureFilter, "nearest");
  draw2x1(r);
  // 像素(2,1) 中心 (2.5,1.5)：u=0.3125 → texel floor(0.625)=0 → RED
  assert.deepEqual(r.pixel(2, 1), [255, 0, 0, 255]);
  // 像素(4,2) 中心 (4.5,2.5)：u=0.5625 → texel floor(1.125)=1 → GREEN
  assert.deepEqual(r.pixel(4, 2), [0, 255, 0, 255]);
});

test("M3: 线性采样——跨纹素处为双线性混合（官方平滑效果，精确值）", () => {
  const r = new SoftwareRenderer({ filter: "linear" });
  assert.equal(r.textureFilter, "linear");
  draw2x1(r);
  // 像素(2,1)：u=0.3125 → fx=0.125，RED×0.875 + GREEN×0.125 = (223,32,0)
  assert.deepEqual(r.pixel(2, 1), [223, 32, 0, 255]);
  // 像素(4,2)：u=0.5625 → fx=0.625，RED×0.375 + GREEN×0.625 = (96,159,0)
  assert.deepEqual(r.pixel(4, 2), [96, 159, 0, 255]);
});

test("M3: 线性采样与最近邻在跨纹素处必须不同", () => {
  const nearest = new SoftwareRenderer();
  draw2x1(nearest);
  const linear = new SoftwareRenderer({ filter: "linear" });
  draw2x1(linear);
  const n = nearest.pixel(4, 2);
  const l = linear.pixel(4, 2);
  assert.notDeepEqual(l, n, "跨纹素处线性采样与最近邻必须不同");
  assert.deepEqual(l, [96, 159, 0, 255]);
});

test("M3: WebGL2 linear——texture MIN/MAG 过滤设为 LINEAR (9729)", () => {
  const gl = makeGlStub();
  const r = createWebGL2Renderer(gl, { filter: "linear" });
  assert.equal(r.textureFilter, "linear");
  r.uploadTexture("t", { width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) });
  const linearParams = gl.calls.filter((c) => c === "texParam:9729");
  assert.ok(linearParams.length >= 2, "MIN/MAG 应各设 LINEAR");
  assert.ok(!gl.calls.includes("texParam:9728"), "linear 时不应设置 NEAREST");
});

test("M3: WebGL2 默认 nearest——过滤为 NEAREST (9728)", () => {
  const gl = makeGlStub();
  const r = createWebGL2Renderer(gl);
  assert.equal(r.textureFilter, "nearest");
  r.uploadTexture("t", { width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) });
  const nearestParams = gl.calls.filter((c) => c === "texParam:9728");
  assert.ok(nearestParams.length >= 2, "MIN/MAG 应各设 NEAREST");
  assert.ok(!gl.calls.includes("texParam:9729"), "nearest 时不应设置 LINEAR");
});

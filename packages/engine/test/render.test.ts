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
    TEXTURE_2D: 3553, RGBA: 6408, UNSIGNED_BYTE: 5121, NEAREST: 9728,
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
    texParameteri: () => {},
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

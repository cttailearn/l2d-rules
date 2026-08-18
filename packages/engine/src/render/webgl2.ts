// WebGL2 渲染器 WebGL2Renderer —— 浏览器渲染后端（DEVELOPMENT-SPEC §5.7）
// 遵循 renderer/webgl.ts 约定：CPU 完成形变/构图，GPU 仅绘制；模块在 Node 无 GL 时不可用。
// 通过最小 `GL2` 接口实现，便于用命令记录 stub 做确定性测试；真实浏览器传入 WebGL2 上下文。
// 逐像素一致性：与 SoftwareRenderer 同输入同 shader 语义（NEAREST 采样 / 透明混合 / 同投影），
//   在具备 WebGL2 的环境（浏览器/headless-gl）中自动断言，Node 无上下文时跳过（同 Haru fixture 模式）。

import type { RenderMesh, RenderSink, Tex2D } from "./sink.ts";

/** WebGL2 最小表面（运行期由真实上下文提供；测试用命令记录 stub） */
export interface GL2 {
  // 能力与状态
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
  isContextLost(): boolean;
  getError(): number;
  // 常量（stub 提供真值即可，浏览器为 WebGL2 常量）
  readonly TRIANGLES: number;
  readonly ARRAY_BUFFER: number;
  readonly STATIC_DRAW: number;
  readonly COLOR_BUFFER_BIT: number;
  readonly TEXTURE_2D: number;
  readonly RGBA: number;
  readonly UNSIGNED_BYTE: number;
  readonly NEAREST: number;
  readonly TEXTURE_MIN_FILTER: number;
  readonly TEXTURE_MAG_FILTER: number;
  readonly TEXTURE_WRAP_S: number;
  readonly TEXTURE_WRAP_T: number;
  readonly CLAMP_TO_EDGE: number;
  readonly BLEND: number;
  readonly SRC_ALPHA: number;
  readonly ONE_MINUS_SRC_ALPHA: number;
  readonly COMPILE_STATUS: number;
  readonly LINK_STATUS: number;
  readonly FRAGMENT_SHADER: number;
  readonly VERTEX_SHADER: number;
  readonly FLOAT: number;
  readonly ELEMENT_ARRAY_BUFFER: number;
  readonly UNSIGNED_SHORT: number;
  // shader 程序
  createShader(type: number): WebGLShader | null;
  shaderSource(shader: WebGLShader, src: string): void;
  compileShader(shader: WebGLShader): void;
  getShaderParameter(shader: WebGLShader, p: number): unknown;
  deleteShader(shader: WebGLShader): void;
  createProgram(): WebGLProgram | null;
  attachShader(program: WebGLProgram, shader: WebGLShader): void;
  linkProgram(program: WebGLProgram): void;
  getProgramParameter(program: WebGLProgram, p: number): unknown;
  useProgram(program: WebGLProgram): void;
  deleteProgram(program: WebGLProgram): void;
  // 缓冲/纹理
  createBuffer(): WebGLBuffer | null;
  bindBuffer(target: number, buffer: WebGLBuffer | null): void;
  bufferData(target: number, data: BufferSource, usage: number): void;
  deleteBuffer(buffer: WebGLBuffer | null): void;
  createTexture(): WebGLTexture | null;
  bindTexture(target: number, tex: WebGLTexture | null): void;
  texImage2D(target: number, level: number, internal: number, width: number, height: number, border: number, format: number, type: number, pixels: ArrayBufferView | null): void;
  texParameteri(target: number, pname: number, value: number): void;
  deleteTexture(tex: WebGLTexture | null): void;
  // 顶点属性
  getAttribLocation(program: WebGLProgram, name: string): number;
  enableVertexAttribArray(index: number): void;
  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void;
  uniform1i(loc: WebGLUniformLocation | null, v: number): void;
  uniform4fv(loc: WebGLUniformLocation | null, v: Float32List): void;
  getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null;
  // 绘制
  viewport(x: number, y: number, w: number, h: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  clear(mask: number): void;
  drawElements(mode: number, count: number, type: number, offset: number): void;
  enable(cap: number): void;
  blendFunc(sfactor: number, dfactor: number): void;
  // 读回（测试面：像素一致性断言）
  readPixels(x: number, y: number, w: number, h: number, format: number, type: number, pixels: ArrayBufferView | null): void;
  activeTexture(unit: number): void;
  uniform2f(loc: WebGLUniformLocation | null, x: number, y: number): void;
  drawArrays?(mode: number, first: number, count: number): void;
}

/**
 * WebGL2 RenderSink 实现。
 * - 形变在 CPU（engine deform），此层仅做顶点缓冲 + 纹理 + drawElements。
 * - 每个 mesh 一帧一个 VBO/IBO；纹理按 id 缓存为上 GL 纹理句柄。
 * - 采样 NEAREST、透明混合 = 与 SoftwareRenderer 语义对齐（像素一致的前提）。
 * 使用：const sink = createWebGL2Renderer(gl)（无浏览器时返回 null）。
 */
export function createWebGL2Renderer(gl: GL2): WebGL2Renderer {
  return new WebGL2Renderer(gl);
}

export class WebGL2Renderer implements RenderSink {
  private readonly gl: GL2;
  private program: WebGLProgram | null = null;
  private readonly textures = new Map<string, WebGLTexture | null>();
  private width = 0;
  private height = 0 | 0;
  private inFrame = false;
  private readonly locs = {
    aPos: -1, aUv: -1,
    uTex: null as WebGLUniformLocation | null,
    uTint: null as WebGLUniformLocation | null,
    uSize: null as WebGLUniformLocation | null,
  };

  constructor(gl: GL2) {
    this.gl = gl;
    this.initProgram();
  }

  private initProgram(): void {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    if (vs) {
      gl.shaderSource(vs, VERTEX_SRC);
      gl.compileShader(vs);
      if (gl.getShaderParameter(vs, gl.COMPILE_STATUS) !== true) {
        gl.deleteShader(vs);
        throw new Error("顶点着色器编译失败");
      }
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (fs) {
      gl.shaderSource(fs, FRAGMENT_SRC);
      gl.compileShader(fs);
      if (gl.getShaderParameter(fs, gl.COMPILE_STATUS) !== true) {
        gl.deleteShader(fs);
        throw new Error("片元着色器编译失败");
      }
    }
    const prog = gl.createProgram();
    if (!prog) throw new Error("createProgram 失败");
    if (vs) gl.attachShader(prog, vs);
    if (fs) gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (gl.getProgramParameter(prog, gl.LINK_STATUS) !== true) {
      throw new Error("程序链接失败");
    }
    gl.useProgram(prog);
    this.program = prog;
    this.locs.aPos = gl.getAttribLocation(prog, "aPos");
    this.locs.aUv = gl.getAttribLocation(prog, "aUv");
    this.locs.uTex = gl.getUniformLocation(prog, "uTex");
    this.locs.uTint = gl.getUniformLocation(prog, "uTint");
    this.locs.uSize = gl.getUniformLocation(prog, "uSize");
  }

  uploadTexture(id: string, img: Tex2D): void {
    const gl = this.gl;
    const prev = this.textures.get(id);
    if (prev !== undefined) gl.deleteTexture(prev);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, img.width, img.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.textures.set(id, tex);
  }

  begin(width: number, height: number): void {
    this.width = Math.max(0, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.inFrame = true;
  }

  draw(mesh: RenderMesh): void {
    if (!this.inFrame) throw new Error("draw 必须在 begin 之后调用");
    if (mesh.indices.length % 3 !== 0 || mesh.indices.length === 0) return;
    const gl = this.gl;
    if (!this.program) throw new Error("程序未初始化");
    gl.useProgram(this.program);
    gl.uniform2f(this.locs.uSize, this.width, this.height);
    gl.uniform4fv(this.locs.uTint, mesh.color);
    // 纹理
    if (mesh.texId !== null) {
      gl.activeTexture(0x84c0); // TEXTURE0
      gl.bindTexture(gl.TEXTURE_2D, this.textures.get(mesh.texId) ?? null);
      gl.uniform1i(this.locs.uTex, 0);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.uniform1i(this.locs.uTex, 0);
    }
    // 顶点缓冲（xy + uv 交错：pos*2 + uv*2 = 4 floats/vertex）
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const interleaved = new Float32Array(mesh.verts.length + mesh.uvs.length);
    for (let i = 0; i < mesh.verts.length / 2; i++) {
      interleaved[i * 4] = mesh.verts[i * 2];
      interleaved[i * 4 + 1] = mesh.verts[i * 2 + 1];
      interleaved[i * 4 + 2] = mesh.uvs[i * 2];
      interleaved[i * 4 + 3] = mesh.uvs[i * 2 + 1];
    }
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
    if (this.locs.aPos >= 0) {
      gl.enableVertexAttribArray(this.locs.aPos);
      gl.vertexAttribPointer(this.locs.aPos, 2, gl.FLOAT, false, 16, 0);
    }
    if (this.locs.aUv >= 0) {
      gl.enableVertexAttribArray(this.locs.aUv);
      gl.vertexAttribPointer(this.locs.aUv, 2, gl.FLOAT, false, 16, 8);
    }
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    if (mesh.texId !== null) gl.bindTexture(gl.TEXTURE_2D, null);
  }

  end(): void {
    this.inFrame = false;
  }

  readPixels(): Uint8Array | null {
    const gl = this.gl;
    const { width: w, height: h } = this.size();
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}

const VERTEX_SRC = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUv;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  // CPU 顶点已是画布坐标（y 向下）；转 NDC：x∈[0,W]→[-1,1]，y 翻转后∈[0,H]→[-1,1]
  vec2 ndc = vec2(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  vUv = aUv;
}`;

const FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uTint;
out vec4 outColor;
void main() {
  vec4 tex = texture(uTex, vUv);
  outColor = vec4(tex.rgb * uTint.rgb, tex.a * uTint.a);
}`;

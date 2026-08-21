// RenderSink 接口 —— DEVELOPMENT-SPEC §5.7 / P2-2 定案（三阶段）
// 软件光栅（无头/CI）与 WebGL2（浏览器）两实现共用同一接口：
//   uploadTexture（幂等覆盖）→ begin → 逐 mesh draw（z-order）→ end → readPixels。
// 确定性：软件实现纯函数式光栅化；同输入同像素。

/** RGBA 纹理（8bit/通道，直通 alpha） */
export interface Tex2D {
  width: number;
  height: number;
  data: Uint8Array; // RGBA，行长 width*4
}

/** 纹理采样过滤：nearest（最近邻，确定性与 WebGL2/软件两后端逐位一致的基准）｜linear（双线性，浏览器展示「官方效果」用） */
export type TextureFilter = "nearest" | "linear";

/** 渲染器构造选项（软件/WebGL2 共用） */
export interface RendererOptions {
  /** 纹理过滤（缺省 nearest——parity e2e 的基准；linear 供浏览器平滑展示） */
  filter?: TextureFilter;
}

/** 一个绘制 mesh（顶点已变形为最终位置） */
export interface RenderMesh {
  /** 顶点 [x0,y0, x1,y1, ...]（画布坐标，y 向下） */
  verts: Float32Array;
  /** UV [u0,v0, ...] 0..1（左上原点，y 向下——与纹理行序一致） */
  uvs: Float32Array;
  /** 三角形索引（3 的倍数） */
  indices: number[];
  /** uploadTexture 注册的纹理 id；null = 纯色 */
  texId: string | null;
  /** RGBA 0..255（tint 或纯色） */
  color: [number, number, number, number];
}

export interface RenderSink {
  /** 阶段1：注册/上传纹理（幂等覆盖）。软件=存引用；WebGL2=创建纹理对象。 */
  uploadTexture(id: string, img: Tex2D): void;
  /** 阶段2：清屏 + 逐 mesh 绘制（按 z-order 调用）。宽高 = 画布。 */
  begin(width: number, height: number): void;
  draw(mesh: RenderMesh): void;
  /** 阶段3：结束帧（软件=缓冲就绪；WebGL2=flush）。 */
  end(): void;
  /** 测试面：读回当前帧像素 RGBA；不可用返回 null。 */
  readPixels(): Uint8Array | null;
  /** 画布尺寸（软件固定于 begin；WebGL2 取 drawingBuffer） */
  size(): { width: number; height: number };
}

# @l2dp/engine —— 自研 Live2D 类引擎（路线 C）

不依赖 Live2D Cubism Core 的**渲染/形变引擎**：`.l2dm` 开放格式（**语义参数名**、任意多部位、AI 可生成）、`ParameterStore` + Warp 网格形变（1D/2D）、deformer 层级变换链、摆锤物理、**双渲染后端**（软件光栅 CPU + WebGL2 浏览器）、`L2dmPlayer` 逐帧播放、motion3/exp3 → 引擎资产 compat。

- **确定性一等公民**：可注入 `SeededRandom`，同 (模型, 动作, dt 序列) 同输出，可无头 CI
- **.l2dm 内嵌资源（`atlas`）**：可选顶层 `atlas: { 文件名 → data URI/base64 }`，自包含模型产物；部件 `texture` 引用在此键或显式 `atlasFiles` 内即通过校验（值校验：data URI / base64）
- **与软件渲染逐像素一致**：WebGL2 与 SoftwareRenderer 同输入容差 ±1（`examples/demo-web` e2e 真实验证）

## 依赖与安装

- 依赖：`@l2dp/l2dp`（格式基元）；Node ≥ 23.6；纯 ESM

```bash
npm i @l2dp/engine
# 当前：npm i file:/path/to/repo/packages/engine
```

## 核心 API（包入口 `src/index.ts`）

| 模块 | 导出 |
|---|---|
| format | `L2dmModel` / `L2DM_FORMAT_VERSION`(1) / `L2DM_PARAM_GROUPS` / `validateL2dmModel` / `loadL2dm(text, atlas?)` / `parseL2dm` / `loadL2dmObject` |
| runtime | `ParameterStore`(set 钳制/get/normalized/reset)、`translate/scale/rotate/multiply/applyAffine/resolveDeformerMatrices`、`accumulateKeyforms/accumulateKeyforms2D/applyWarps/applyWarp2D`、`PendulumSim`、`mulberry32` |
| render | `RenderSink`(uploadTexture/begin/draw/end + readPixels)、`SoftwareRenderer`、`createWebGL2Renderer(gl)` |
| player | `L2dmPlayer`(params/tick/render/play)、`EngineMotion`、`parseSegments`/`sampleSegments`/`applyMotion` |
| compat | `importMotion3` / `importExpression3` / `applyExpression`（l2dp 标准资产 → 引擎；非语义官方 id 拒绝） |

## 用法

### 无头渲染一帧（软件光栅）

```ts
import { loadL2dm, L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";

const loaded = loadL2dm(modelJson);               // .l2dm 文本（语义格式，见 examples/demo-web/public/demo.l2dm）
if (!loaded.ok) throw new Error(loaded.error);
const model  = loaded.model;
const player = new L2dmPlayer(model, new Map());  // 第 2 参 = atlas: Map<string, Tex2D>

player.tick(16);           // 推进：动作采样 → 摆锤物理（形变在 render 计算）
player.render(sink);       // uploadTexture → begin → 逐 part 绘制 → end
const pixels = sink.readPixels();   // Uint8Array RGBA（画布尺寸像素）
```

### 浏览器 WebGL2（与软件一致）

```ts
const gl = canvas.getContext("webgl2", { samples: 0 });
const sink = createWebGL2Renderer(gl);
player.render(sink);
```

> `samples: 0` 关闭 MSAA——软件光栅是像素中心二元判据，MSAA 亚覆盖无法逐位一致（详见 `examples/demo-web/e2e/parity.ts`）。

### 外部写参数驱动形变

```ts
player.params.set("头转向", -20);   // 语义参数直写 → warp 网格形变
player.params.set("眨眼", 1);
player.tick(16);
player.render(sink);
```

### 导入标准运动/表情（compat）

```ts
import { importMotion3, importExpression3 } from "@l2dp/engine";
const m = importMotion3({ meta: { duration: 1, fps: 30, loop: true }, curves: [{ target: "Parameter", id: "微笑", segments: [0,0,0,1,1] }] });
if (m.ok) player.play(m.value);
```

## 边界（宿主职责）

- 引擎只产出**参数面 + 像素**；纹理的加载/上传管理、浏览器「相机」/画布合成由宿主负责
- `.l2dm` 是引擎原生格式（语义参数、开放 schema）；官方 model3/cdi 的完整导入为后续可选（cdi-import），当前提供 motion3/exp3 语义产物导入

## 测试

```bash
npm test        # 44 例：format 校验/loader、Warp 数值断言、层级连乘、物理收敛、player golden 像素、compat
cd examples/demo-web && npm run test:e2e   # 真实 Chromium WebGL2 ↔ 软件渲染逐像素一致
```

## 版本与纪律

`ENGINE_VERSION` = 0.1.0；`L2DM_FORMAT_VERSION` = 1。仅可擦除语法、零平台依赖（无 WebGL 运行时约束；浏览器路径仅在调用 `createWebGL2Renderer` 时要求真实 GL 上下文）。

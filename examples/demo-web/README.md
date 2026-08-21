# @l2dp/demo-web - 浏览器 demo（Vite）：测试·验证·演示四个包

M6/M7 端到端 demo：浏览器输入 JSONL → 自研引擎实时动作。零构建产物、直编 TS 源码。

## 1. 主 demo（index.html）

- 默认加载官方 Haru 真实模型（haru-full.l2dm，自包含：真实几何 + 内嵌 2 张真实纹理）
- 呈现与官方一致：透明背景（Live2D 官方观感）· 线性纹理过滤（平滑非像素化）· 按画布自适应缩放
- 双渲染后端：WebGL2（优先，GPU）与软件光栅（兜底/无头）；?renderer=software 强制软件
- 模型感知控制台（测试/验证/演示）：
  - ① 模型：haru-full（官方真实模型）/ demo（语义骨架 + warp 形变）
  - ② 实时渲染区（透明棋盘背景）
  - ③ 动作预置（官方模型 → set override；demo 模型 → play/face 语义动作）
  - ④ 在线 JSONL：逐行注入、坏行隔离显示 reason（验证校验规则）
  - ⑤ 参数滑杆（实时 set）+ 参数读数面板
- 徽标实时展示：参数/部件/纹理数、warp 数、渲染后端、过滤方式
- 直达参数：?model=haru-full.l2dm / ?renderer=software / ?model=demo.l2dm

## 2. 上传即时对比（compare.html）

上传一个 Live2D 模型目录（含 .model3.json），或拖入 .zip/文件夹，两侧用同一上传模型并排对比：

| 侧 | 渲染 | 数据来源 |
|---|---|---|
| 左侧·自研引擎 | @l2dp/convert（浏览器内实时转换）→ .l2dm → SoftwareRenderer（线性过滤） | 上传目录 |
| 右侧·官方 Cubism SDK | pixi-live2d-display + Cubism 4 core（CDN 运行时）→ 真实 .moc3 | 上传目录（blob URL 改写） |

同一官方 motion 曲线同步驱动两侧（左侧 sampleSegments 采样、右侧官方 motionManager）。
右侧需联网加载 CDN runtime；失败则右侧显示提示、左侧不受影响。全程浏览器内存零服务器。
主要源码：src/compare.ts、src/compare-left.ts、src/compare-right.ts、src/compare-upload.ts、compare.html。

## 3. 真实几何模型生成（npm run gen:haru）

scripts/gen-real.mjs 把官方 Haru 模型转换为 demo 的自包含 public/haru-full.l2dm：
- 几何来源 = 官方 CubismCore（examples/live2d/live2d_3/js，Node 内 vm 加载）的基准姿态提取：
  每个 ArtMesh 的默认姿态顶点/UV/三角形/绘制顺序/纹理索引直接取自官方运行时，保证与官方呈现一致；
  三角形归一为 CCW（软件光栅 edge 判据）、UV v 轴翻转、画布拟合 + 内嵌纹理 data URI → 自包含 .l2dm。
- 这是构建期脚本（demo 层），@l2dp/convert 本身保持零平台依赖；
  convert 的 .moc3 原生转换（moc3ToL2dm）的 keyform 形变管线（warp 动画）仍为下一里程碑，
  见 docs/MOC3-PHASE2-PLAN.md。

## 命令

npm install            # 安装（含 workspace 依赖）
npm run gen:haru       # 生成 public/haru-full.l2dm（官方基准姿态 + 双真实纹理）
npm run prepare:official #（可选）把 demo-real 官方 Haru sample 复制到 public/official-haru
npm run dev            # Vite dev server → /
npm run test:e2e       # Playwright 端到端（软件 vs WebGL2 逐像素一致 + 真实模型/透明断言）

## 依赖

- fflate：PNG 解码（atlas data URI → RGBA）与 .zip 解包
- @l2dp/*：engine（渲染/播放）、convert（官方模型→.l2dm）、driver（JSONL 驱动）——workspace 包
- 官方 Cubism runtime：live2d_3 本地样例运行时（Node 构建用）+ CDN 运行时（compare 右侧官方对照）

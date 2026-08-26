# l2d-rules · 通用 LLM 驱动 Live2D 规则 SDK

> 从 Live2D 创作平台（live2d-forge）抽取的**宿主无关规则核心**：给定（角色 manifest、规则/动作、时间）→ 算出每帧参数值。
> 渲染成像素、持久化、素材生成、内容策略都是**宿主**的事，不属于本仓库。

- **模型无关**：正文只说语义名（sem/layer/outfit/资产名），官方 `PARAM_*`/`PARTS_*` 只允许出现在 manifest 映射区（硬约束）
- **渲染器无关**：SDK 通过 `ParameterSink`（只写不回读）把每帧参数交给宿主——自研渲染器 / Cubism SDK / VTube / 无头录像器皆可
- **融合分工**：LLM 决策（选行为/表情）+ author 资产表达 + 程序化环境层（呼吸/眨眼/视线/重心 + 1/f 噪声）——角色“一直被驱动且一直活着”
- **JSONL 流式驱动**：交互侧逐行摄取即生效（行级原子、坏行隔离不阻塞），离线侧整批原子校验——同一规则库双模式
- **确定性**：时钟/随机种子可注入，同输入同输出，可无浏览器 CI 测试

> 唯一权威规范：[docs/SPEC-DSL-v1.0.md](docs/SPEC-DSL-v1.0.md)（确认版，取代 SPEC-DSL-v0.1 / DESIGN-v0.2 / DESIGN-v3.0）

## 目录结构

```
l2d-rules/
├─ packages/
│  ├─ l2dp/        官方 JSON 类型 + 标准参数白名单 + 命名规则 + .l2dp 校验/组装（含 fflate 打包）
│  ├─ engine/      自研 Live2D 类引擎（路线 C）：.l2dm 格式/形变/物理/双渲染（软件+WebGL2）★ M0 骨架
│  ├─ driver/      LLM 驱动核心：扁平 IR + JSONL 流式 + 分层求值 + 环境层 + 双模式校验 + Provider/两跳 ★ M0 骨架
│  ├─ convert/     ✦ 官方 Live2D 模型 → 自包含 .l2dm：model3/cdi3/physics3/pose3/userdata3/motion3/exp3 转换
│                    + 纹理内嵌(resources) + 从零构建/二次修改工具链（自研，绕开 Cubism Core）
│  ├─ rig/          P4a 半自动绑定：PartSpec(部件图+语义类) → 参数挂接 + warp 形变合成 + 自动绘制顺序/物理 → 合法 .l2dm + RigSpec 审计 + 质检报告 + 像素 golden
│  ├─ cutout/       P4b 半自动切图：PNG 编解码(fflate) + 平坦色候选选区 + 按 mask 拆部件 + 覆盖/重叠质检 + Segmenter/Labeler 注入钩子（零平台依赖，ML 由宿主注入）
│  ├─ create/       P4b 创作编排：创作 IR v1 + 同源 JSON Schema + 校验 + 执行(rig+动作生成) + 规则/多模态审核 + 自修复循环
│  └─ host/         P4c 宿主桥接骨架：HttpClient + ComfyUI REST 桥 + HTTP 分割服务 Segmenter + LLM Labeler/Reviewer（provider/服务可注入）
├─ examples/
│  ├─ demo-app/    ★ 小型使用应用 demo：Live2D 聊天助手——聊天输入 → 两跳决策 + 确定性应答 → JSONL 驱动说话/动作/换装/口型 + SceneStage 场景 + 语音（浏览器 Vite + 无头同核）
│  ├─ demo-web/    浏览器 demo（JSONL 流式 → 引擎实时动作；?model=haru-full.l2dm 真实纹理渲染；软件+WebGL2 逐像素一致 e2e）
│  ├─ demo-real/   ✦ 真实官方 Haru 模型端到端：转换 → 驱动 → 自包含 .l2dm 产物 + 二次修改/从零构建示例
│  └─ demo-p4b/    原图 → 拆解 → 绑定 → 驱动 全链路：内存立绘 → 半自动切图 → 自修复绑定 → 动作/JSONL 驱动 → 预览出图
├─ specs/          机器可读词表：standard-params.json（32 官方参数基线）、parts-naming.json（部件命名单一来源）
├─ docs/
│  ├─ SPEC-DSL-v1.0.md   唯一权威规范（确认版）：融合分工 + JSONL 流式驱动 + 扁平 IR + 环境层 + 决策记录 ★ 开发以此为准
│  ├─ DEVELOPMENT-SPEC.md 完整开发文档（智能体可执行）：自研引擎(.l2dm/变形/双渲染) + LLM 驱动核心 + M0-M7 里程碑 ★ 开发以此执行
│  ├─ SPEC-v2.0.md       平台主规格（参考：10.3 求值管线、6.2 字段规格）
│  ├─ MOC3-PHASE2-PLAN.md .moc3 二进制导入实施计划（GitHub 参考 + 里程碑 + DoD）
│  ├─ haru模型对照分析.md 编译对齐基准（官方 Haru 结构）
│  ├─ ARCHITECTURE.md    本 SDK 边界定义 + 宿主接口 + 迁移说明
│  └─ GUIDE-FROM-IMAGE-TO-LIVE2D.md  **开发者向导：一张原图 → 拆解 → 绑定 → 驱动**（含真实服务/LLM 接线，P4 全链速成）
└─ scripts/typecheck.mjs
```

> 每个包自带独立 README（定位 / 依赖 / 安装 / 核心 API / 用法示例 / 边界 / 测试），见 `packages/<pkg>/README.md`，消费前先读对应包文档。

## 从一张原图到能动的角色（P4 创作链，速成）

▶ 开发者向导：[docs/GUIDE-FROM-IMAGE-TO-LIVE2D.md](docs/GUIDE-FROM-IMAGE-TO-LIVE2D.md)（拆解 → 绑定 → 驱动，含真实服务/LLM 接线）。

```bash
cd examples/demo-p4b
export LLM_API_KEY=...   # 可选：真实 LLM 标注/审核；缺省走确定性 mock
node scripts/run.mjs        # 纯 SDK：原图→拆→绑→驱动 + 预览 PNG
node scripts/bridge.mjs     # 真实 HTTP 分割服务 + provider 注入
node scripts/bridge-llm.mjs # 真实/模拟 LLM 接线
npm run eval                # specs/evals/creation-cases.json（3/3）+ drive（6/6）
```

## 把既有 Live2D 模型用起来（`@l2dp/convert`）

官方 Live2D 模型（Cubism Editor 产物）**整体转换为自包含 `.l2dm`**，可二次修改、也可从零搭建——全程不用官方 Cubism Core（自研，见 [docs/MOC3-PHASE2-PLAN.md](docs/MOC3-PHASE2-PLAN.md)）。

```bash
cd examples/demo-real
npm run start   # 转换 Haru → JSONL 驱动 → out/: haru-full.l2dm(自包含,内嵌纹理) / haru-edited / my-mascot(从零) / report.txt
```

- `.l2dm` **内嵌模型资源**（`atlas` data URI）——一个文件即完整模型（几何 + 参数面 + 纹理）
- 官方 motion3/exp3 的 `ParamX` camelCase id 天然是语义名 → driver 直接可驱动（play/face/blink…）
- `createL2dm` 从零构建 + 编辑 API（`addPart/addWarp/embedTexture/attachTexture/setParamRange/…`）支持二次修改
- Phase 1 = JSON 全链路（model3/cdi3/physics3/pose3/userdata3/motion3/exp3 已打通）；`.moc3` 二进制的真实几何/参数范围为 Phase 2 里程碑

## 快速开始

要求：Node ≥ 23.6（原生运行 `.ts`，零构建）。

~~~bash
npm install
npm run typecheck   # 8 包 + demo-web 类型检查
npm test            # 8 包 + demo 全量 274 例全绿（含 moc3 语料解析/真实几何回归/demo-app 同核）
npm run eval        # 评估集门禁：specs/evals/drive-cases.json → 报告（任一 case 失败退出码 1；6/6）
~~~

## 浏览器 demo（M6 端到端 + 真实纹理）

~~~bash
cd examples/demo-web
npm run gen:haru    # 生成 public/haru-full.l2dm：官方 Haru → 官方 CubismCore 基准姿态几何 + 内嵌双纹理（~3.7MB，呈现与官方一致）
npm run dev         # 打开 http://localhost:5173
~~~

- 缺省 `demo.l2dm`（纯色骨架）；**真实纹理渲染**：`?model=haru-full.l2dm` 直达，或点 [haru-full.l2dm] 按钮——浏览器端把内嵌 atlas（data URI）PNG 解码成 `Tex2D` 交给引擎（`src/texture.ts`，fflate；Engine 只管采样，解码归宿主）
- 无 GPU 依赖：软件光栅 → 2D canvas（`SoftwareRenderer.readPixels → putImageData`）
- 无头验证（CI）：`examples/demo-web/test/demo.test.ts` 同一条链（JSONL → driver → engine → 像素），含 haru 内嵌纹理解码 + **像素级采样断言**（软件光栅逐位一致）
- M3 DoD——真实浏览器 WebGL2 逐像素一致性 + 真实纹理浏览器渲染：`npm run test:e2e`（Playwright + Chromium；parity 软件 vs WebGL2 容差 ±1，real-texture 加载 `?model=haru-full.l2dm` 断言语义 2 张纹理解码 + 画布 80×64 + 真实纹素）

**上传即时对比页（`/compare.html`）**：上传一个 Live2D 模型目录（或拖 .zip/文件夹）→ **左侧**自研引擎把该模型实时转为 `.l2dm` 并软件光栅渲染，**右侧**官方 Cubism SDK（CDN runtime）渲染真实 `.moc3`——同一官方 motion 同步驱动两侧并排对比。全程浏览器内存（blob URL + 内存 FileLoader），零服务器；右侧需联网加载 CDN runtime。见 [examples/demo-web/README.md](examples/demo-web/README.md)。

## 小型使用应用 demo（demo-app）

**打开就能用**的应用级演示：聊天框打字 → 角色说话（台词 + 语音）、做动作、张嘴对口型、换装——实时渲染（[examples/demo-app/README.md](examples/demo-app/README.md)）。与 demo-web（验证控制台）互补，展示「用这套 SDK 能搭出一个什么样的应用」：

```bash
cd examples/demo-app
npm run dev          # 浏览器应用 → http://localhost:5173
npm start            # 无头 CLI：脚本化聊天 + 上传构建示例 → 出帧 out/*.png + report.txt（确定性）
CHAR=all npm start   # 三角色全跑（haru 官方 / 小骨架语义 / 衣装酱换装）
npm test             # 同核 7 例：两跳决策/说话口型/换装/确定性/多角色场景/上传构建全链
```

- 一条消息链路：`两跳决策（DriverEngine 第一跳本地规则 → 第二跳 Provider）→ 确定性台词 → estimateSpeechTimeline+blendVisemes 口型 → StreamIngestor 逐行 JSONL（坏行隔离）→ LayerStack+EnvironmentLayer+Evaluator → L2dmPlayer → SceneStage（背景/相机/多角色）→ WebGL2/软光栅`
- 三形态角色同一个 AppCore：**官方 Haru**（真实纹理 + 语音 + 环境层映射）、**小骨架**（play/face warp 形变）、**衣装酱**（rig 换装 outfit）。
  注意：Haru 当前 `.l2dm` 为官方基准姿态烘焙（warp 形变是 convert 下一里程碑）——参数驱动/台词/语音正常，几何形变请切小骨架/衣装酱体验。
- **上传图像 → 构建 Live2D**：左侧面板选择/拖入 PNG（或内置示例）→ 浏览器内 `cutout → create(自修复) → rig + 动作生成 → 内嵌纹理 .l2dm` → 注册为第 4 个角色「我的创作」直接聊天。
  内置确定性链面向平坦色画风；复杂图可注入真实 Segmenter/Labeler（`@l2dp/host`：HttpSegmenter/视觉 LLM），核心零改动。
- 真实 LLM：`LLM_API_KEY=… npm start`（第二跳走 OpenAI 兼容端点；缺省确定性 mock，离线/CI 可跑）。
- 浏览器与无头/测试共用 `src/core.ts` + `src/creator.ts`（无 DOM 核心），同一条链三处验证。

## 现状（对齐 SPEC-DSL-v1.0 第 13 章路线图）

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| M0 | 自研引擎 + LLM 驱动包骨架（engine/driver）+ typecheck 3 包 + 冒烟测试 | ✅ `packages/engine` + `packages/driver` |
| M1 | .l2dm 格式 schema + validator + loader | ✅ `packages/engine/src/format`（14 用例） |
| M2 | 形变核心：ParameterStore + Hierarchy + Warp 网格形变 | ✅ `packages/engine/src/runtime`（10 用例） |
| M3 | 渲染双后端：软件光栅 + WebGL2（RenderSink 三阶段） | ✅ `packages/engine/src/render`（7 用例）+ 真实浏览器 e2e（`examples/demo-web` `npm run test:e2e`，软件 vs WebGL2 逐像素一致） |
| M4 | Player + compat：加载→逐帧；l2dp/motion3/exp3 → 引擎资产 | ✅ `packages/engine/player` + `compat`（含 golden 参考） |
| M5 | **LLM 驱动核心**：扁平 IR + StreamIngestor + LayerStack + EnvironmentLayer + Evaluator | ✅ `packages/driver`（14 用例） |
| M6 | **验证与整合**：双模式校验规则库 + renderer 退役 + demo-web 端到端 | ✅ `packages/driver/validate`（12 用例）+ `examples/demo-web`（5 用例） |
| M7 | **LLM 通道**：Provider(native/text/mock) + 两跳(<50ms) + 语音接口 + 评估集 | ✅ `packages/driver/provider`+`twohop`+`tts`（10 用例）+ `scripts/eval-drive`（6/6） |
| P5 | LLM 驱动通道：两跳 + Provider 分级（native/grammar/text）+ 评估集 | ✅ `packages/driver`（M7 落地；grammar 档 M7+ 可选） |
| P2 | 校验器全套（7 类 + IR/流专属）+ 干跑求值 | ✅ `packages/driver/validate`（M6 落地，双模式共享规则库） |
| P3 | 扁平 IR（v2）+ 环境层控制器 + 分层求值/优先级 | ✅ `packages/driver`（M5 落地） |
| P3b | **JSONL 流式驱动**（StreamIngestor）+ 双模式校验 | ✅ `packages/driver`（M5 StreamIngestor + M6 双模式规则库） |
| C1 | **既有官方模型转换**：model3/cdi3/physics3/pose3/userdata3/motion3/exp3 → 自包含 .l2dm（内嵌纹理）+ 从零构建/二次修改工具链 | ✅ `packages/convert` + `examples/demo-real`（26 用例，真实 Haru） |
| C2 | **.moc3 二进制导入 + keyform 形变**：真实几何/索引缓冲/绘制顺序/精确参数范围 + warp 动画（keyform 绑定 + deformer compose → .l2dm.mesh.warps） | ✅ readMoc3/moc3ToL2dm（41 模型语料回归；顶点口径官方 Core 实证闭合）；✅ C2 keyform 形变管线（convert/moc3/deform.ts，自研零依赖）；✅ 官方动画级烘焙（examples/demo-real `npm run gen:deform`）＋ M5 像素 golden（`npm run golden`，0.001%–0.145% 像素差）；rotation deformer 实验性开关 |
| P4a | **LLM 创作前半——半自动绑定**：PartSpec → 参数挂接 + warp 形变合成 + 自动顺序/物理 → .l2dm + RigSpec + 质检报告 + 像素 golden | ✅ `packages/rig`（11 用例；157 全绿） |
| P4b | **LLM 创作后半——拆解 + 创作编排**：@l2dp/cutout + @l2dp/create + 全链 demo-p4b + 创作评估集 | ✅ `packages/cutout`(7) + `packages/create`(7) + `examples/demo-p4b` + `creation-cases`(3/3) |
| P4c | **宿主桥接骨架**：@l2dp/host（HttpClient / ComfyUI REST 桥 / HTTP 分割服务 Segmenter / LLM Labeler+Reviewer / P4c 装配）+ demo-p4b bridge.mjs（真实 HTTP 服务 + provider 注入跑通全链） | ✅ `packages/host`（7 用例）+ `examples/demo-p4b/scripts/bridge.mjs` |
| P4 | **LLM 创作通道**（few-shot + 自修复 + 干跑）：`@l2dp/host` `LlmDesigner`（切图 → few-shot 结构化生成整条 `CreationDirective`）+ `LlmRepairer`（问题回注 → LLM 修正）+ `@l2dp/create` `Designer` 注入点 | ✅（创作评估集 3/3；真实 LLM 由 `LLM_API_KEY` 注入） |
| P6 | 词表 manifest 生成器 + library 索引 + scene 舞台 + TTS 升级 + MCP 表层 | ✅ `generateManifest`/`generateLibraryIndex` + `BehaviorIndex` 加权随机/`buildBehaviorIndex` + `SceneStage`（多角色/相机/背景）+ `phonemes`/`viseme`（音素→口型+韵律）+ `driverToolCatalog`（E6）；`examples/demo-capabilities` 可运行演示；parts-naming 扩展与场景 UI 属宿主 |

## 模型驱动 live2d 技能（随包交付）

skills/live2d-drive.md 是给模型/LLM 的用法卡：转换官方模型 → 加载渲染 → JSONL 语义驱动（play/face/blink/环境层）→ 官方动画级一致（golden）。跟随本仓库一起给到消费方，模型拿到包即拿到“让角色动起来”的方法。

## 与 live2d-forge 的关系

- live2d-forge 是本 SDK 的**第一个宿主**：实现 `ParameterSink`（WebGL/软渲染）、资产存储（SQLite/file map）、LLM provider 注入、内容策略、Fastify 端点
- 本仓库当前是**副本过渡态**：代码从平台复制而来，平台尚未改为消费本 SDK。平台接线后（包名 `@l2dp/*` 保持不变，只需换依赖来源），平台内的同名单包副本即删除，消除双份源码
- 包名沿用 `@l2dp/*` 以最小化宿主迁移成本；若将来独立开源，可统一改 scope

## 开发纪律

- TypeScript strict + 仅可擦除语法（无 enum/namespace）
- 零平台依赖：核心不引 fastify/react/sqlite/onnxruntime；推理与 TTS 由宿主注入
- 版本三件套写进每个产物：引擎 model `formatVersion` + 语义资产 `syntaxVersion`（semver）+ IR 版本
- 每个阶段 DoD：typecheck 全绿 + 包测试全绿 + 确定性回归（种子化时钟/随机）

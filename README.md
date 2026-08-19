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
│  └─ renderer/    （已退役：M6 删除，算法迁入 engine——曲线采样→player/motion、形变→runtime、软光栅→render/software）
├─ specs/          机器可读词表：standard-params.json（32 官方参数基线）、parts-naming.json（部件命名单一来源）
├─ docs/
│  ├─ SPEC-DSL-v1.0.md   唯一权威规范（确认版）：融合分工 + JSONL 流式驱动 + 扁平 IR + 环境层 + 决策记录 ★ 开发以此为准
│  ├─ DEVELOPMENT-SPEC.md 完整开发文档（智能体可执行）：自研引擎(.l2dm/变形/双渲染) + LLM 驱动核心 + M0-M7 里程碑 ★ 开发以此执行
│  ├─ SPEC-v2.0.md       平台主规格（参考：10.3 求值管线、6.2 字段规格）
│  ├─ haru模型对照分析.md 编译对齐基准（官方 Haru 结构）
│  └─ ARCHITECTURE.md    本 SDK 边界定义 + 宿主接口 + 迁移说明
└─ scripts/typecheck.mjs
```

## 快速开始

要求：Node ≥ 23.6（原生运行 `.ts`，零构建）。

~~~bash
npm install
npm run typecheck   # 4 包类型检查
npm test            # 3 包全量：l2dp 4 + engine 44 + driver 43 + demo 5，96 例全绿
npm run eval        # 评估集门禁：specs/evals/drive-cases.json → 报告（任一 case 失败退出码 1）
~~~

## 浏览器 demo（M6 端到端）

~~~bash
cd examples/demo-web
npm run dev        # 浏览器打开 http://localhost:5173：粘贴 JSONL（Enter 逐行生效）→ 引擎实时动作
~~~

- 无 GPU 依赖：软件光栅 → 2D canvas（`SoftwareRenderer.readPixels → putImageData`）
- 无头验证（CI）：`examples/demo-web/test/demo.test.ts` 走同一条链（JSONL → driver → engine → 像素）
- M3 DoD——真实浏览器 WebGL2 逐像素一致性：`npm run test:e2e`（Playwright + Chromium，软件 vs WebGL2 `readPixels` 容差 ±1；vite dev 自动起于 :5199）

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
| P4 | LLM 创作通道（few-shot + 自修复 + 干跑），**后置为高级可选** | ⬜ |
| P6 | 核心词表 manifest 生成器 + library 索引 + scene 舞台 + TTS 可选 | ⬜ |

## 与 live2d-forge 的关系

- live2d-forge 是本 SDK 的**第一个宿主**：实现 `ParameterSink`（WebGL/软渲染）、资产存储（SQLite/file map）、LLM provider 注入、内容策略、Fastify 端点
- 本仓库当前是**副本过渡态**：代码从平台复制而来，平台尚未改为消费本 SDK。平台接线后（包名 `@l2dp/*` 保持不变，只需换依赖来源），平台内的同名单包副本即删除，消除双份源码
- 包名沿用 `@l2dp/*` 以最小化宿主迁移成本；若将来独立开源，可统一改 scope

## 开发纪律

- TypeScript strict + 仅可擦除语法（无 enum/namespace）
- 零平台依赖：核心不引 fastify/react/sqlite/onnxruntime；推理与 TTS 由宿主注入
- 版本三件套写进每个产物：引擎 model `formatVersion` + 语义资产 `syntaxVersion`（semver）+ IR 版本
- 每个阶段 DoD：typecheck 全绿 + 包测试全绿 + 确定性回归（种子化时钟/随机）

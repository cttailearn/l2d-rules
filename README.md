# l2d-rules · 通用 LLM 驱动 Live2D 规则 SDK

> 从 Live2D 创作平台（live2d-forge）抽取的**宿主无关规则核心**：给定（角色 manifest、规则/动作、时间）→ 算出每帧参数值。
> 渲染成像素、持久化、素材生成、内容策略都是**宿主**的事，不属于本仓库。

- **模型无关**：正文只说语义名（sem/layer/outfit/资产名），官方 `PARAM_*`/`PARTS_*` 只允许出现在 manifest 映射区（硬约束）
- **渲染器无关**：SDK 通过 `ParameterSink`（只写不回读）把每帧参数交给宿主——自研渲染器 / Cubism SDK / VTube / 无头录像器皆可
- **LLM 双通道**：创作模式（few-shot 生成语言 A + 校验回传自修复）+ 驱动模式（function calling 输出 Directive IR）
- **确定性**：时钟/随机种子可注入，同输入同输出，可无浏览器 CI 测试

## 目录结构

```
l2d-rules/
├─ packages/
│  ├─ l2dp/        官方 JSON 类型 + 标准参数白名单 + 命名规则 + .l2dp 校验/组装（含 fflate 打包）
│  ├─ dsl/         语言 A 解析器 + 编译器（.ldsl → motion3/exp3/manifest 缓存）★ P0/P1 已完成
│  └─ renderer/    求值管线（动作→表情→物理→override）+ 曲线采样 + 形变 + 软件光栅化（干跑/无头 sink）
├─ specs/          机器可读词表：standard-params.json（32 官方参数基线）、parts-naming.json（部件命名单一来源）
├─ docs/
│  ├─ SPEC-DSL-v0.1.md   主规格（两层语言/语义层/IR/运行时/LLM 通道/校验器/路线图）★ 开发以此为准
│  ├─ SPEC-v2.0.md       平台主规格（参考：10.3 求值管线、6.2 字段规格）
│  ├─ haru模型对照分析.md 编译对齐基准（官方 Haru 结构）
│  └─ ARCHITECTURE.md    本 SDK 边界定义 + 宿主接口 + 迁移说明
└─ scripts/typecheck.mjs
```

## 快速开始

要求：Node ≥ 23.6（原生运行 `.ts`，零构建）。

~~~bash
npm install
npm run typecheck   # 3 包类型检查
npm test            # l2dp 4 + dsl 43 + renderer 7（Haru 对照 2 例需自备 fixture，缺失自动跳过）
~~~

> Haru 对照测试需要官方示例 `haru_ja/runtime/motion/haru_idle_01.motion3.json`（gitignore，仅限非公开测试用途），缺失时自动 skip 不阻塞。

## 现状（对齐 SPEC-DSL-v0.1 第 13 章路线图）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 解析器 + AST + 语法校验（character/motion/expression/scene） | ✅ `packages/dsl` |
| P1 | 编译器：motion→motion3、expression→exp3、character→manifest 缓存 | ✅ `packages/dsl` |
| P2 | 校验器全套（10 章 7 类规则）+ 干跑求值 | ⬜ 下一站（含 LLM 批量错误收集模式） |
| P3 | 语言 B：behavior 解析 → Directive IR + 时间轴调度器（覆盖最小集） | ⬜ |
| P4 | LLM 创作通道：few-shot 模板 + 自修复循环 | ⬜ |
| P5 | LLM 驱动通道：function schema + provider 抽象（云/Ollama）+ 两跳 | ⬜ |
| P6 | 核心词表 manifest 生成器 + library 索引 + scene 舞台 + TTS 可选 | ⬜ |

## 与 live2d-forge 的关系

- live2d-forge 是本 SDK 的**第一个宿主**：实现 `ParameterSink`（WebGL/软渲染）、资产存储（SQLite/file map）、LLM provider 注入、内容策略、Fastify 端点
- 本仓库当前是**副本过渡态**：代码从平台复制而来，平台尚未改为消费本 SDK。平台接线后（包名 `@l2dp/*` 保持不变，只需换依赖来源），平台内 `packages/dsl`、`packages/l2dp`、`packages/renderer` 即删除，消除双份源码
- 包名沿用 `@l2dp/*` 以最小化宿主迁移成本；若将来独立开源，可统一改 scope

## 开发纪律

- TypeScript strict + 仅可擦除语法（无 enum/namespace）
- 零平台依赖：核心不引 fastify/react/sqlite/onnxruntime；推理与 TTS 由宿主注入
- 版本三件套写进每个产物：manifest `formatVersion` + DSL `syntaxVersion`（semver）+ IR 版本
- 每个阶段 DoD：typecheck 全绿 + 包测试全绿 + 确定性回归（种子化时钟/随机）

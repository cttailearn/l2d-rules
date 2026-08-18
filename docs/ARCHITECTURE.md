# l2d-rules 架构与边界

> 本文定义 SDK 与宿主的分界、宿主接口与迁移说明。开发时以 `SPEC-DSL-v0.1.md` 为功能规格、本文为边界规格，冲突时以硬约束（0 章）为准。

## 1. 边界原则

**SDK 只装"大脑"**：manifest + DSL + 校验 + IR + 调度 + 求值 + LLM 通道。
一切碰渲染/存储/生成/内容策略/网络的代码都不进核心——通过注入接口交给宿主。

| 进 SDK | 留在宿主（如 live2d-forge） |
|---|---|
| 核心词表（specs/*.json）+ manifest schema | .l2dp 的 zip 打包语义与上传/导出接口 |
| 语言 A/B 解析 + 编译 | 素材生成链（云 API / ComfyUI / 网关 / 桥） |
| 校验器 + 干跑（P2） | UI（工厂/装配台/模型库/动作编辑器） |
| Directive IR + 调度器 + 混合公式（P3） | SQLite 持久化、audit 落库、账号/免登录 |
| 求值管线（动作→表情→物理→override） | TTS 具体实现（LocalSAPI/Edge 等） |
| LLM 创作/驱动通道 + provider 抽象（P4/P5） | 内容分级/成人判定（平台底线策略） |
| model3/cdi3 → manifest 自动生成器（P6） | WebGL 渲染细节 |

## 2. 宿主接口（SDK 对外只依赖这些）

```ts
/** 每帧参数写入：只写不回读。宿主实现可以是自研渲染器 / Cubism SDK / VTube / 无头录像器 */
interface ParameterSink {
  apply(character: string, params: Record<string, number>, tMs: number): void;
}

/** 资产来源：按名取 motion/exp/behavior 资产（file map 或任意存储后端） */
interface AssetSource {
  getMotion(name: string): Promise<Motion3 | null>;
  getExpression(name: string): Promise<Expression3 | null>;
  getBehavior(name: string): Promise<IrNode | null>;
}

/** 角色 manifest 来源（可用 SDK 的 model3→manifest 生成器） */
interface ManifestSource {
  get(role: string): Promise<CharacterManifest>;
}

/** LLM provider：SDK 不碰网络，宿主注入（OpenAI 兼容端点 / Ollama / Mock） */
interface RuntimeProvider {
  createCompletion(req: ChatRequest, opts: { tools?: FunctionSchema[] }): Promise<ChatResult>;
}

/** 可选注入：缺失时走 SDK 内置降级（speak 无 TTS → 口型简谐+估时） */
interface TtsProvider { synthesize(text: string, opts?: unknown): Promise<{ audio?: Uint8Array; durationMs: number; lang?: string }> }
interface Clock { now(): number; }              // 不注入 = 宿主帧时钟（onFrame 驱动）
interface SeededRandom { next(): number; }       // 不注入 = 内部可复现种子
interface AuditSink { write(entry: { kind: string; detail: unknown; ts: number }): void }
interface ContentPolicy { classify(text: string): { allowed: boolean; route?: "local" } }  // SDK 内容中立，策略由宿主实现
```

两个消费入口（都薄，底层同一调度器）：

```ts
engine.dispatch(event: DriverEvent);   // 事件驱动：9.4 两跳的落点（第一跳本地规则 <50ms，第二跳 LLM 异步）
engine.onFrame(dtMs: number);          // 帧驱动：宿主 rAF / 定时器调用，产出参数 → sink.apply
```

## 3. 设计红线

1. **Sink 只写不回读**——SDK 永不向渲染器要几何/像素信息。
2. **manifest 是唯一契约**——"语言是词典，模型是词表"：任何 Live2D 模型经 model3→manifest 生成器（缺参 sem 自动隐藏，D1）即接入。
3. **确定性是一等公民**——时钟+种子注入；同 (manifest, IR/DSL, 时钟序列) 的参数轨迹逐帧一致（CI 黄金测试）。
4. **LLM 边界 = 目录进、IR 出**——资产目录从 manifest 缓存渲染进提示词；function schema 与执行期校验同源生成；SDK 自身不发起网络请求。
5. **内容中立**——SDK 不做分级判断，只留 ContentPolicy 钩子（平台底线由宿主实现并注入）。
6. **求值管线唯一实现**——调度器每帧算出动作层混合值后写入管线（对应硬约束 #5），表情/物理/override 层由管线按 SPEC-v2.0 10.3 顺序汇总。

## 4. 版本策略

- manifest：formatVersion（整数，破坏性 +1）+ syntaxVersion（DSL 语法 semver，packages/dsl/src/version.ts）
- Directive IR：节点带 schema 版本，校验器做前向兼容检查（P3 定义）
- 包发布：semver；0.x 阶段允许破坏性，但 manifest/IR 字段变更必须写进本文件变更记录

## 5. 迁移说明（与 live2d-forge 的衔接）

1. **当前 = 副本过渡态**：packages/{l2dp,dsl,renderer} 自平台整体复制，平台仍是独立一份。双份源码只存在到平台接线完成为止。
2. **平台接线步骤**（在 live2d-forge 侧执行）：
   - 平台 packages/dsl、packages/l2dp、packages/renderer 的 package.json 依赖指向本 SDK（开发期 file: 链接或 yalc，稳定后 npm 发布）
   - 平台 apps/web、services/api 的 @l2dp/* import 无需改名（scope 不变）
   - 删除平台内的这三个包目录，并从 scripts/typecheck.mjs 的 12 包清单中移除
   - 平台 renderer 中若新增仅浏览器用的模块（如 WebGL 上下文管理），不回移本仓库
3. **本仓库不做的事**：不改 .l2dp 打包格式（平台资产格式）、不接 ComfyUI/网关、不实现 TTS 具体引擎、不做内容分级。

## 6. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-18 | 自 live2d-forge 抽取建立仓库：l2dp/dsl/renderer 三包 + specs 词表 + SPEC-DSL-v0.1 主规格；dsl 的 Haru 对照测试改为 fixture 缺失自动跳过 |

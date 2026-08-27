# @l2dp/driver —— LLM 驱动核心

「模型驱动」的**大脑**：把 LLM 决策 / JSONL 指令变成每帧参数。本包实现 SPEC 的 LLM 驱动全链路：

- **扁平指令 IR v2**（12 op）+ **JSONL 流式驱动**（在线逐行 `<1ms` 快校验、坏行隔离不阻塞；离线整批原子）
- **分层求值**（override 最高）+ **环境层**（呼吸/眨眼/视线/重心 1/f 噪声恒动）
- **双模式共享校验规则库**（7 类 + IR/流专属），错误结构直接回传 LLM 自修复
- **两跳**：第一跳本地规则 `<50ms`、第二跳 LLM 异步决策；`Provider` 三档（native/text/mock，确定性可测）
- **语音口型估算**（TTS 降级）+ **TTS 升级**（音素→viseme 映射 + 60–80ms 混合 + 语调韵律包络）+ **IR JSON Schema 同源生成**（OpenAI `response_format` 结构化输出）

## 依赖与安装

- 依赖：`@l2dp/l2dp`、`@l2dp/engine`（结构型）；Node ≥ 23.6；纯 ESM

```bash
npm i @l2dp/driver
# 当前：npm i file:/path/to/repo/packages/driver
```

## 核心 API（包入口 `src/index.ts`）

| 模块 | 导出 |
|---|---|
| ir | `Op`、`Directive`、`DirectiveStream`、`IR_VERSION`(2)、`perOpSchema/directiveSchema/directiveStreamSchema`（JSON Schema） |
| layers | `LayerStack(defs)`、`EnvironmentLayer(defs,{seed})`、`routeDirective` |
| validate | `inlineValidate`（逐行）、`batchValidate`（整批原子 + 干跑）、`OP_RULES`、`opShapeIssues/semanticIssues/refIssues/...` |
| stream | `StreamIngestor({manifest,library,assets,stack,env,seed}).feedLine(line,tMs)` |
| eval | `Evaluator(stack,env,defs,{apply}).onFrame(dtMs)` |
| provider | `RuntimeProvider`、`MockProvider`（确定性）、`OpenAIProvider`、`extractJsonLines`（fallback 剥围栏/修尾逗号） |
| twohop | `BehaviorIndex`（register/pick，同优先级按 `weight` 种子加权随机）、`pickWeighted`、`DriverEngine`（dispatch/onFrame） |
| catalog | `buildBehaviorIndex({behaviors,seed})` —— 行为目录（含权重）一次性装配第一跳索引（P6 library 索引） |
| manifest | `generateManifest(params)` / `vocabularyOf` / `generateLibraryIndex(motions,expressions)` —— 词表 manifest 生成器（P6） |
| mcp | `driverToolCatalog()` —— IR schema 同源生成 MCP 工具清单（emit_directives + play_motion/… + get_state，E6） |
| tts | `estimateSpeechTimeline(text)`、`estimateProsody`、`phonemeToViseme`/`phonemeSegmentsToVisemes`、`blendVisemes`/`visemeTimeline`、`SpeechTimeline` |

## 用法

### 最小闭环：JSONL → 每帧参数（照 `examples/demo-app/src/core.ts` 或 `scripts/drive-scene.ts`）

```ts
import { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator,
         type EnvParamDef, type ManifestLike, type AssetIndex, type AssetStore } from "@l2dp/driver";

// 语义参数面 / 资产（名称即语义名）
const defs: EnvParamDef[] = model.parameters.map(p => ({ id: p.id, min: p.min, max: p.max, group: p.group, def: p.def }));
const manifest: ManifestLike = { sems: defs.map(d => ({ name: d.id, min: d.min, max: d.max, group: d.group, def: d.def })) };
const library: AssetIndex   = { motions: [{ name: "微笑点头" }], expressions: [{ name: "开心" }], behaviors: [] };
const assets: AssetStore     = {
  motions: new Map([["微笑点头", { durationMs: 1000, loop: true, curves: [{ id: "微笑", segments: [0,0,0,1,1] }] }]]),
  expressions: new Map([["开心", { parameters: [{ id: "微笑", value: .3, blend: "Add" }] }]]),
};

const stack = new LayerStack(defs);
const env   = new EnvironmentLayer(defs, { seed: 42 });   // 呼吸/眨眼/视线/重心恒动
const ing   = new StreamIngestor({ manifest, library, assets, stack, env, seed: 42 });
const ev    = new Evaluator(stack, env, defs, {
  apply(_character, params) {
    for (const [k, v] of Object.entries(params)) player.params.set(k, v);   // 引擎参数面
  },
});

// 在线流式：逐行快校验，坏行隔离不阻塞（skipped[].reason）
ing.feedLine('{"op":"play","asset":"微笑点头"}', 0);
ing.feedLine('{"op":"set","sem":"微笑","value":0.6}', 16);

// 帧驱动
ev.onFrame(16);   // 动作+表情+override+环境层合成 → apply
```

### 两跳事件驱动（LLM 决策）

```ts
import { BehaviorIndex, DriverEngine, MockProvider } from "@l2dp/driver";

const index = new BehaviorIndex();
index.register({
  id: "greeting", events: ["user_text"], kinds: ["greeting"], priority: 10,
  lines: ['{"op":"play","asset":"微笑点头"}'],
  match: (e) => e.type === "user_text" && /你好|hello/i.test(e.text),
});
const engine = new DriverEngine({ index, provider: new MockProvider(), ing });  // 生产换 OpenAIProvider
const r = await engine.dispatch({ type: "user_text", text: "你好呀！" }, {});
// r.hop === 1 → 本地规则命中（<50ms，不调 LLM）；r.hop === 2 → LLM 决策 → extractJsonLines → feedLine
```

生产 LLM：`new OpenAIProvider({ model, apiKey, fetchImpl? })`，原生结构化输出自动带 IR 同源 schema（`directiveStreamSchema`）。

### 离线整批校验（原子 + 干跑）

```ts
import { batchValidate, type BatchValidateCtx } from "@l2dp/driver";
const ctxB: BatchValidateCtx = { manifest, library, assets, params: defs, seed: 42 };
const r = batchValidate(stream, ctxB);   // 整批原子拒绝 + 干跑拦截 NaN/越界
```

## 指令词汇（op → required）

| op | required | 载荷 |
|---|---|---|
| play | asset | speed/strength/mix/cover/loop/interrupt |
| face | expression | weight/blend |
| set | sem, value | — |
| outfit | outfit | — |
| speak | text | voice |
| blink | — | interval |
| drift | sem, amplitude, period | — |
| look | gaze | — |
| camera | — | — |
| action | asset | interrupt |
| emote | emote | — |
| wait | ms | — |

## 边界（宿主职责）

- SDK **不发起网络请求**（真实 LLM key/端点由宿主注入 `RuntimeProvider`）
- SDK **不渲染**——每帧参数经 `apply`（即宿主实现的 `ParameterSink`）交给引擎/渲染器
- 真实 TTS 引擎由宿主注入；缺失时 `estimateSpeechTimeline` 提供简谐口型 + 估时降级

## 测试

```bash
npm test    # 71 例：ingestor/layers/environment/evaluator/validate/IR schema/两跳/tts/catalog/manifest/mcp
npm run eval   # 根目录评估集 scripts/eval-drive.mjs → 6/6（改提示词/schema 必过）
```

## 版本与纪律

`DRIVER_VERSION` = 0.1.0；`IR_VERSION` = 2。仅可擦除语法、零平台依赖；确定性（时钟/种子可注入）为一等公民。

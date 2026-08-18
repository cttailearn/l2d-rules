# l2d-rules 设计增强提案 v0.2（LLM 驱动层）

> 状态：**设计提案（未定案）** — 供评审。定案后并入 `SPEC-DSL-v0.1.md` 相应章节并记入 14 章决策表。
> 目标：在**不推翻 v0.1 核心设计**（语义层 / IR 即 function schema / 两跳 / 校验优先）的前提下，针对
> 「LLM 驱动 Live2D」的真实生产需求做 8 项设计增强。每个方案给出**接口/结构/规则**级定义，可直接进入实现。
>
> 依据：行业调研（2025–2026）+ 结构化输出可靠性实测数据 + 现有 v0.1 决策（F1–F8 / D1–D6）。
> 与 v0.1 的关系：提案是对 v0.1 的**增量修订**，非重写；冲突处提案优先，评审后回填主规格。

---

## 0. 摘要：8 项设计增强与理据

| # | 增强 | 解决 v0.1 的什么问题 | 行业/数据依据 |
|---|---|---|---|
| E1 | **情绪状态机（Affective State Core）** | 无状态逐条指令 → 对话连贯性差、机械感 | CTEM / Ghost Vessel / AICO：短期情绪 + 长期心情双轴 |
| E2 | **IR v0.2 扁平化（Flat Directive Stream）** | 嵌套 series/parallel/wait 深度不可控 → LLM 失败率高 | 实测：3 层嵌套错误率 15–25%，扁平化 <5% |
| E3 | **调度器 v0.2（统一时钟 + 分层栈）** | 单动作播放器，无层栈/优先级/打断/音频时钟 | Cubism SDK 多层播放 + 音频 playhead 对齐 |
| E4 | **Viseme 流接口（SpeechTimeline）** | 深度口型被整体推迟 → 升级无接口 | TTS viseme 事件 + AudioContext 调度 + 60–80ms 混合 |
| E5 | **LLM 通道分级（Tiered Structured Output）** | 本地/云输出可靠性差异未建模 | XGrammar 受约束解码压到 <0.1% 语法失败；schema≠语义 |
| E6 | **MCP 表层（MCP Bridge）** | 私有 provider 抽象 → 生态封闭 | live2d-mcp / VTube Studio MCP 已成事实标准 |
| E7 | **LLM 评估集 + 语义抽查** | LLM→IR 层无度量；schema 合法 ≠ 语义正确 | 结构化输出基准：100% 校验率≠语义正确 |
| E8 | **Roadmap 重排：P5 先于 P4** | 创作模式（LLM 写曲线）质量不可控、过约束退化 | 行业证据：LLM 擅长选资产+覆盖，不擅长从零写动画 |

> **一句话**：v0.1 的骨架是对的；v0.2 把它从「工具链」改造成「可被 LLM 稳定驱动的运行时」——关键动作是
> **把 LLM 面对的表面积压平（E2）+ 给运行时注入记忆/情绪（E1）+ 让输出随 provider 分级加固（E5）+ 开放生态（E6）**。

---

## E1. 情绪状态机（Affective State Core）★ 最高优先

### 问题
v0.1 的 IR 每次调用是**无状态**的：LLM 每轮从零决定表情/动作。结果：
- 上轮刚被夸，这轮还是同一套待机 → 割裂感
- 没有"此刻角色处于什么情绪基线"的上下文 → LLM 只能猜
- 无法支撑跨轮连贯的主动行为（无聊了主动搭话）

### 设计

**角色运行时新增状态（不落 IR，engine 内部持有 + 序列化进 LLM 上下文）：**

```ts
interface AffectiveState {
  /** 短期情绪（事件驱动，指数衰减回 0）：key = sem 语义名（复用核心词表，无新命名空间） */
  emotion: Map<string, number>;          // 例：{ "开心": 0.7, "害羞": 0.3 }
  /** 长期心情（慢松弛回基线）——二维 PAD 简化（效价/唤醒） */
  mood: { valence: number; arousal: number };
  /** 关系亲和度（跨会话持久化，慢变） */
  affinity: number;                      // -1..1
  /** 内在驱动（无聊感）：随时间累积，触发主动行为 */
  boredom: number;                       // 0..1
}
```

**动力学规则（engine 负责，LLM 不参与数字积分——沿"LLM 出意图、引擎做被信任的数学"原则）：**

```
每次 LLM 决策后，若输出 emotion_intent（见下），engine 执行：
  emotion[e]  = clamp(emotion[e] + Δ_intent, 0, 1)      // 事件冲击
每帧（dt）：
  emotion[e] *= exp(-dt / τ_emotion)                     // τ ≈ 5–20s，回 0
  mood       += (baseline - mood) * (1 - exp(-dt / τ_mood))  // τ ≈ 分钟级
  boredom    += dt * boredomRate                          // 无互动时上升
  boredom    *= exp(-dt / τ_boredomResp)                  // 有互动后回落
```

**LLM 输出形状（新增一次 tool call 的返回字段，非强制）：**

```json
{ "op": "affect", "emotion_intent": { "开心": 0.7, "害羞": 0.2 } }
```
- `affect` 只声明**意图强度**，engine 负责平滑/衰减/仲裁（D2 公式族复用 clamp）。
- 缺省 = 情绪按动力学自然演化，不强制每轮输出。

**插入求值管线的位置（对齐 v0.1 硬约束 #5，只加一层）：**

```
动作曲线 → 表情(Add/Multiply/Overwrite) → 【情绪层(Add，权重 α_affect)】→ 物理输出 → override(最高)
```
- 情绪层对 `emotion` 命中的 sem 做 **Add 注入**，权重 `α_affect` 可配（默认 0.3，防止压过显式动作）。
- `mood`/`affinity` 不直接写参数，只作为**行为选择/资产检索的条件**（见下）。

**消费情绪的三个入口：**
1. **行为选择**：`score = w1·kinds匹配 + w2·情绪相关度(emotion↔kinds) + w3·mood契合 + w4·weight随机`
2. **参数注入**：`emotion[e]` → 情绪层 Add 注入到 sem e
3. **LLM 上下文**：每轮把 AffectiveState + 最近 N 条交互摘要序列化为 system context（让 LLM 知道"现在的角色是谁、心情如何"）

### 验收
- 序列化 AffectiveState 进 system prompt，LLM 冻结时也能靠动力学保持自然
- 情绪层注入不破坏 D2 混合公式的确定性（注入函数确定性、可干跑）
- 亲和度/心情可持久化（宿主注入 Store，SDK 只定义接口）

---

## E2. IR v0.2 扁平化（Flat Directive Stream）★ 最高优先

### 问题
v0.1 7.8 的 IR 用 `series/parallel/wait/loop` 嵌套树。结构化输出实测数据显示：
- **3 层嵌套 → LLM 输出错误率 15–25%**（LLM 自回归生成时"数不清括号/上下文丢失"）
- OpenAI strict 模式硬限制 5 层 / 100 属性；Anthropic 深嵌套静默失败
- 嵌套越深，**语义错误**（合法但值错位）越多

### 设计：把嵌套树改造成**扁平指令流 + 显式时间**

```json
{
  "v": 2,
  "target": "小夏",
  "directives": [
    { "id": "d1", "op": "play",   "asset": "挥手",     "at": 0,               "cover": { "speed": 1.2, "strength": 0.8 } },
    { "id": "d2", "op": "face",   "expression": "开心", "at": 0 },
    { "id": "d3", "op": "outfit", "outfit": "连衣裙组",  "at": 0 },
    { "id": "d4", "op": "speak",  "text": "你好呀，欢迎回来！", "at": 0, "voice": "edge" },
    { "id": "d5", "op": "play",   "asset": "点头",     "at": "+d4",            "dur": 800 },
    { "id": "d6", "op": "set",    "sem": "害羞",       "value": 0.5,          "at": "+d5" },
    { "id": "d7", "op": "drift",  "sem": "头转向",     "at": 0, "amp": 3, "period": 8000, "loop": true }
  ]
}
```

**与 v0.1 的对应（语义不丢失）：**
| v0.1 结构 | v0.2 扁平等价 |
|---|---|
| `parallel { ... }` | 多条 `at` 相同（默认并行，零成本） |
| `series { a; b }` | `b.at = "+a"`（显式依赖） |
| `wait 400ms` | 独立 `{ "op": "wait", "ms": 400 }` 或 `at` 相对值 |
| `loop` | 每条指令独立 `loop: true`（常驻原语，如呼吸/眨眼） |
| `after 400ms { ... }` | `at: "+400"`（相对前一条）或 `at: 400`（绝对） |

**顺序语义（v0.2 定案）：**
- `at` 取值：`数字 ms`（绝对）| `"+N"`（相对上一条）| `"+<id>"`（依赖指定指令的开始）
- `dur` 可选：覆盖资产固有时长
- 依赖解析：`"+d4"` = 该指令在自己的 `at` 基准上等待 `d4` 的**结束**（`d4.at + d4.dur/资产时长`）；不指定 = 相对**开始**
- 无依赖冲突环（校验器检测；有环 = 拒绝）
- **LLM 视角：只是一张扁平表，每条一行、字段 ≤6 个、无嵌套** → 落在 <5% 错误率的稳定区

**为什么是"流"而非树**：
- 语言 B 的 `behavior.ldsl` 编译为同一扁平 IR（编译器负责把 `after`/`parallel` 语义展开成 `at`）
- 语言 B 源语法**保持不变**（人类可读，7.3 的"块内并行 + after 串行"心智模型仍在）
- 只有 **LLM 面对的执行形态**变成扁平流 → 两面用户（机器/人类）的最优解各取所需

**两个必须处理的退化模式（实测教训）：**
1. **截断 → 半截列表**：`loop`/递归类指令有 max_tokens 截断风险（`finish_reason: "length"`）。扁平流的优雅之处："截断的列表只是一个更短的列表，而不是一棵破掉的树"——但仍须对 `finish_reason` 做前置检查：`length` 时**拒绝整批**（回退常驻行为），而非执行残缺批次。
2. **跨字段一致性**：扁平化后模型必须自行创造/追踪 `id`（依赖引用用）。校验器必须做跨字段断言：`id` 唯一、`+<id>` 引用存在、无依赖环——这三条各 10 行内可实现，是扁平滑的核心护栏。

### 验收
- IR schema 最大深度 ≤2（顶层对象 + 一层 directives 数组）
- 校验器：依赖环检测 + at/dur 时序健全性 + 未知 op/资产拒绝 + **finish_reason 前置检查**
- 相对时间在编译期解析为绝对时间后才进调度器（调度器只吃绝对时间，保持确定性）

---

## E3. 调度器 v0.2（统一时钟 + 分层栈）★ 高优先

### 问题
- 现有 renderer 是 `MotionPlayer`（单动作 + 单表情），无 overlay 栈、无优先级、无打断——撑不起 P3/P5
- 语音与动画时间轴无统一时钟：口型、说话期间的动作、抢话打断都会错位
- v0.1 8.4 已定"规模/频率/回退"安全层，但缺"层模型"这一机械基础

### 设计

**双时钟（audioClock + wallClock）：**
```
audioClock: 当前 TTS 音频播放进度（playhead，可暂停/seek/打断）；无语音时 = wallClock
wallClock:  rAF/定时器推进
规则：某指令参与语音对齐（speak/lipsync 派生动作）→ 用 audioClock；
      其余一律 wallClock；一条时间轴内***不得混用***两种时钟。
确定性：干跑/离线模式用固定采样替代 audioClock（= 无音频的 wallClock 语义）。
```

**分层栈（对齐 v0.1 7.5 + 10.3 管线）：**
```
L0 常驻层   idle/呼吸/眨眼/blink   （永不互相打断，可被高层盖时间片）
L1 行为层   按 priority 排序，同层 Add 叠加；interrupt: target|supersede|queue
L2 情绪层   E1 的 emotion 注入（Add，权重 α_affect）
L3 override  set 恒定目标（最高优先，v0.1 语义不变）
```

**打断模型（v0.2 精化 v0.1 7.5）：**
- 每条指令可选 `interrupt: { on: "user_speak"|"event"|"higher", mode: "target"|"supersede"|"queue" }`
- **barge-in**（用户说话抢断 TTS/动作）成为一等事件：`user_voice` 触发 → 当前 speak 立即衰减、L1 该层挂起（可恢复）
- 恢复：`supersede` 被更高优先级打断后可 `resume`（保留层现场）；`target` 打断直接消灭

**确定性保持**：调度器每帧只做「层聚合 → 一条参数写入管线」，与 v0.1 硬约束 #5 一致；注入 `SeededRandom` 后同输入同输出可干跑。

### 验收
- 单事件多指令（如"说话+挥手+表情"）在双时钟下口型/动作不脱节
- barge-in 在 <1 帧内停掉 TTS 与口型，动作层 150ms 衰减（对齐 D2 的 attack/release）
- 常驻层永不中断；高层盖低层、低层自动恢复

---

## E4. Viseme 流接口（SpeechTimeline）

### 问题
v0.1 8.3 把口型定为"简谐信号 + 音量包络"，且深度口型同步是非目标——**但接口没留升级位**。
行业（Azure/Inworld/Supertone + Kugutu + Cubism Editor Motion-sync）已是 **viseme 事件流** 标准。

### 设计：TTS 接口升级为带可选 viseme 的时间线

```ts
interface SpeechTimeline {
  text: string;
  lang: string;
  audio?: Uint8Array;                          // 可选
  durationMs: number;
  /** 可选：TTS 提供逐音素时间戳时填充；否则 fallback 到 RMS/简谐 */
  visemes?: { tMs: number; viseme: VisemeId; weight?: number }[];
}
type VisemeId = "silence" | "A" | "I" | "U" | "E" | "O";   // 可扩展为 IPA 精化
interface TextToSpeechProvider {
  synthesize(text: string, opts?: { voice?: string }): Promise<SpeechTimeline>;
  /** 能力协商：是否产出 visemes（低成本，用于调度器选路径） */
  capabilities(): { visemes: boolean };
}
```

**调度路径三级（自动降级，不阻塞行为）：**
```
T1 visemes    TTS 逐音素时间戳 → 精确口型（60–80ms 入出混合，防"嘴型跳变"）
T2 RMS        音频音量包络（AnalyserNode / audio buffer 离线曲线）→ 口型开合
T3 简谐       无音频（v0.1 现状）→ 预设时长
```

**附加事件：**
- `lipsync:start` / `lipsync:end`：口型开始/结束标记，结束时角色回待机口型
- 说话期间可用 `at` 对齐的动作（E2）与嘴型互不冲突（嘴型走 lip 专用 sem 通道）

### 验收
- 有 visemes 时口型精确；无时平滑降级 T2/T3，行为不阻塞
- 干跑：无音频时用固定采样覆盖 audioClock，保确定性
- speech 结束后角色回待机口型（不僵在张嘴）

---

## E5. LLM 通道分级（Tiered Structured Output）

### 问题
v0.1 9.2 的 `RuntimeProvider` 抽象是"一个接口"，但**云与本地模型的输出可靠性差一个数量级**：
- 纯 prompt JSON：5–15% 语法失败
- 本地模型（Llama/Qwen）裸 JSON 更不稳，且无 function calling 时更差
- 而 `schema 合法 ≠ 语义正确`——结构化输出只是"形对"，值却可能错位

### 设计：能力协商 + 三级输出路径 + 统一校验闸

```ts
interface RuntimeProvider {
  /** 能力协商（替代 URL 写死）：返回结构化输出能力等级 */
  capabilities(): {
    structured: "native"      // 云：function calling / Structured Outputs
               | "grammar"    // 本地：XGrammar / Outlines / GBNF 受约束解码
               | "text";      // 降级：仅文本，靠健壮 JSON 提取
    grammarHint?: "xgrammar" | "outlines" | "gbnf";   // grammar 模式下的后端
  };
  createCompletion(req: ChatRequest, opts: { schema?: FunctionSchema; grammar?: string }): Promise<ChatResult>;
}
```

**三级路径：**
```
T1 native   OpenAI/Anthropic：strict:true / Structured Outputs，直接 schema 约束
T2 grammar  本地：LLM IR schema 编译为 grammar
            - vLLM/SGLang/TensorRT-LLM：XGrammar（PDA 编译，已内建，缓存复用）
            - llama.cpp/Ollama：GBNF / Outlines
            效果：语法失败率 5–15% → <0.1%
T3 text     万能降级：健壮 JSON 提取
            （围栏 → 花括号深度配对 → 尾逗号修复 → 重试 ≤3 → 最简 prompt 兜底）
```
> T3 的提取器是**跨 provider 共享**的（不在 provider 内实现），与 P2 校验器同层。

**统一校验闸（不管哪级，输出必过）：**
1. 语法/schema 校验（P2）——形对
2. **语义抽查**（见 E7）——值对
3. 干跑求值——运行对
- 研究结论提醒：**不要过度约束**（模型会输出"安全但无意义"的值）；schema 只锁结构，语义靠抽查。
- 双重警告（受约束解码并不消除错误）：约束只把"括号错位"变成"值放错对象"——**100% 校验通过率不能说明语义正确**。这正是语义抽查（E7）不可省略的原因：结构性护栏挡住语法错误，语义护栏挡住"合法但错位"的值。

### 验收
- 同一 IR schema 可跑云（native）与本地（grammar + 提取降级）两端
- 能力协商在启动时完成一次，不逐请求协商
- 本地模型语法失败率 ≤1%（grammar 或提取器兜底）

---

## E6. MCP 表层（MCP Bridge）

### 问题
v0.1 的 provider 抽象是**私有协议**：只有本 SDK 自己的宿主能用。2025–2026 事实标准是 MCP——
`live2d-mcp`（set_expression/play_motion/look_at/speak/lip_sync/reset）、VTube Studio MCP 都已存在。
你的 IR 本身就是工具 schema——**不加任何新设计，只需一个薄桥**。

### 设计

**一份 schema、两个传输**：内部两跳引擎 + 外部 MCP 工具，都过同一校验器/调度器。

| MCP 工具 | 映射 | 说明 |
|---|---|---|
| `emit_directives` | 完整扁平 IR（E2） | 批量，一次调用驱动整段行为（主工具） |
| `play_motion` | 单条 play | 细粒度/外部 agent 微调用 |
| `set_expression` | 单条 face | 同 live2d-mcp 表面，生态兼容 |
| `set_parameter` | 单条 set (sem) | 语义名而非裸 PARAM |
| `look_at` | 单条 look | 视线跟随 |
| `speak` | 单条 speak | 带回 SpeechTimeline 调度 |
| `get_state` | AffectiveState + 当前活跃资产 | **让外部 agent 具备上下文**（新工具） |

**桥的实现边界（对齐 ARCHITECTURE.md 红线）：**
- bridge 是薄适配：MCP 请求 → IR → 校验 → 调度（scheduler 内部不变）
- SDK 不实现 MCP server 本体（宿主注入），只提供 `IR→tools 清单` 的映射元数据（mcp-tools.json 生成器）
- `get_state` 让外部 agent 能看到 AffectiveState（E1）——否则外部驱动的角色同样是"无记忆的"

### 验收
- 同一 bat 行为在内部 two-hop 与外部 MCP 调用下逐帧参数一致（确定性断言）
- 工具清单由 IR schema 自动生成，与 function calling schema 同源（不手写两套）
- 认证/授权属宿主（MCP 传输层），SDK 只定义最小权限注解

---

## E7. LLM 评估集 + 语义抽查

### 问题
- v0.1 的确定性（种子化时钟）只保证 **IR → 渲染** 可回归；**LLM → IR** 这一层**没有任何度量**。
- 结构化输出基准明确警告：**100% schema 校验通过 ≠ 语义正确**（错误会"搬家"到别处的合法值上）。

### 设计 A：黄金评估集（LLM→IR 的可回归度量）

```
specs/evals/drive-cases.json      # 驱动模式：{scenario 上下文, 期望的语义效果}（不是逐字节 IR）
specs/evals/create-cases.json     # 创作模式：{任务描述, 期望的资产约束}
scripts/eval-drive.mjs            # 批量跑：LLM → IR → 确定性求值 → 断言语义效果
```

- 断言的是**语义效果**而非字节 IR（IR 的合理答案多样，语义效果唯一）：例如
  `case: "用户说你好" → 期望: 5s 内出现 greet 类 play + 至少一个 face`
- 度量：通过率 + 失败模式分布（语法失败/语义失败/拒绝/超时）——按 provider 分别记录
- 每次改提示词/IR schema，先跑评估集再合入（回归门禁）

### 设计 B：语义抽查（运行时，高风险才触发）

```
规则引擎预筛：命中高风险特征（自定义覆盖/新资产/非常规 override/未知减速）→
  触发二次校验：LLM 复核 或 确定性规则复核（白名单/范围/冲突）
低风险（普通 play/face/set）：只过 P2 结构校验 + 干跑，不加延迟
```
- 与两跳架构协同：高风险路径已有"等 LLM 结果"的槽位（v0.1 9.4），语义抽查挂在这条慢路径上，不增加首跳延迟。

### 验收
- 变更提示词/schema 必须过评估集（CI 门禁）
- 运行时抽查只影响高风险输出，普通路径延迟零增加

---

## E8. Roadmap 重排：P5 先于 P4

### 问题
v0.1 13 章把 P4（LLM 创作：写 motion 曲线）排在 P5（LLM 驱动）之前。行业证据反指：
- LLM **擅长**：从图书馆选资产 + 参数覆盖 + 分层叠加（可靠、可校验、质量稳）
- LLM **不擅长**：从零写关键帧曲线（few-shot 不足、质量不可控、过约束即退化）
- "驱动"是产品主价值（实时对话），"创作"是高级能力（离线装配）

### 设计：重排后的建议顺序（P2 → P3 → P5 → 收尾 P4）

| 序 | 阶段 | 内容 | 增益 |
|---|---|---|---|
| 1 | **P2** | 校验器全套（v0.1 10 章 7 类 + E2 时序检查） | 一切的前提 |
| 2 | **P3** | 扁平 IR（E2）+ 调度器 v0.2（E3）+ Viseme 接口（E4） | 驱动机械基础 |
| 3 | **P5** | 驱动通道：情绪状态机（E1）+ provider 分级（E5）+ 两跳 | 主价值落地 |
| 4 | — | VTS ParameterSink 后端 + MCP 桥（E6） | 生态接入 |
| 5 | **P4** | 创作通道（few-shot + 自修复 + 干跑），作为**高级可选** | 进阶能力 |
| 6 | P6 | 词表生成器 / scene / TTS 升级 | 收尾 |

> P4 地位下调为"高级功能"，但**不删除**——创作模式对"自定义新动作"场景仍有价值，
> 只是不能作为 LLM 驱动的主路径依赖。

### 验收
- P5 落地时即已能"LLM 实时驱动模型做反应"（非 P4 先行）
- P4 上线即天然挂上 P2/P5 的校验与评估基础设施

---

## 附：与 v0.1 的关系对照

| v0.1 章节 | 增强影响 | 处理 |
|---|---|---|
| 7.3 时序结构（块内并行 + after） | Language B 源语法不变 | 编译器负责展开为扁平 IR（E2） |
| 7.4 覆盖混合公式 D2 | 不变，新增情绪层权重 | 管线只加 L2 情绪层（E1/E3） |
| 7.8 Directive IR | **改为扁平流 v2** | 替换（E2），schema 深度 ≤2 |
| 8.3 语音与口型 | 接口升级为 SpeechTimeline | 替换 TTS 接口，三级降级保留（E4） |
| 8.4 失败与回退 | 不变 | 保留规模/频率/回退安全层 |
| 9.2 Provider 抽象 | 增加 capabilities() 协商 | 替换（E5） |
| 9.4 两跳架构 | 不变 | 语义抽查挂慢路径（E7） |
| 12.1 manifest 缓存 | 不变 | 评估集/工具清单从缓存生成（E6/E7） |
| 14 决策表 | 新增 E1–E8 决策 | 评审后回填 |

---

*本文档为提案：E1/E2 建议优先定案（决定后续 IR 与运行时的形状）；E3–E7 与 E1/E2 无硬依赖可并行评审；E8 为执行顺序调整。*

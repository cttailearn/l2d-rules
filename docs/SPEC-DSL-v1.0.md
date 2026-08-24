# Live2D 规则引擎 DSL 与驱动规范 v1.0（确认版）

> **状态：确认版（最终可实行）**。本文件是唯一权威规范——取代并整合 `SPEC-DSL-v0.1`、`DESIGN-v0.2-提案`、`DESIGN-v3.0-发散蓝图`（已删除）。
> 配套文档：`ARCHITECTURE.md`（SDK/宿主边界）、`SPEC-v2.0.md`（平台参考：求值管线 10.3、字段规格 6.2）、`haru模型对照分析.md`（编译对齐基准）。
>
> **关键上下文（本次定论的背景）**：宿主将**自研 Live2D 模型引擎**（支持比官方更多模块/部件），所以本规范的表达空间按"更丰富 rig"设计；同时交互侧采用 **JSONL 流式逐行驱动**。两份先前的发散提案经甄别后：**环境层（程序化 ambient）被保留为底层贡献，但 LLM 决策核心、author 资产、整批校验被收回为主干**——最终方案是"融合分工"，而非激进替换。

---

## 0. 定论摘要（一段话读懂本规范）

> **正确范式 = 融合分工**：**LLM 当决策者**（在图书馆里选行为/表情——它擅长的枚举决策），**author 资产负责表达**（签名动作/情绪面部/精确时机——AAA 实践：表达用作者化/mocap），**程序化环境层负责"活着"**（呼吸/眨眼/视线/重心 + 1/f 噪声——底座常驻），**情绪不靠 LLM 主观猜**（来自可观测信号 + 确定性动力学）。
> **交互驱动 = JSONL 流**（每行一条指令、行级原子、逐行快校验即生效、坏行隔离不阻塞）、**离线入口 = 整批原子校验**（固化入库时）。两条路径共享同一校验规则库，只是执行策略不同。语义层/确定性/宿主无关三项资产原样保留。

---

## 1. 硬性约束（保留原 v0.1，不可更改）

1. 语言面向两面用户：**机器（LLM）可生成** + **人类可读改**。二者缺一不可。
2. **模型无关**：语言 A/B 正文只允许引用语义层名字（sem/layer/outfit/资产名），**禁止裸写官方 PARAM_* / PARTS_***；官方 ID 只允许出现在 manifest 映射区（`sem <名> [范围] -> { PARAM_* }` 右侧），其余上下文出现即编译错误。
3. 标准参数语义与白名单以 `specs/standard-params.json` 为规范源、`packages/l2dp/src/params.ts` 的 `isStandardParam()` 为运行时校验集；部件命名以 `specs/parts-naming.json` 为单一来源。
4. 编译产物必须可被现有链路（.l2dp / motion3 / exp3）消费，禁止引入"平行资产格式"。
5. 驱动运行时必须汇入「求值管线：动作曲线 → 表情 → 物理 → override（最高）」，不得另起一套求值逻辑。
6. LLM 通道与素材生成链路（云 API/ComfyUI）**正交**；内容底线对驱动实时决策内容同源生效。
7. 一切 DSL/IR 输入在编译/执行前必须过校验器（语法→语义→范围→曲线→干跑）；LLM 生成物与人工编写物**同一门槛**。
8. **确定性是等级公民**：时钟/随机种子可注入，同 (manifest, IR/流, 时钟序列, 种子) → 逐帧一致（CI 黄金测试）。

---

## 2. 融合架构总览

```
┌──────────────────────────── 决策层（LLM，回合边界，慢）────────────────────────┐
│  user 输入 → LLM → 文本(→TTS) + @选择行为/表情  + 场景上下文                     │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ JSONL 流（在线）/ 整批 IR（离线，固化时）
                                ▼
┌──────────────────────────── 表达层（离线预编译资产，确定性）────────────────────┐
│  library 检索(kinds) → play 固定动作 / face 表情 → 覆盖(speed/strength/mix)      │
│  —— author 资产：签名动作/情绪面部/精确时机（AAA：表达必须 author/mocap）          │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                ▼
┌──────────────────────────── 环境层（程序化，60fps 常驻，确定性）────────────────┐
│  呼吸 / 眨眼 / 视线微动 / 重心微移 / 无意识小动作 + 1/f 噪声（种子化）             │
│  被 `emote` 行持续调制（能量/效价→呼吸节奏、体态、手势幅度）                      │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                ▼
┌──────────────────────────── 求值管线（对齐平台 10.3）──────────────────────────┐
│  动作曲线 → 表情(Add/Mult/Overwrite) → 环境层(Add, 权重 α) → 物理 → override    │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                ▼
                    ParameterSink（宿主渲染，只写不回读）
```

**分层职责（这是"不干扰"的结构保证）：**
| 层 | 数据来源 | 求值阶段 | 冲突规则 |
|---|---|---|---|
| 动作层 | `play`（固定 action） | 动作曲线 | 同 sem 冲突 → priority/interrupt |
| 表达层 | `face`（表情） | Add/Mult/Overwrite | 可叠加（weight） |
| 环境层 | 程序化控制器 + `emote` 调制 | 环境 Add（α_ambient） | 单一"当前环境状态"，新 emote 覆盖旧 |
| override 层 | `set`（恒定目标） | 最高优先 | 同 sem 后者胜 |

---

## 3. 语言 A（创作层 DSL，`.ldsl`）

> 语法与编译目标沿用原 v0.1 5 章（character/motion/expression/scene），此处只列要点与定案。完整 BNF 见原文档（git 历史）/ 本文 §3.4 摘要。

### 3.1 文件布局
```
characters/<role>/character.ldsl       装配（source/layers/bones/outfits/sems）
characters/<role>/motions/**/*.ldsl     动作曲线（motion 块）
characters/<role>/expressions/*.ldsl    表情（expression 块）
scenes/<name>.ldsl                      舞台编排（scene 块）
behaviors/*.ldsl                        驱动行为（behavior，语言 B 源）
library.ldsl                            动作库索引（kinds/可参数化覆盖面）
```

### 3.2 动作库索引 library.ldsl（**决策核心，LLM 目录进**）
```
library {
  挥手:   { kinds: [greeting 挥手 打招呼]; type: motion; params: [speed strength mix] }
  呼吸循环: { kinds: [idle 呼吸];         type: motion; loop: true; params: [speed] }
  点头:   { kinds: [confirm 同意 点头];  type: motion; params: [speed] }
  welcome: { kinds: [enter 迎客 欢迎];   type: behavior; on: user_enter; params: [语气] }
}
```
- `kinds` 是**意图检索用语义标签**：LLM 按"意图→kinds"查库选资产，**杜绝凭空造资产名**。
- 任何 `play/face/action` 引用的名字必须在库中登记；缺失 = 编译期校验错误。
- 库同时登记固定资产的**可参数化覆盖面**（speed/strength/mix/局部 gate），供校验器与 LLM 提示模板读取。

### 3.3 定案要点（沿用 v0.1）
- `sem <名> [范围] -> { PARAM_* }`：语义映射区（唯一允许官方 ID 处）；`layer/bone/outfit` 沿用。
- `motion`：`track <semIdent> { 关键帧; easing }` 或 `curve: breath/blink/wave`；编译 → motion3（Segments 布局对齐 Haru）。
- `expression`：`set <sem> = 值` + `blend`；编译 → exp3。
- **D1 语义粒度**：共享核心词表 + 模型扩展；缺底层参数的 sem **自动隐藏**，引用它们的动画**跳过而非报错**（可警告）。
- 编译期产出**不可变 manifest JSON 缓存**（`<role>.manifest.json`）：sem/layer/outfit/资产索引，运行时与 LLM 目录一律消费缓存，不反复解析。

### 3.4 编译目标映射（v0.1 6 章延续）
| 语言 A | 目标 | 落点 |
|---|---|---|
| character | .l2dp parts 分组 / deformers / params / groups | packages/l2dp 补丁 |
| motion | motions/<Group>/<name>.motion3.json | .l2dp motions |
| expression | expressions/<name>.exp3.json | .l2dp expressions |
| scene | 渲染布局（多角色/相机/背景） | 宿主前端 |

编译以**补丁**形式作用（不重写未涉及字段），保证导入模型无损。

---

## 4. 语言 B 与扁平指令 IR（Directive Stream v2）★ 定案

### 4.1 理念
- **语言 B 源语法（behavior.ldsl）保留**人类可读心智模型（块内并行 + `after` 串行）。
- **LLM 面对的执行形态 = 扁平指令流**（E2 定案）：嵌套 series/parallel/wait 树 → **显式时间 + 无嵌套**。
  `` 依据：结构化输出实测——3 层嵌套错误率 15–25%，扁平化 <5%（LLM 自回归生成时"数不清括号"）``

### 4.2 扁平指令流 schema（Directive Stream v2）
```json
{
  "v": 2,
  "target": "小夏",
  "directives": [
    { "id": "d1", "op": "play",   "asset": "挥手",      "at": 0,   "cover": { "speed": 1.2, "strength": 0.8 } },
    { "id": "d2", "op": "face",   "expression": "开心", "at": 0 },
    { "id": "d3", "op": "set",    "sem": "害羞", "value": 0.5, "at": "+d6" }
  ]
}
```
- **`at`**：`数字 ms`（绝对）| `"+N"`（相对上一条）| `"+<id>"`（依赖指定指令**开始**）。
- **`dur`**（可选）：覆盖资产固有时长；`"+<id>"` 依赖解析 = 该 id 的 **结束**（`at+dur/时长`）。
- 无跨行依赖 = 直接参与流式驱动（见 §7）；有依赖（`+<id>`）= 仅离线批量模式可用。
- **校验**：依赖环检测 + id 唯一 + 引用存在 + at/dur 时序健全 + op/资产存在 + **`finish_reason:"length"` 前置检查（截断批量拒绝整批）**。
- **IR schema 最大深度 ≤2**（顶层对象 + 一层 directives 数组）。

### 4.3 指令原语（首版集合，op）
`play / face / set / outfit / speak / blink / drift / look / camera / action / emote / wait`
- `set`：唯一参数写入原语（写 override 层，最高优先）
- `emote`：★ 新增——环境层调制（`{valence, arousal}` 连续值），见 §6；不写动作/override
- 语言 B 源 `behavior.ldsl` 编译为同一（扁平）IR，`parallel/after` 语义由编译器展开成 `at`。

### 4.4 覆盖混合（沿用 D2 公式）
```
V_p(t) = clamp( Σ_l α_l · g_{l,p} · β_l(t) · v_l(t'), min, max )
```
- 动作层混合 + 表情层按 Blend + 环境层 Add（α_ambient）+ override 最高。
- 最小集（先上）：`speed` + 「最近层胜出」；α/gate/mix 后续。

---

## 5. 运行时：分层求值 + 优先级/打断

- **播放层栈**：每实例 = 常驻环境层 + 若干动作层（按 priority 叠放）；并行指令 = 依次建层，系列指令 = 等前组完成。
- **双事件源**：`engine.dispatch(event)`（事件驱动）+ `engine.onFrame(dtMs)`（帧驱动，宿主 rAF）。
- **优先级与打断**（v0.1 7.5 延续）：
  - 高优先级可打断低优先级（`interrupt: target|supersede|queue`）；打断后按策略恢复
  - 同优先级：`overlap: add|queue|replace`
  - 常驻环境层**永不相互打断**，被高层动作覆盖时间片
- **barge-in（抢话打断）**：`user_voice` 事件 → 当前 speak 立即衰减、动作层挂起（可恢复）。
- **统一时钟**：语音播放用 **audioClock**（playhead，可暂停/seek/打断），其余用 **wallClock**；一条时间轴内不得混用。干跑 = 无音频固定采样，保确定性。
- 所有层输出最终合并到**角色参数域一次写管线**（避免同参数多写冲突）。

---

## 6. 环境层（程序化 ambient）★ v3.0 唯一保留贡献

### 6.1 为什么保留
"木偶感的根源是静态"——待机/语音间隙/资产间身体必须**恒动**。工业已验证（Animaze/AnySoul 的四通道叠加环境动画）。

### 6.2 控制器集（确定性，种子化，60fps 常驻）
```
BreathController         呼吸：emote.arousal↑ → 浅快；valence↓ → 深缓
BlinkController          眨眼：随机间隔（种子）
GazeController           视线微动：微眼跳/漂移（1/f 噪声）；emote.focus 调制
WeightShiftController    重心微移：周期 + 1/f 噪声
IdleFidgetController     无意识小动作：低频稀疏（种子调度）
```
- **1/f 粉噪声是生命签名**：生理信号（姿势晃动/眼动/呼吸）呈 1/f 频谱；白噪声=机械抖动、纯正弦=机器呼吸、**1/f=活的**。
- **眼睛不许"定住"**：固视微动（微眼跳/漂移/震颤）防止视觉适应——眼睛恒定微动是生理必需，非审美。
- 每个控制器是**二阶弹簧-阻尼系统**（`m·ẍ + c·ẋ + k(x−x₀)=0`，临界阻尼）：速度/加速度连续，近似**最小急动轨迹**（Flash&Hogan），消除关键帧边界 jerk 尖峰。
- 输出落到 sem（经 manifest 映射）；模型缺该 sem → D1 自动隐藏，不报错。

### 6.3 emote 调制
```json
{ "op": "emote", "valence": 0.6, "arousal": 0.4 }
```
- 写入"当前环境状态"（单一），覆盖先前的 emote；确定性平滑过渡（时间常数）。
- 只调制环境层（呼吸/体态/视线/幅度 α），**不写动作/override** → 与 `set` 层级分明，天然不干扰。
- **情绪不来自 LLM 主观猜**：emote 值由宿主从**可观测信号**（文本情感分析工具/交互记录/用户评分）+ 确定性动力学得到；LLM 可"确认/微调"，**不当主力感知器**（LLM 零样本情绪识别仅 44–62%，不可依赖）。

---

## 7. 流式驱动（JSONL）★ 本次整合核心

### 7.1 交互入口：JSONL 逐行流
```
{"op":"play","asset":"挥手","strength":0.7}
{"op":"speak","text":"你好呀！"}                      # → TTS → SpeechTimeline → 音频脊梁
{"op":"emote","valence":0.6,"arousal":0.4}            # → 环境层调制（持续，直到下一条 emote）
{"op":"face","expression":"开心","blend":"add","weight":0.6}
{"op":"look","target":[0.4,0.5]}
{"op":"set","sem":"害羞","value":0.3}                 # → override 层
{"op":"play","asset":"点头"}                          # 坏行被隔离跳过，流继续
```
**语义：一行 = 一条独立指令 = 一个层上的一个动作。行级原子。无跨行依赖。**

### 7.2 为什么行级、不整批
- **实时交互的感知延迟**：LLM 端按"换行=完整 JSON"切分，**每行生成完即可解析生效**——第一个动作先动起来，TTS 随后，LLM 继续生成下一行。不用等整批。
- **错误隔离**：坏行只丢一行（跳过+记录+回退常驻层），不像整批原子验证"一错毁全批"——**流式反而更鲁棒**。
- **发送粒度是"行"不是"token"**：半行 JSON 无法解析；必须以换行为界，收到完整行才 apply。
- **本地模型 grammar 约束**：XGrammar/GBNF 可约束"多行 JSON 对象"流，逐行语法接近零失败。

### 7.3 双模式校验（共享同一规则库，执行策略不同）
| 模式 | 入口 | 校验策略 | 失败处理 |
|---|---|---|---|
| **在线（流式）** | 交互 JSONL | **快校验**逐行（<1ms：可解析+op合法+sem存在+值域）→ 即 apply | 坏行跳过+回退常驻层，流继续 |
| **离线（批量）** | 创作/固化 | **整批原子**（全套 7 类 + 干跑） | 失败整批拒绝，产错误报告 |
- **慢校验（安全/内容/数值干跑）**在线下异步后台对"已生效行"复核；命中风险 → 该行可**回滚**（保留 undo 栈）。
- **不能完全不校验**：快校验是底线（防非法 JSON/越界值污染画面）；"不用全部验证"= 不做整批原子门禁，**不是**取消校验。

### 7.4 分层路由（"不干扰"的实现）
```
play   → 动作层      face → 表达层      set → override 层      emote → 环境层
```
- 层与层互不覆盖；**同一层写同一 sem** 才是真冲突 → 交给 priority/打断规则（§5）。
- JSONL 只保证结构独立，**语义不干扰靠层模型设计**（§2 分层职责表）。

### 7.5 接口
```ts
interface StreamIngestor {
  feedLine(line: string): ApplyResult;       // 逐行：快校验 → 分层 apply；坏行 {skipped, reason}
  feedBatch(ir: DirectiveStream): ApplyResult; // 离线：整批原子校验 → apply（或拒绝）
  undo(): void;                               // 回滚最近"已生效但慢校验失败"的行
}
```

---

## 8. 校验器：双模式共享规则库

7 类规则（沿用 v0.1 10 章）：
| 层 | 规则 | 错误示例 |
|---|---|---|
| 语法 | 可解析、无悬空块、键值合法 | 缺 `}` / track 无关键帧 |
| 语义 | 引用存在（sem/layer/outfit/资产/cast） | `track 尾巴`（无此 sem） |
| 命名 | 无裸 PARAM_/PARTS_（映射区外）；官方 ID 过白名单 | `track PARAM_ANGLE_X` |
| 范围 | 值落 sem 范围；首版硬校验 | `sem 眼开合 = 1.5` |
| 曲线 | 时间单调、关键帧 ≥2、duration>0、easing 白名单 | `{300:1; 150:0.2}` |
| 引用 | source 存在、play 在库、outfit 有部件 | `play "不存在挥手"` |
| 干跑 | 求值无 NaN/越界 | 除零/NaN |

**IR/流专属（新增）**：依赖环检测、id 唯一、`finish_reason` 检查、未知 op 拒绝、`at` 时序健全。
输出结构 `{ok, issues:[{path,line,col,rule,message}]}`——直接回传 LLM 自修复；同一规则库服务编辑器实时红线 + LLM 通道。

---

## 9. LLM 通道

### 9.1 定位与分工（本次定案）
- **LLM 是决策者，不是感知器**：做枚举决策（意图→kinds→选资产+覆盖）——它擅长的；**不做情绪主观感知主力**（仅可"确认/微调"宿主提供的 emote）。
- **驱动模式是主路径（P5）**，**创作模式（P4）后置为高级可选**。
- 通道与素材生成链路正交；内容底线对 speak 文本同源生效。

### 9.2 Provider 抽象（能力协商，三级输出）
```ts
interface RuntimeProvider {
  capabilities(): { structured: "native"|"grammar"|"text"; grammarHint?: "xgrammar"|"outlines"|"gbnf" };
  createCompletion(req, opts: { schema?; grammar? }): Promise<ChatResult>;
}
```
| 级 | 适用 | 备注 |
|---|---|---|
| native | OpenAI/Anthropic | structured outputs / function calling |
| grammar | 本地（Ollama/vLLM） | XGrammar（PDA 编译，vLLM/SGLang/TensorRT 已内建）/ GBNF；语法失败 5–15%→<0.1% |
| text | 万能降级 | 健壮 JSON 提取（围栏→花括号配对→尾逗号修复→重试≤3→最简 prompt 兜底），跨 provider 共享 |

**统一校验闸**：无论哪级，输出必过 §8 规则库 + 语义抽查 + 干跑。**不过度约束**（过约束 → 模型输出"安全但无意义"值）。

### 9.3 驱动模式（两跳）
- **第一跳（<50ms）**：本地规则引擎 + 缓存化行为选择（事件→最高优先已登记 behavior 直接出 IR），或直接流式行。
- **第二跳（异步，不阻塞）**：LLM 决策（意图→kinds 检索资产 + 参数填充）→ JSONL 流逐行注入。
- 仅危险动作（自定义重写/非常规覆盖）等待 LLM 结果。

### 9.4 创作模式（P4，后置）
few-shot 生成语言 A → 校验 → 错误回传自修复（≤3 轮）→ 编译 → 干跑 → 人工确认 → 固化。
LLM 创作**不出现在实时主线**（创作质量不可控、过约束退化）。「装置级动画跨模型复用」遗留待定。

---

## 10. 语音与口型（SpeechTimeline / 音频脊梁）

```ts
interface SpeechTimeline {
  text: string; lang: string; audio?: Uint8Array;
  durationMs: number;
  visemes?: { tMs: number; viseme: VisemeId; weight?: number }[];  // 可选
  prosody?: { tMs: number; energy: number; pitch: number }[];      // 可选（韵律包络）
}
interface TextToSpeechProvider {
  synthesize(text, opts?): Promise<SpeechTimeline>;
  capabilities(): { visemes: boolean };
}
```
**三级口型降级**：visemes（TTS 逐音素时间戳，60–80ms 入出混合）→ RMS（音频音量包络）→ 简谐（无音频，预设时长）。
**韵律调制**：`prosody.energy/pitch` → 手势幅度/时机 + 微表情 + 头部节奏（言语-动作跨通道耦合；声↔手势相关性是"活"的信号）。
**事件**：`lipsync:start/end` 回待机口型；synthesize 返回 durationMs 对齐 audioClock。

---

## 11. 评估集与安全

### 11.1 LLM 层评估集（黄金测试）
```
specs/evals/drive-cases.json     驱动模式：{scenario, 期望语义效果}（非逐字节 IR）
scripts/eval-drive.mjs           批量跑：LLM→IR→确定性求值→断言语义效果
```
度量：通过率 + 失败模式分布（语法/语义/拒绝/超时），按 provider 记录；改提示词/schema 必过评估集（CI 门禁）。

### 11.2 语义抽查（运行时，高风险才触发）
规则引擎预筛（自定义覆盖/新资产/非常规 override/未知减速）→ 触发二次校验（LLM 复核或确定性复核）→ 挂**慢路径**（不增加首跳延迟）。低风险只过结构校验+干跑。
- 依据：受约束解码只把"括号错"变"值错位"——**100% 校验率≠语义正确**，语义护栏不可省。

### 11.3 安全与回退（沿用 D5，四层）
规模上限（节点≤64/深度≤2/总时长可配）、频率兜底（指令节流/冷却/同事件去重）、非法拒绝（整批拒绝或坏行跳过，回退常驻环境层）、数值防护（NaN/Inf 干跑前置拦截）。审计：驱动决策与 speak 文本写 audit_log。

---

## 12. 与宿主（自研引擎）接口

沿用 `ARCHITECTURE.md` 的 8 个注入接口（ParameterSink / AssetSource / ManifestSource / RuntimeProvider / TtsProvider / Clock / SeededRandom / AuditSink / ContentPolicy），新增：
```ts
interface StreamIngestor           // §7.5 流式/批量双模式入口
interface AffectSignalSource { get(): { valence; arousal } }  // 情绪可观测信号（宿主提供，LLM 不主猜）
```
**自研引擎预期增益**：比官方更多模块（重心/躯干分节/手势部件）→ 环境层控制器真实可见；语义层 manifest 映射区直接覆盖新模块；`specs/parts-naming.json` / `standard-params.json` 扩展走 specs 单一来源（硬约束 #3）。

---

## 13. 路线图（重排：P5 先于 P4）

| 序 | 阶段 | 内容 | DoD |
|---|---|---|---|
| 1 | **P2** | 校验器全套（7 类 + IR/流专属）+ 干跑 | 错误结构可回传；规则库服务双模式 |
| 2 | **P3** | 扁平 IR（§4）+ 环境层控制器（§6）+ 分层求值/优先级（§5） | 环境层在自研引擎干跑可见；IR 确定性回归 |
| 3 | **P3b** | **JSONL 流式驱动**（StreamIngestor，§7）+ 双模式校验 | 逐行 <1ms 快校验；坏行隔离不阻塞；undo 可回滚 |
| 4 | **P5** | 驱动通道：两跳 + Provider 分级 + 评估集（§9/§11） | 第一跳 <50ms；评估集全绿 |
| 5 | — | MCP 表层（可选，E6）：IR→工具清单同源生成 | 工具清单 = function schema 同源 |
| 6 | **P4** | 创作通道（few-shot + 自修复 + 干跑），高级可选 | 3 轮内修出合法运动文件 |
| 7 | P6 | 词表生成器 / scene 舞台 / TTS 升级 / parts-naming 扩展 | 换装/多角色端到端 |

**方针**：P5 为产品主价值（LLM 实时驱动模型）先行；P4 创作作为进阶能力后置。

---

## 14. 决策记录（本次确认）★ 权威清单

### 14.1 确认
| # | 决策 |
|---|---|
| A1 | **融合分工**：LLM 决策 + author 表达 + 程序化环境 + 情绪来自信号（§0/§2）——否决"环境层作替代"的激进读法 |
| A2 | **JSONL 流式驱动**为在线交互主入口（§7）；行级原子、逐行快校验、坏行隔离、undo |
| A3 | **双模式校验**共享规则库：在线=逐行摄取、离线=整批原子（§7.3/§8） |
| A4 | **扁平指令 IR（Directive Stream v2）**：深度 ≤2、显式 at、无跨行依赖者入流式（§4） |
| A5 | **环境层保留**为底层（呼吸/眨眼/视线/重心 + 1/f 噪声 + emote 调制）（§6）；情绪不靠 LLM 主观猜 |
| A6 | **统一时钟** audioClock + wallClock、barge-in 抢话打断（§5） |
| A7 | **SpeechTimeline**（viseme/prosody 可升级接口）（§10） |
| A8 | **Provider 分级**（native/grammar/text）+ 能力协商（§9.2） |
| A9 | **LLM 评估集 + 语义抽查**（§11） |
| A10 | **Roadmap 重排**：P5 > P4；创作后置（§13） |
| A11 | **来自 v0.1 保留**：语义层/manifest 缓存/两跳/确定性/安全四层（§1/§5/§9/§11） |
| A12 | **自研引擎为宿主**：manifest 扩展走 specs 单一来源（§12） |

### 14.2 明确否决
- ~~环境层替换 author 资产/LLM 决策~~（AAA 实践：表达用 author/mocap；程序化只做环境）
- ~~让 LLM 当情绪/意图感知主力~~（零样本情绪识别 44–62%，不可靠）
- ~~整批原子验证作为交互唯一路径~~（实时交互改逐行流式，整批留给离线）
- ~~嵌套 IR 树作 LLM 输出~~（错误率 15–25%）

### 14.3 遗留（进入对应阶段再议）
1. `look` 视线映射比例（PARAM_EYE_BALL_X/Y 与头转角分配）——P3b 前定
2. library 资产权重/随机选择——P5 可选
3. 装置级动画跨模型复用——P4
4. MCP/VTS sink 是否作为宿主缺省后端——P5 后

---

## 15. 文件与版本

- **本文档版本 = 设计规格 v1.0**（确认版），标记设计定案；不是代码产物版本号
- **DSL 语法版本**：原 `packages/dsl/src/version.ts` 所在包已随 M7+ 重构移除，DSL/资产语法版本由 `@l2dp/convert` 的 `CONVERT_SYNTAX_VERSION`（0.1.0）承接；语言 A 语法未变，待语法/IR 变更时同步 `1.0.0`（避免代码与文档不同步）
- **IR 版本**：Directive Stream `v: 2`（扁平 IR 定案即生效）
- **manifest**：`formatVersion`（破坏性 +1）
- 本文档取代：`SPEC-DSL-v0.1.md`、`DESIGN-v0.2-提案.md`、`DESIGN-v3.0-发散蓝图.md`（已删除）

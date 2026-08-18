# Live2D Forge 动作与驱动 DSL 设计规范 v0.1

> 本文件是 `SPEC-v2.0.md` 的补充子规格，为 AI 开发智能体提供可执行的设计蓝图。
> 目标：为平台补齐「规则/脚本语言」能力——**两层语言**让大模型既能**装配角色与开发动画**（语言 A：创作层 DSL），也能**实时驱动模型做出动作反馈**（语言 B：驱动指令层）。LLM 生成友好、人类修改友好、模型无关。
>
> 一切标识符、结构、校验规则与现有资产对齐（白名单/命名/l2dp 格式/求值管线），**新增能力不破坏既有链路**。

---

## 0. 硬性约束（不可更改，违反即打回）

1. 语言面向两面用户：**机器（LLM）可生成** + **人类可读改**。二者缺一不可，不得为了机器便利牺牲可读性，也不得为了行文漂亮牺牲可校验性。
2. **模型无关**：语言 A / B 的正文只允许引用「语义层」的名字（sem 语义参数、layer 身体层、outfit 换装位、motion/expression/behavior 资产名），一律**禁止在正文写裸的官方参数 ID（PARAM_*）或裸部件 ID（PARTS_*）**。官方 ID 只允许出现在角色 manifest 的映射区——**映射区定义 = `sem <名> [范围] -> { PARAM_* }` 块右侧**；其余任何上下文（track/set/play/layer/注释/字符串）出现 `PARAM_*`/`PARTS_*` 一律编译错误。违反此条视为非法。
3. 标准参数语义与白名单以 `specs/standard-params.json`（官方 32 参数基线）为规范源、`packages/l2dp/src/params.ts` 的 `isStandardParam()` 为运行时校验集（32 官方 + 扩展）；部件命名以 `specs/parts-naming.json` 为单一来源；变更走 specs 文件而非散落在 DSL 中。
4. 编译产物必须可被现有链路消费：language A 的 motion/expression 直接编译为官方 `motion3.json` / `exp3.json` 结构（对齐 `packages/l2dp` v0.2 类型与 `docs/SPEC-v2.0.md` 6.2 字段规格）；装配结果输出为 `.l2dp` 工程补丁，禁止引入第二套「平行资产格式」。
5. 驱动运行时必须汇入现有「参数求值管线：动作曲线 → 表情(Add/Multiply/Overwrite) → 物理输出 → 用户 override（最高）」(`SPEC-v2.0.md` 10.3)，不得另起一套求值逻辑。
6. 平台既有生成链路（云 API / 本地 ComfyUI 双轨）与本文档的 LLM 决策通道**正交**：本 DSL 的 LLM 通道不参与素材生成路由，也不接生成任务；平台内容底线（不涉及未成年人形象的成人内容）对驱动通道实时决策内容同源生效。
7. 一切 DSL 输入在编译/执行前必须过校验器（语法→语义→范围→曲线→干跑），校验不过不得进入编译或执行。LLM 生成物与人工编写物同一门槛。

---

## 1. 定位与范围

### 1.1 本规格覆盖
- **语言 A（创作层 DSL，扩展名 `.ldsl`）**：装配（角色/身体层/骨/换装位/语义参数/舞台场景）、动画（关键帧曲线）、表情。编译器输出可被 Cubism 官方格式与 `.l2dp` 消费。
- **语言 B（驱动指令层）**：行为脚本（事件、时序、动作调用、动作覆盖、多角色寻址）。编译为 **Directive IR(JSON)**，由运行时调度器驱动渲染。
- **语义层词表**：sem 语义参数 / layer / outfit / 资产名的参考实现（默认绑定标准参数白名单 + Haru 部件集）。
- **LLM 通道**：创作模式（few-shot 生成语言 A + 校验错误回传自修复 + 干跑预览）与驱动模式（function calling 输出 Directive IR）；provider 抽象，云 API 与本地模型同接口。
- **动作资产生命周期**：生成 → 校验 → 固化 → 复用（固定调用 + 参数化覆盖）；「直接生成」与「固定动作调用」双路径统一进同一时间轴。

### 1.2 非目标（本版明确不做）
- 不设计通用编程语言（无变量作用域/控制流/表达式引擎首版先不做；语言 B 序列结构即时序控制流）。
- 不做口型深度同步（与 `SPEC-v2.0.md` 1.2 对齐；`speak` 首版用 LipSync 参数组 + 简谐信号驱动，声音时长对齐）。
- 不生成/修改 `moc3` 二进制（装配的资产边界 = `.l2dp` 结构与 `.model3.json` 配套 JSON，moc3 仍由 Cubism Editor / 现有双轨导出负责，见 `SPEC-v2.0.md` 6.3 / 10.5）。

---

## 2. 设计原则

| # | 原则 | 落地手法 |
|---|---|---|
| P1 | **语义层是心脏** | 语言正文只说语义名；manifest（角色接入文件）做「语义名 → 官方 ID/部件」映射。换模型不破坏已写内容 |
| P2 | **模型生成的友好 = 可校验 + 错误可回传** | 语法紧凑少标点、few-shot 模板、解析/校验错误带行列号回传 LLM 自修复、干跑预览兜底 |
| P3 | **人类修改的友好 = 结构化缩进 + 单向表述** | 键值声明式，无副作用隐式顺序；注释即文档；机器(Hygiene)与人工(curated)两种文本视觉可辨 |
| P4 | **双态动作资产** | 固定态（入库、命名、校验、可索引）与生成态（现场编译、不落库、可一键固化）。驱动时均可被参数化覆盖叠加 |
| P5 | **一条时间轴** | 固定调用与直接生成的产物统一进同一调度器；再新的生成动作也能与存量动作叠加 |
| P6 | **模型无关 + 参考词表** | DSL 本身不含任何 PARAM_*/PARTS_*；默认实验词表 = 标准白名单 + Haru 部件集，任何新模型提交 manifest 即接入 |

---

## 3. 系统总览

```
┌────────────────────────────── 意图层（LLM 自由发挥）──────────────────────────────┐
│   创作模式：自然语言目标 →（few-shot）→ 语言 A 源 .ldsl                           │
│   驱动模式：用户输入/事件 →（function calling）→ Directive IR(JSON)               │
└────────────────────────────────────┬─────────────────────────────────────────────┘
                                     ▼
┌──────────────────────────── 语义层（共享词典）────────────────────────────────────┐
│   sem 语义参数 / layer 身体层 / outfit 换装位 / 资产名（motion/expression/behavior）│
│          └─ 默认参考词表 = specs/standard-params.json + specs/parts-naming.json   │
│          └─ 角色 manifest：语义名 → 官方 PARAM_* / PARTS_*                        │
└────────────────────────────────────┬─────────────────────────────────────────────┘
        ┌────────────────────────────┴─────────────────────────────┐
        ▼                                                            ▼
┌─ 语言 A（创作层，编译）────────────────┐      ┌─ 语言 B（驱动层，解释）───────────────┐
│ character.ldsl 装配 → .l2dp 补丁       │      │ behavior.ldsl → Directive IR(JSON)   │
│ motion.ldsl 动画   → motion3.json      │      │ 时间轴调度器（parallel/seq/wait/loop）│
│ expression.ldsl   → exp3.json          │      │ 覆盖/混合/优先级/打断/多角色寻址       │
│ scene.ldsl 舞台   → 渲染布局           │      └───────────────┬───────────────────────┘
└───────────────────┬───────────────────┘                      ▼
                    ▼                          现有参数求值管线（10.3）
        .l2dp / Cubism 官方格式                  动作→表情→物理→override
                    │                                      │
                    └──────────────► 渲染器（自研 / Cubism SDK 双预览）
```

---

## 4. 核心概念模型

| 概念 | 定义 | 对齐现有资产 |
|---|---|---|
| **Character 角色** | 可装配、可入场的模型实例；`source` 指向 `.l2dp` 工程或 `.model3.json` 全家桶 | `.l2dp` manifest / model3 |
| **Layer 身体层** | 把部件归组成语义组；可整体变换、可见性、物理、换装 | body 类资产、parts.json category |
| **Bone 骨/手柄** | 层内变换手柄（位移/旋转/缩放），对齐 deformer 语义 | deformers.json |
| **Outfit 换装位** | 一组可整体切换的服装部件；按 costumeGroup 成组 | `PARTS_<工程>_<名>_<组号>`、clothing 类资产 |
| **Sem 语义参数** | 人类/LLM 可读的「动作维度」，映射到 1..n 个官方参数 | standard-params.json、SPEC 9.3 映射表 |
| **Motion 动作资产** | 关键帧曲线（固定态可入库） | motions/*.motion3.json |
| **Expression 表情资产** | 参数快照 + Blend | expressions/*.exp3.json |
| **Behavior 行为脚本** | 驱动层时序+事件+寻址（固定态可入库） | —（新增） |
| **Scene 场景** | 多角色舞台编排 + 相机 + 背景 | —（新增，多模型/舞台编排目标） |
| **Library 动作库** | 固定态资产索引（名字、参数化覆盖面、触发条件） | —（新增） |

---

## 5. 语言 A（创作层 DSL）语法规范

> 所有 DSL 文件扩展名 `.ldsl`；UTF-8；缩进式块 + `key: value`；注释 `//`；块内以「语义名」引用实体；数值可带单位 `ms / s / deg / px`。

### 5.1 文件布局（惯例）
```
characters/<role>/character.ldsl      # 装配：source + layers/bones/outfits/sems
characters/<role>/motions/**/*.ldsl    # 动作曲线（motion 块）
characters/<role>/expressions/*.ldsl   # 表情（expression 块）
scenes/<name>.ldsl                     # 舞台编排（scene 块 + cast）
behaviors/*.ldsl                       # 驱动行为（behavior 块，语言 B）
library.ldsl                           # 动作库索引
```

### 5.1.1 动作库索引 library.ldsl

```
library {
  挥手:   { kinds: [greeting 挥手 打招呼]; type: motion;     params: [speed strength mix] }
  呼吸循环: { kinds: [idle 呼吸];         type: motion; loop: true; params: [speed] }
  点头:   { kinds: [confirm 同意 点头];  type: motion;     params: [speed] }
  welcome: { kinds: [enter 迎客 欢迎];   type: behavior;   on: user_enter; params: [语气] }
}
```

- `kinds` 是语义标签（**意图检索用**）：LLM 驱动模式按「意图 → kinds」查库选资产，杜绝凭空造资产名（见 9.4）。
- 任何 behavior 的 `play / face / outfit / action` 引用的名字**必须已在库中登记**；缺失 = 编译期校验错误（10 章）。
- 库同时登记固定态动作的**可参数化覆盖面**（speed/strength/mix/局部 gate），供校验器与 LLM 提示模板读取。

### 5.2 character 块（装配）

```
character 小夏 {
  source: "projects/xiaoxia.l2dp"
  slot: main                          // 场景入场槽位名（可选）

  // —— 身体层：把部件归组为语义层（部件名 = specs/parts-naming.json body 白名单）——
  layer 脸面 { parts: [face hoho ear nose eye eyeball brow mouth neck]; z: 30 }
  layer 前发 { parts: hair_front; z: 10; physics: hair }
  layer 侧发 { parts: hair_side;  z: 8;  physics: hair }
  layer 后发 { parts: hair_back;  z: 0;  physics: hair }
  layer 躯干 { parts: [body_upper body_lower]; z: 20 }
  layer 手臂 { parts: [arm_a arm_b]; z: 19 }
  layer 胸   { parts: adult_breast; z: 25; physics: bust }       // PARAM_BUST_Y
  layer 腿脚 { parts: [leg feet]; z: 18 }
  layer 阴部 { parts: adult_genital; z: 17 }

  // —— 骨/手柄：层内变换（对齐 deformer）——
  bone 头   { layer: 脸面; pivot: [0.5 0.9]; limit: 旋转 ±30deg }
  bone 躯干 { layer: 躯干; pivot: [0.5 0.5] }

  // —— 换装位：按服装组号成组（部件带 _NNN 后缀）——
  outfit 连衣裙组 { group: 001 }
  outfit 制服组   { group: 002 }

  // —— 语义参数：语义名 → 官方参数映射（正文只准用语义名）——
  sem 眼开合  [0 1]        → { PARAM_EYE_L_OPEN PARAM_EYE_R_OPEN }
  sem 微笑    [0 1]        → { PARAM_EYE_L_SMILE PARAM_EYE_R_SMILE PARAM_MOUTH_FORM }
  sem 嘴开合  [0 1]        → { PARAM_MOUTH_OPEN_Y }
  sem 害羞    [0 1]        → { PARAM_TERE }
  sem 呼吸    [0 1]        → { PARAM_BREATH }
  sem 头转向  [-30deg 30deg] → { PARAM_ANGLE_X }
  sem 躯干侧弯 [-20deg 20deg] → { PARAM_BODY_ANGLE_Z }
  sem 胸摆动  [0 1]        → { PARAM_BUST_Y }
  sem 臂左上  [0 1]        → { PARAM_ARM_L_A }
  sem 臂右上  [0 1]        → { PARAM_ARM_R_A }
}
```

规则（补充）：
- **自定义扩展**：除平台内置「核心词表」外，`character.ldsl` 可追加模型特有 sem（如尾巴/翅膀）；自定义 sem **不得与核心词表重名**（校验）。核心词表由平台维护，见 12 章。
- 一个官方参数可被多个语义映射共用，但**同一时刻驱动层只经显式选定的那条 sem 写入该参数**（仲裁见 7.4 / 12.1）。

规则：
- `parts` 引用 body 白名单部件名或带组号的服装部件；`z` 为渲染顺序（对齐 drawOrder）。
- `sem` 范围 `[min max]`，min/max 必须单调；映射目标必须存在于 `specs/standard-params.json`（官方 ID）；一个官方参数可被多个语义映射共用。
- **manifest 语义**：`character.ldsl` 同时即角色接入文件。导入新模型时系统对照标准词表生成等价 manifest（缺失的官方参数自动从角色 `sem` 隐藏——语言是词典，模型是词表）。

### 5.3 motion 块（关键帧曲线，编译 → motion3.json）

```
motion 挥手 {
  group: Idle               // 落盘 motions/<Group>/<name>；Idle 组约定存在 ≥1
  duration: 1800
  loop: false

  track 头转向  { 0: 0deg; 300: 20deg; 900: 8deg; 1500: 0deg; easing: easeOut }
  track 眼开合  { 0: 1; 120: 0.2; 260: 1 }                 // 眨眼（关键帧自动 linear）
  track 臂左上   { 0: 0; 400: 1; 1400: 0; easing: easeOutBack }
  track 嘴开合  { curve: breath }                          // 引用内置函数曲线
}
```

- `track <语义名>` 只能引用本角色 manifest 的 sem；值域必须在 sem 范围内（越界 = 校验错误，不静默钳制——首版钳制策略见 10.3）。
- `easing` 取值：`linear / easeIn / easeOut / easeInOut / easeOutBack`（编译为对应贝塞尔控制点，对齐 motion3 segment）。
- `curve: breath` 表示简谐函数曲线（内置信号表：breath / blink / wave / random），不写关键帧。
- 编译映射：每 `track` → motion3 `curves[]`；`duration/fps/loop` → `meta`；关键帧 → 扁平段 `segments`（linear 两段式 / easing 生成贝塞尔控制点）。

### 5.4 expression 块（表情，编译 → exp3.json）

```
expression 开心 {
  blend: Add
  set 微笑    = 1.0
  set 眼开合  = 0.9
  set 嘴开合  = 0.3
}
```
- `set 语义名 = 值`（值在 sem 范围）；`blend` ∈ `Add | Multiply | Overwrite`（与 exp3 `Blend` 对齐）。
- 编译映射：`set` 展开为 exp3 `parameters[]`（{id, value, blend}）。

### 5.5 scene 块（舞台编排，多模型/换装目标）

```
scene 书房 {
  camera { zoom: 1.2; anchor: [0.5 0.6] }
  cast 小夏 { source: characters/小夏/character.ldsl; anchor: [300 400]; scale: 1 }
  cast 阿明 { source: characters/阿明/character.ldsl; anchor: [700 400]; scale: 1.1 }
  bg: "textures/study.png"
  physics: on
}
```
- `cast` 实例化角色，运行时多实例渲染；锚点/缩放为画布布局。

### 5.6 语言 A 语法 BNF（摘要）

```
dslA        := (character | motion | expression)+        // scene 属 P6（舞台编排）
character   := 'character' ident '{' (source | slot | layer | bone | outfit | sem)* '}'
source      := 'source' ':' STRING
slot        := 'slot' ':' ident
layer       := 'layer' ident '{' 'parts' partsRef ( 'z' ':' num | 'physics' ':' ident )* '}'
partsRef    := ident | '[' ident+ ']'
bone        := 'bone' ident '{' 'layer' ':' ident ( 'pivot' ':' '[' num num ']' | 'limit' ':' (ident)? ('±'|'+'|'-')? num unit? )* '}'
outfit      := 'outfit' ident '{' 'group' ':' int '}'
sem         := 'sem' ident '[' num unit? num unit? ']' '->' '{' PARAM_ID+ '}'
motion      := 'motion' ident '{' blockMeta track+ '}'
track       := 'track' semIdent '{' (num ':' value (';' 'easing' ':' easingName)? | 'curve' ':' funcName) '}'
expression  := 'expression' ident '{' 'blend' blendMode set+ '}'
set         := 'set' semIdent '=' num
scene       := 'scene' ident '{' camera? cast+ bg? '}'      // P6
cast        := 'cast' ident '{' 'source' str 'anchor' '[' num num ']' ('scale' num)? '}'
```

---

## 6. 编译目标与映射表

| 源（语言 A） | 目标 | 落点 |
|---|---|---|
| `character.layers/bones` | `.l2dp` parts 分组（layer→语义组）、deformers 增量 | `packages/l2dp` 补丁 |
| `character.outfits` | parts.json `costumeGroup` / 部件可见性组 | `parts.json` |
| `character.sems` | params.json（官方 ID、standard 标记）+ groups.json 扩展组 | `params.json` / `groups.json` |
| `motion` | `motions/<Group>/<name>.json`（对齐 motion3） | `.l2dp` motions 目录 |
| `expression` | `expressions/<name>.json`（对齐 exp3） | `.l2dp` expressions 目录 |
| `scene` | 前端渲染布局（实例化 + 相机 + 背景） | apps/web / renderer |

编译结果以「补丁」形式作用到目标工程：**不重写未涉及字段**，保证导入模型的既有内容无损（对齐无损双向映射目标，`SPEC-v2.0.md` 6.3）。

---

## 7. 语言 B（驱动指令层）规范

> behavior 语法（`.ldsl` 中 `behavior` 块）+ 内部 **Directive IR(JSON)**。语言 B 的「正文语法」面向人类可读改，「Directive IR」是后端唯一执行形态，也正是 LLM 驱动模式的 function calling 输出 schema。

### 7.1 behavior 块

```
behavior welcome {
  on: user_enter            // 触发事件
  priority: 10
  guard: 小夏.idle           // 前置条件（可选）

  do {
    play  小夏 "挥手" { strength: 0.9 }   // 固定态动作调用 + 覆盖
    face  小夏 "开心"
    outfit 小夏 "连衣裙组"
    speak 小夏 "你好呀，欢迎回来！"
  }
  after 400ms {
    play 小夏 "点头"
  }
}

behavior 待机循环 {
  on: idle
  loop: true
  do {                                  // 块内一律并行（无 parallel 关键字）
    play  小夏 "呼吸循环" { speed: 1 }
    blink 小夏 { interval: 4s }
    drift 小夏 头转向 amplitude: 3deg period: 8s
  }
}
```
- 注：示例中 `play "点头" / "呼吸循环"` 为**已入库固定资产**（须在 `library.ldsl` 登记，见 5.1.1）；未登记引用在校验期即报错。

### 7.2 指令原语（首版集合）

| 原语 | 语义 | 示例 |
|---|---|---|
| `play <角色> "<资产>" { override }` | 播放固定动作，可参数化覆盖 | `play 小夏 "挥手" { speed: 1.1 }` |
| `face <角色> "<表情>"` | 表情混合叠加 | `face 小夏 "开心"` |
| `set <角色> <语义名> = 值` | 设语义参数为恒定目标值（**唯一参数写入原语**，写 override 层，最高优先） | `set 小夏 害羞 = 0.6` |
| `outfit <角色> "<换装位>"` | 换装（服装组整体切换） | `outfit 小夏 "连衣裙组"` |
| `speak <角色> "<文本>"` | TTS 播报 + LipSync 口型 / 时长对齐 | `speak 小夏 "你好"` |
| `blink <角色> { interval }` | 自动眨眼 | `blink 小夏 { interval: 4s }` |
| `drift <角色> <语义名> amplitude period` | 持续慢漂移（随机游走呼吸） | `drift 小夏 头转向 amplitude: 3deg period: 8s` |
| `look <角色> x y` | 视线跟随（眼珠/头朝向) | `look 小夏 [0.3 0.7]` |
| `camera { ... }` | 相机运动 | `camera { zoom: 1.05; pan: [0.2 0] }` |
| `action <角色> "<行为名>"` | 嵌套调用入库行为 | `action 小夏 "welcome"` |

### 7.3 时序结构

- **行为块内所有指令一律并行**（叠加执行），无隐式顺序——v0.1 定案：不设 `parallel` 关键字，心智模型只有「块内并行 + `after` 显式延迟串行」。
- 显式串行只由 `after <t> { }` 表达；`after` 可连续出现形成步进。
- `loop: true/false` 整块循环；无显式结束条件时漂移类指令常驻。

### 7.4 动作覆盖与混合（固定动作的参数化调用）

```
play 小夏 "挥手" { speed: 1.2; strength: 0.8 }      // 全局速度/强度缩放
play 小夏 "挥手" { mix: 0.5 }                        // 与当前动作 50% 混合叠加
play 小夏 "挥手" { 局部: { 头转向: 0.5 } }            // 仅某个语义通道 50% 生效（gate）
```
- 覆盖 = **动画层混合**（对已编译曲线做缩放/通道门控），不重新生成资产；所有覆盖**不得越出 sem 范围**（钳制前告警）。
- 覆盖产物仍属于「生成态」，不污染库存固定动作。

**D2 定案｜覆盖混合公式**（决策记录 v0.1 见 14 章）：
- 每动作层 l 在语义通道 p 的曲线 v_l(t)。时间缩放 `t' = t / s`（s>0；s=1 原速）。
- 通道最终值：`V_p(t) = clamp( Σ_l α_l · g_{l,p} · β_l(t) · v_l(t'), min_p, max_p )`
  - `α_l` = strength；`g_{l,p}` = 该层对通道 p 的局部 gate（未指定 =1）；`β_l(t)` = 层入出淡变（默认 attack/release 150ms）。
- 汇聚顺序（对齐 `SPEC-v2.0.md` 10.3 管线）：动作层累加 → 表情层按 Blend → 物理输出 → **override 层（`set` 恒定目标）最高**。
- 最小集（P3 先上）：`speed` + 「最近层胜出」；α/gate/mix 到 P5 全开。

### 7.5 优先级与打断

| 场景 | 规则 |
|---|---|
| 用户插话/新事件 | 高优先级行为可**打断**低优先级（interrupt），打断后可按策略恢复被中断动作 |
| 相同优先级 | 后到者叠加（Add）或排队（队首继续），由调度参数 `overlap: add|queue|replace` 决定 |
| 常驻层 | idle/呼吸/眨眼作为**低优先级常驻**，永不相互打断，被高层动作覆盖时间片 |

### 7.6 事件与触发

事件源（首版）：`idle`（默认常驻）、`user_enter`、`user_text`、`user_voice`、`user_click <slot>`、`timed Cron`、`动作结束 <资产>`、`自定义事件`（来自上层应用）。`on:` 支持事件 + `guard:` 条件。
- `guard` 语法（首版）：`guard: <角色>.<状态名>`（角色运行时状态，如 `小夏.idle`），或 `guard: <角色>.<语义名> in [a b]`（语义区间，如 `小夏.害羞 in [0.5 1]`）；多条件用逗号取「与」。

### 7.7 多角色寻址

- 所有原语第一个参数为角色寻址：`<角色名>`（scene 内 slot）或 `all`（对全场）。
- scene 追加角色 = `cast` 新实例，行为脚本在编译期做角色解析，缺失角色 = 校验错误。

### 7.8 Directive IR(JSON)（语言 B 执行形态 = 驱动 function schema）

```json
{
  "op": "series",
  "steps": [
    { "op": "parallel", "steps": [
      { "op": "play",   "target": "小夏", "asset": "挥手",
        "overrides": { "speed": 1.2, "strength": 0.8 } },
      { "op": "face",   "target": "小夏", "expression": "开心" },
      { "op": "outfit", "target": "小夏", "outfit": "连衣裙组" },
      { "op": "speak",  "target": "小夏", "text": "你好呀，欢迎回来！" }
    ]},
    { "op": "wait", "ms": 400 },
    { "op": "play", "target": "小夏", "asset": "点头" }
  ]
}
```
- IR 是**唯一执行形态**：behavior.ldsl 编译成 IR；LLM 驱动模式直接输出 IR（function calling schema 即 IR 的 JSON Schema 化）。两条来源在调度器处汇合，符合 P5。
- IR 节点集合 = 7.2 原语 + 容器节点（`series / parallel / wait / loop`）。**正文无 `parallel` 关键字**：行为块的并行语义由编译器生成 `parallel` 节点，IR 保留它作为执行形态。

---

## 8. 运行时

### 8.1 架构
- 调度器（`packages/driver`，新增）：消费 IR → 实例化到播放层（overlay 栈）→ 逐帧求值 → 写入参数求值管线。
- 求值管线沿用 `SPEC-v2.0.md` 10.3：**动作曲线 → 表情(Add/Multiply/Overwrite) → 物理输出 → 用户 override（最高）**。DSL 驱动的 `set/sem` 写 override 层（最高优先），动作曲线走动作层。
- 渲染：自研渲染器（编辑/干跑）与 Cubism SDK（预览）双预览复用同一求值公式。

### 8.2 时间轴调度器
- 播放层模型：每实例一层「常驻层 + 若干动作层」，动作层按优先级叠放；并行指令 = 依次建层，系列指令 = 等待前一组完成。
- rAF 驱动；覆盖（override）在编译期解析到目标层；loop 由行为块控制。
- 相干性：所有层的输出最终合并到**角色参数域**一次写管线，避免同一参数多写冲突（对齐 10.3 唯一实现）。

### 8.3 语音与口型（D4 定案）
- TTS provider 接口：`TextToSpeechProvider { synthesize(text, opts): {audio, duration, lang} }`；实现可插拔：
  | 实现 | 内容路由 | 说明 |
  |---|---|---|
  | `Edge` | 仅全年龄内容 | 在线、免费、自然度高 |
  | `LocalSAPI` | 成人内容（**v0.1 默认起步**） | Windows SAPI，离线零依赖 |
  | `LocalNeural` | 成人内容（可选升级） | F5-TTS / sherpa-onnx，离线高质量 |
- **内容路由**：`speak` 文本过平台内容分类器 → adult 强制走本地实现（规避成人文本外发云端）；全年龄默认 Edge；用户偏好可覆盖。
- 口型：LipSync 组（`PARAM_MOUTH_OPEN_Y`，对齐 standard-params groups）简谐信号 + 音频 RMS 音量包络；时长取 `synthesize` 返回值对齐调度器 wait。
- 无可用 TTS：降级为口型简谐 + 预设时长，不阻塞行为。
- 深度口型同步仍为**非目标**；`motions` 自带 `sound` 字段沿用 .l2dp v0.2 支持。

### 8.4 失败与回退（D5 安全定案，见 14 章）
- **规模上限**：单事件 IR 节点 ≤64、嵌套深度 ≤8、单行为总时长 ≤120s（可配）。
- **频率兜底**：同角色指令节流 ≥300ms；LLM 驱动调用冷却 ≥800ms/角色；同一事件 5s 内不重复触发同一 `behavior`。
- **非法 IR 拒绝**：未过校验的 IR → **整次拒绝**，回退常驻行为（内置呼吸/眨眼），错误以人类可读形式记录（不注入渲染）。
- **运行异常回退**：求值抛错/超范围 → 该层终止并回退常驻层；NaN/Inf 由干跑规则（10 章）前置拦截。
- **审计**：驱动决策与 `speak` 文本写入 audit_log（对齐 `SPEC-v2.0.md` 13 章）。

---

## 9. LLM 通道

### 9.1 通道定位
本 DSL 的 LLM 通道是**决策/创作通道**，与内容生成（素材工厂）分离：不调用 ComfyUI、不参与生成任务路由、不接触成人生成链路。平台内容底线对「speak 文本内容」经与生成链路同源的内容校验器（复用 adult 判定/关键词策略）生效；驱动通道本身无生成路由，不做成人素材分发。

### 9.2 Provider 抽象（云 + 本地统一）
```
interface RuntimeProvider {
  createCompletion(req: ChatRequest, opts): Promise<ChatResult>
  // tools 模式：提供 function schema（驱动 IR）→ 约束输出
  // 文本 模式：供创作模式 few-shot 生成语言 A 源
}
```
| 实现 | 用途 |
|---|---|
| `OpenAICompat` | DeepSeek / GPT / Claude（OpenAI-兼容端点） |
| `Ollama` | 本地模型（Llama/Qwen 等）；本地模型输出稳定性弱 → 更强校验兜底 |
| `Mock` | 开发/测试确定性输出 |

选择策略由应用层注入（非 URL 写死）；两实现共用同一 function schema 与提示模板，保证行为一致。

### 9.3 创作模式（生成语言 A）
流程（D-Agent，一次性工具编排）：
1. 用户/LLM 目标 → 加载角色 manifest（词表）与 few-shot 模板
2. LLM 输出 `.ldsl` 文本 → 解析器 → 校验器
3. **错误回传自修复循环**：校验错误（带行列号 + 命中规则）喂回 LLM，最多 3 轮，仍不过则产出「错误报告」而非半成品
4. 通过 → 编译器 → 干跑预览（自研渲染器零帧/快速预览）→ 人工/自动确认
5. 确认 → 写入工程 / 固化入库（资产生命周期 11 章）
- 提示模板构成：词表摘要 + 2~3 个语法示例 + 当前任务描述 + 输出约束（http:// 一律禁止、只许引用 manifest 内名字）。

### 9.4 驱动模式（function calling）
- 工具 schema = Directive IR 的 JSON Schema 化（7.8 的节点集合）。
- 一次决策 = 一次 tool call：应用把「场景上下文 + 最近事件 + 角色可用资产目录」作为 system + user 输入，LLM 输出 IR。
- 「可用资产目录」由 `library` 索引（5.1 / 12 章）实时生成，避免 LLM 凭空造资产名。
- 实时性保障：**两跳架构（F8 定案）**——第一跳（<50ms）：本地规则引擎 + 缓存化行为选择（事件 → 最高优先级已登记 `behavior` 直接出 IR）；第二跳（异步增强，不阻塞）：LLM 决策（意图 → `kinds` 检索动作库选资产 + 参数填充）。仅危险动作（自定义重写/非常规覆盖）等待 LLM 结果。关键帧/插值/混合全交调度器；上游产物全部可离线预编译。

### 9.5 意图 → 行为选择
- 意图可直达基础原语（LLM 直接给出 play/set），也可引用入库行为（`action`）做复合行为。
- 行为选择规则在调度器：相同触发下按 `priority` 降序；随机/权重选择（`weight` 字段）作为可选扩展。

---

## 10. 校验器（编译/执行前置门槛，P0 必做）

| 层 | 规则 | 错误示例 |
|---|---|---|
| 语法 | 可解析、无悬空块、键值合法 | 缺 `}` / track 无关键帧 |
| 语义(范围参考) | 引用的 `sem / layer / outfit / motion / expression / behavior / cast` 必须存在于 manifest / 已见资产 | `track 尾巴`（无此 sem） |
| 命名 | 文本中不得出现裸 `PARAM_*` / `PARTS_*`（除非 manifest 映射区）；编译后官方 ID 必须过标准白名单 | `track PARAM_ANGLE_X` → 语法错误 |
| 范围钳制 | track/set 值必须落在 sem 范围；首版=硬校验失败；钳制（clamp）仅作为显式选项 | `sem 眼开合 = 1.5` |
| 曲线 | 时间点严格单调、关键帧 ≥2、duration>0、easing 名在白名单 | `{ 300: 1; 150: 0.2 }` |
| 引用 | source 存在、outfit group 有对应部件、play 资产在动作库 | `play "不存在的挥手"` |
| 干跑 | 编译产物在自研求值器上可安全求值（无 NaN/越界） | 除零/NaN 曲线 |

- 校验器由 `packages/dsl` 实现，输入 `.ldsl` + manifest，输出 `{ok, issues:[{path,line,col,rule,message}]}`；该结构直接回传 LLM 自修复。
- 校验器同时服务人工编辑（编辑器内实时红线下划线）与 LLM 通道（同一套规则）。

---

## 11. 动作资产生命周期

```
生成(LLM/编辑器) → 校验 → 编译 → 干跑预览 ──失败→ 回修(LLM自修复/人工)
                                      └──通过→ 固化入库(固定态) → library 索引登记
使用：固定调用 play <资产>{override}     ──叠加混合，不污染库存
     直接生成（IR 现场编译）          ──可一键固化 → 转固定态
```
| 状态 | 定义 | 存于 |
|---|---|---|
| 生成态 | 现场编译、不落库、可覆盖可固化 | 会话/内存 + 可选补丁 |
| 固定态 | 已校验、已命名、已索引 | 工程 motions/expressions + library.ldsl |

固化门槛 = 10 章全套校验 + 干跑通过。固定态资产可被后续任意行为 `play`，并可被 LLM 驱动模式直接引用（9.4 目录）。

---

## 12. 参考词表（默认实验对象，模型无关性的落地）

| 词表 | 来源 | 说明 |
|---|---|---|
| sem 语义参数 | `specs/standard-params.json`（官方 32 基线）+ `packages/l2dp/src/params.ts`（运行时全集 32+扩展） | 参考 manifest 把常见动作维度映射为 sem（5.2 示例） |
| body 部件名 | `specs/parts-naming.json`（body 白名单） | 身体层 layer 的 parts 引用白名单 |
| clothing 服装组 | `specs/parts-naming.json`（outfit_* 模板） | 换装位按 costumeGroup |
| motions/expressions | Haru 官方样例结构（`haru_ja/runtime`） | 编译目标对齐基准 |
| 求值管线 | `SPEC-v2.0.md` 10.3 | 驱动汇入点 |

「语言是词典，模型是词表」：DSL 正文永远只说 sem/layer/outfit/资产名；新模型导入时系统对照标准词表生成 manifest，未覆盖的 sem 自动隐藏。默认实验对象 = 标准词表 + Haru 部件集，不依赖具体模型素材即可全链路 dry-run。

### 12.1 manifest 机器可读缓存与语义粒度（F7 / D1 定案）
- `character.ldsl` 在编译期产出**不可变 manifest JSON** 缓存于工程（`<role>.manifest.json`）：sem 定义（名/范围/映射官方 ID）、layer/bone/outfit、资产索引（motion/expression/behavior + kinds）。运行时（校验器、调度器、LLM 驱动模式资产目录）一律消费该缓存，不反复解析脚本（对齐 9.4）。
- **语义粒度定案：共享核心词表 + 模型扩展**。核心词表（平台内置、跨模型统一，情绪/状态维度）映射标准参数白名单，任何具备对应底层参数的模型直接可用；模型特有维度在 `character.ldsl` 追加（不得与核心词表重名，见 5.2 规则）。新导入模型对照核心词表生成 manifest，缺失底层参数的 sem 自动隐藏——引用它们的动画 **跳过而非报错**（可配置为告警）。「装置级动画跨模型复用」是否放行记为遗留（14.2）。

---

## 13. 实现路线图（agent 按序执行）

| 阶段 | 内容 | 落点 | DoD |
|---|---|---|---|
| P0 | ✅ 解析器 + AST + 语法校验（character/motion/expression），携带 DSL 语法版本号（semver） | `packages/dsl/src/parse.ts` | 5.6 BNF 用例全过；错误带行列号；版本号随产物写入 |
| P1 | ✅ 编译器：motion→motion3、expression→exp3、character→manifest JSON 缓存（含 meta 段/点统计、curve 参数化、scene 基本块） | `packages/dsl/src/compile.ts` | Haru Segments 结构对照同构 + 全文件统计 ±8；manifest 缓存含 assetIndex 可消费；测试 43 例全绿 |
| P2 | 校验器全套（10 章）+ 干跑求值 | `packages/dsl/src/validate.ts` | 7 类规则用例；错误结构可回传 |
| P3 | 语言 B：behavior 解析 → Directive IR；调度器（覆盖最小集：speed + 最近层胜出）| `packages/driver` | IR 在自研渲染器里驱动 Haru 示例跑通；`speak` 走 LocalSAPI |
| P4 | LLM 创作通道：few-shot 模板 + 自修复循环 | `packages/dsl-agent` | 3 轮内修出合法运动文件 |
| P5 | LLM 驱动通道：function schema + provider 抽象(云/Ollama) + 两跳 | `packages/driver` + `packages/runtime-provider` | 第一跳决策 <50ms；LLM 异步增强不阻塞主链路 |
| P6 | 语义层完善：核心词表 manifest 生成器 + library 索引 + scene 舞台 + TTS `LocalNeural` 可选 | 各包 | 换装/多角色/相机场景端到端 |

优先级：P0–P2 纯工具链不依赖模型素材（用户当前需求「先做规则」的直接落点）；P3 用官方示例 dry-run；P4/P5 在前者稳定后接入。

---

## 14. 设计决策记录 v0.1（本次评审定案）

> 记录 F1–F8 修订与 D1–D6 定案，是决策的单一真相；后续实现以本章为准。

### 14.1 定案表

| # | 主题 | 定案内容 |
|---|---|---|
| F1 | 硬约束 #2 执行边界 | 映射区 = `sem ... -> { PARAM_* }` 块右侧；其余上下文出现官方 ID 即编译错误（0 章已修订） |
| F2 | 错误/回退语义 | 落地为 8.4（含 D5 安全四层） |
| F3 | 示例悬空引用 | 5.2 补 `臂左上 / 臂右上` sem；5.3 `track 手臂左` → `臂左上` |
| F4 | 示例资产自洽 | 新增 5.1.1 `library.ldsl`；7.1 示例注明固定资产须入库 |
| F5 | BNF 与示例一致 | 5.6 track 时间写法统一为 `num ':' value` |
| F6 | set/sem 重复 | 合并：`set` 为唯一参数写入原语，删除 `sem` |
| F7 | manifest 机器可读 | 12.1 编译期缓存 `<role>.manifest.json`，运行时与 LLM 目录消费缓存 |
| F8 | P5 延迟冲突 | 9.4 两跳架构：第一跳 <50ms 本地规则，LLM 异步增强不阻塞 |
| D1 | 语义参数覆盖粒度 | 共享核心词表 + 模型扩展；缺参 sem 隐藏且引用动画跳过（12.1） |
| D2 | `play` 覆盖混合公式 | 7.4 公式 `V_p = clamp(Σ α·g·β·v, min, max)`；P3 上最小集（speed + 最近层胜出） |
| D3 | `drift` 随机过程 | 带种子 AR(1) 可重现；P3 先正弦 + 噪声 |
| D4 | TTS / 口型 | 接口 + Edge(全年龄) / **LocalSAPI(成人，v0.1 起步)** / LocalNeural(可选)；口型简谐 + 音量包络（8.3） |
| D5 | 驱动安全 | 规模 / 频率 / 拒绝回退 / 数值 四层（8.4） |
| D6 | LLM 通道解耦 | 独立于生成队列；独立配额 + 审计（9 章） |

### 14.2 遗留（未定案，进入对应 P 阶段再议）

1. **装置级动画跨模型复用**：是否允许「挂在任意模型上的附加动作资产」跨模型生效——倾向允许（核心词表本就共享），P1 前定边界。
2. **manifest JSON 字段级 schema**：12.1 缓存的具体 JSON 结构随 P1 编译器落定。
3. **`look` 视线映射比例**：PARAM_EYE_BALL_X/Y 与头转角的分配，P6 验收前定。
4. **library 资产权重/随机选择**（多候选按权重出动作）——P6 可选。

---

## 15. 与现有资产对照表（衔接清单）

| 现有资产 | 本规范依赖点 |
|---|---|
| `specs/standard-params.json` | sem 语义映射目标、范围默认值来源 |
| `specs/parts-naming.json` | layer/outfit 部件引用白名单 |
| `packages/l2dp`（types/validate/params/naming） | 编译产物类型与校验复用 |
| `.l2dp v0.2`（SPEC 6.2） | 编译补丁目标格式 |
| `specs/haru模型对照分析.md` | 编译对齐基准、参考词表实证 |
| `SPEC-v2.0.md` 10.3 求值管线 | 驱动汇入点（本章对齐） |
| `haru_ja/runtime`（官方示例，非公开测试用途） | P0–P3 干跑 fixture |

> 本章确认：本规范不新增第二套资产格式，所有产物落回 `.l2dp` 与官方 JSON；不触碰 moc3 二进制边界。
</think>
# l2d-rules 最终优化建议 · 落地计划

> 来源：两轮源码审查（第一轮：全局盘面；第二轮：代码级验证）+ 3 个运行时实测。
> 本文档是唯一执行依据：按 P0 → P1 → P2 顺序逐项落地，每项含 问题 / 证据 / 落点 / 方案 / DoD。
> 纪律不变：确定性、零平台依赖、内容中立、TS strict + 仅可擦除语法；每阶段 `npm run verify` 全绿。

---

## 优先级总览

| 级 | 项 | 一句话 | 状态 |
|---|---|---|---|
| P0 | P0-1 | native 结构化输出链路断裂（strict 白开 + 整批 skipped） | 【x 已完成】 |
| P0 | P0-2 | camera 载荷无法表达 + SceneStage 无相机动画 | 【x 已完成】 |
| P1 | P1-1 | RuleReviewer 注释承诺三态、实现只验 rest | 【x 已完成】 |
| P1 | P1-2 | 评估集扩容（creation 反面+换装；drive native/camera/outfit） | 【x 已完成】 |
| P1 | P1-3 | MCP 工具清单只覆盖 5/12 op | 【x 已完成】 |
| P1 | P1-4 | 降级口型恒 A，未接入既有 ZH_FINAL_VISEME 拼音表 | 【x 已完成】 |
| P1 | P1-5 | resolveSchedule `+<id>` 依赖"结束"用 dur 而非实际时长 | 【x 已完成】 |
| P2 | P2-1 | SpeakPipeline 默认说话闭环（text→TTS→viseme→口型+prosody） | 【 】 |
| P2 | P2-2 | LLM 决策状态注入（当前参数/目录/服装组/最近指令） | 【 】 |
| P2 | P2-3 | outfit 默认解析器 OutfitResolver（语义服装名→组→set 行） | 【 】 |
| P2 | P2-4 | host op 能力状态查询 listWiredOps + 未接线显式提示 | 【 】 |
| P2 | P2-5 | Quickstart 指南（一条命令起 demo + 可复制 JSONL） | 【 】 |
| P2 | P2-6 | 规则变更审计 + 评估报告产物化 | 【 】 |

---

## P0 · 已验证的行为缺陷（先修）

### P0-1 native 结构化输出链路断裂
- **问题**：`OpenAIProvider` 默认开 strict `response_format`（schema=`directiveStreamSchema`，产出 `{v,target,directives[]}` 对象流），但 `DriverEngine.dispatch` 第二跳只消费 `result.text`，`structured` 字段被丢弃；再走 `extractJsonLines` 逐行解析对象流失败。
- **实测**：`{"v":2,"directives":[...]}` → `extractJsonLines` 抽出 1 行 → `opShapeIssues` 报 `OP: unknown op 'undefined'` → 整批被 `feedLine` 判坏行跳过。且 `createCompletion` 对非 JSON content 直接 throw（不降级）。
- **落点**：`packages/driver/src/twohop/engine.ts`、`provider/openai.ts`、`provider/fallback.ts`
- **方案**：
  1. 第二跳优先解析 `result.structured`：若为 `DirectiveStream` 对象，把 `directives` 拆成逐行 JSON 喂 `feedLine`（保留 target/offlines 语义，离线走 feedBatch）。
  2. `text` 提取（`extractJsonLines`）仅作 `text/grammar` 档降级。
  3. `createCompletion` 内 `JSON.parse(content)` 加 try/catch → 失败降级 `{ text: content }` 返回，不抛。
- **DoD**：
  - 新增单测「structured 输出全部生效（hop=2, 参数轨迹断言）」；
  - 「坏 JSON → 返回 text 不抛」；
  - 「text 档仍走 fallback 提取」；
  - eval 双门禁保持全绿。

### P0-2 camera 载荷无法表达 + 相机动画
- **问题**：规格承诺 `camera` 携带 `zoom/pan`、允许 `at/dur`。实测 `OP_RULES.camera = {required:[], allowed:[]}` 且 `zoom/pan` 不在 `PAYLOAD_FIELDS` → `{"op":"camera","zoom":1.5}` 校验通过但 `zoom` 被静默丢弃；`SceneStage` 只有静态相机。
- **落点**：`packages/driver/src/ir/types.ts`、`validate/rules.ts`、`ir/schema.ts`、`packages/engine/src/scene/stage.ts`
- **方案**：
  1. `PAYLOAD_FIELDS` 增加 `zoom`/`pan`（pan 为 `[x,y]`），`OP_RULES.camera.allowed = ["zoom","pan"]`，`PAYLOAD_SCHEMA` 补齐。
  2. `SceneStage` 增加相机状态查询 + 缓动：`setCamera`、`panTo(x,y,ms,clock)`、`zoomTo(z,ms,clock)`，保持确定性（注入时间源）。
- **DoD**：
  - 带 `zoom`/`pan` 的 camera 行过校验且不被路由丢弃；
  - stage 相机插值两帧可确定性断言；
  - schema.test 等价断言更新后全绿。

---

## P1 · 契约与覆盖补齐

### P1-1 RuleReviewer 注释-实现漂移
- **问题**：`packages/create/src/review.ts` 头注释承诺"rest/blink/smile 三态"，实现只渲染 `rest` 一帧。
- **方案**：实现三帧质检（rest/blink/smile 各自覆盖率/色彩/上下分布检查），保持确定性。
- **DoD**：新增「闭眼帧异常可被检出」「三帧颜色分离正常通过」用例；现有规则审核用例不回归。

### P1-2 评估集扩容
- **现状**：`creation-cases` 仅 3 例且断言只到 coverage/partCount；`drive-cases` 有 `voice-listen` 空断言（`expectedSemEffect:[]`）；换装语义零覆盖。
- **方案**：
  - creation 扩到 ≥8：坏切图（覆盖/重叠违规→修复后通过）、非法绑定（缺参数挂接→修复）、**outfit 服装组切换像素断言**、多轮自修复截断；
  - drive 去掉空断言，增加 native 结构化输出链路、camera、outfit、speak 降级四类用例。
- **DoD**：`npm run eval` 双门禁全绿且覆盖新类别；report 落盘。

### P1-3 MCP 工具清单补全
- **现状**：`driverToolCatalog` 只暴露 play/face/set/look/speak + emit_directives + get_state，outfit/camera/action/emote/blink/drift/wait 无细粒度工具。
- **方案**：`mcp.ts` 的 `OP_TOOL_DESC` 补全 12 op（全部从 perOpSchema 同源生成）。
- **DoD**：工具清单覆盖 12 op；lint（O-3）无游离键；单测断言数量与 op 数一致。

### P1-4 降级口型接入拼音表
- **问题**：`ZH_FINAL_VISEME`（拼音韵母→视素表）已建，但无 TTS 降级 `estimateSpeechTimeline` 只输出恒 `A` 视素（无拼音输入来源）。
- **方案**：新增可选入参（拼音/音素分段 `[{syl,tMs}]`）→ 经 `phonemeToViseme` 出真实视素轨迹；缺省沿用音节级降级（向后兼容）。
- **DoD**：传拼音分段时产生非 `A` 视素；不传时行为不变；tts 测试新增 2 用例。

### P1-5 resolveSchedule `+<id>` 结束依赖修正
- **问题**：`batch.ts` `resolveSchedule` 中 `end = start + (d.dur ?? 0)`，被依赖为 play 时 `dur` 缺省 0 → 依赖的"结束"实为"开始"。
- **方案**：被依赖 play 用其 `durationMs` 计算结束；`idTimes` 在排程后回填实际时长。
- **DoD**：离线 `+<id>` 依赖 play 结束的用例时序正确（新增 1 用例）。

---

## P2 · 能力升维

| # | 建议 | 落点 | 价值 |
|---|---|---|---|
| P2-1 | **SpeakPipeline**：`text→TTS→viseme 指令→口型参数`，prosody 接环境层调制，无 TTS 走降级 | 新建 `driver/speak.ts` + HostOp 挂钩 | 兑现"融合分工"卖点，宿主免重复造 |
| P2-2 | **LLM 状态注入**：当前参数/可用资产目录/服装组/最近 N 条指令进第二跳 prompt | `twohop/engine.ts` | 多轮连续性与准确性 |
| P2-3 | **OutfitResolver**：语义服装名→服装组→可见性 set 行 + 状态维护 | 新建 `driver/outfit.ts`（复用 outfitLines） | 换装 op 开箱即用 |
| P2-4 | **host op 能力状态查询** `listWiredOps()` + 未接线显式日志 | `stream/ingestor.ts` | 联调可观测性 |
| P2-5 | **Quickstart 指南**：一条命令起 demo + 可复制 JSONL | `docs/QUICKSTART-DRIVE.md` | 新用户 5 分钟跑通 |
| P2-6 | **规则变更审计**：新增 op 强制同步词典/规定/schema/lint；评估报告产物化（含 commit） | `scripts/lint-rules.mjs` + eval 脚本 | 可追溯防回归 |

---

## 不做清单（守住边界）

- 不碰：ComfyUI 编排、装配台 UI、存储/上传、TTS 具体引擎、内容分级判断。
- 不重造：SAM2/LoRA/超分等上游能力属宿主 ComfyUI，SDK 只做 REST 调用契约。
- 不引入：enum/namespace、平台依赖进核心包。

---

## 验收总览（每项必须满足）

1. `npm run verify`（typecheck 全绿 + 包测试全绿 + eval 6/6+3/3 + lint 全一致）通过。
2. 确定性回归：同（模型/流/seed/时钟）→ 轨迹/像素逐帧一致。
3. 零平台依赖不破；词表单一来源不破。
4. 每项合入更新本文档状态勾选 + 变更记录。

### 变更记录

| 日期 | 变更 |
|---|---|
| （当前轮） | P0-1/P0-2 + P1-1…P1-5 全部落地；顺带修复 demo-capabilities 的 `node:url dirname` 预存 bug 与沙箱下管道捕获问题。实测 :typecheck 全绿 + 268 测试全绿（+14 新增）+ eval drive 9/9（+3）+ creation 4/4（+1）+ lint 全一致。 |
| （未做） | P2-1…P2-6 待启（能力升维，非缺陷；见文中各子项 DoD）。 |

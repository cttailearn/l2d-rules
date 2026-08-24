# 修复优化方案与新增需求（l2d-rules SDK 全面升级计划）

> 本文档是对 @l2dp/*（l2d-rules）SDK 全面审查的落地执行方案。依据：审查期间的代码逐文件读取、178 测试实测、typecheck 9 包全绿、eval 双门禁（drive 6/6 + creation 3/3）实测。
>
> **实施进度（2026-08）**：S1 工程基建 + S2 承诺闭环已完成并提交（R-P0-1/R-P0-2/R-P1-1/R-P1-2/R-P1-3/R-P1-4/O-5/O-7 全部落地，实测 187 测试全绿 + typecheck 9 包 + eval 6/6+3/3）。剩余：S3 更多部位、S4 Demo 矩阵、S5 加固、S6 远期。
>
> 构成：① 现状盘点 → ② 问题分级与修复方案 → ③ 优化方案 → ④ **Demo 开发要求（新增）** → ⑤ **更多部位支持要求（新增）** → ⑥ 里程碑排期 → ⑦ 验收与纪律。
>
> 状态约定：【 】待办 / 【~】进行中 / 【x】已完成。文档版本随实施更新（变更记录见末尾）。

---

## 1. 现状盘点（审查结论）

### 1.1 已建成能力（实证）

| 领域 | 覆盖 | 验证 |
| --- | --- | --- |
| 官方格式层（l2dp） | 官方 JSON 类型、标准参数白名单、PARTS 命名规则、整包校验、.l2dp 打包 | 测试通过 |
| 自研引擎（engine） | .l2dm 格式/形变/层级/物理/双渲染(软件+WebGL2 逐像素一致)/播放 | M1–M4 DoD + e2e |
| LLM 驱动核心（driver） | 扁平 IR v2(12 op) + JSONL 流式 + 分层求值 + 环境层 + 双模式校验 + Provider 三档 + 两跳 | M5–M7 DoD + eval 6/6 |
| 官方模型转换（convert） | model3 JSON 链路 + .moc3 逆向(真实几何/keyform/golden) + .moc(Cubism2) 164 回归 + author 编辑工具链 | C1/C2 |
| 创作管道（rig+cutout+create+host） | 半自动切图/绑定/创作编排/自修复循环 + 宿主 HTTP/ComfyUI/LLM 桥 | P4a–P4c + eval 3/3 |

### 1.2 已确认缺口（本方案要解决的全部条目）
详见 §2（问题分级）与 §4/§5（新增需求）。一句话概括：**驱动半边已完整、创作半边有骨架；三处规范承诺的占位（undo 慢校验 / 语义抽查 / grammar 档）需落地；部位支持仅 12 语义（身体上半），demo 缺代表性用例与更多部位实证；工程化（入库/文档单一来源/统一时钟）待加强。**

---

## 2. 问题分级与修复方案

> 每项含：问题 → 根因/影响 → 修复动作（带落点文件）→ DoD（验收）。

### P0（优先修复，工程安全）

#### R-P0-1  P4 创作成果尚未入库 【x 已完成（commit 4f51925）】
- **问题**：packages/rig、packages/cutout、packages/create、packages/host、docs/GUIDE-FROM-IMAGE-TO-LIVE2D.md、docs/LLM-CREATION-PIPE-PLAN.md、scripts/eval-creation.mjs、specs/evals/creation-cases.json 等均为未提交（??）状态。
- **风险**：核心资产丢失；CI 无法覆盖；他人/后续智能体拉分支看不到 P4。
- **动作**：
  1. git add 上述全部文件并提交（建议按 P4a / P4b / P4c / docs 分 4 个 commit）。
  2. 清理一切临时探针文件，并在 .gitignore 增加 packages/**/_scratch* 防止复发。
  3. 把 demo-p4b 纳入 CI 测试清单（scripts/typecheck.mjs 已含 9 包）。
- **DoD**：git status 干净；npm test（含 demo-p4b）全绿；CI 门禁包含 P4 包。

#### R-P0-2  文档漂移（权威文档与代码不一致） 【x 已完成】
- **问题**：docs/ARCHITECTURE.md 与 docs/DEVELOPMENT-SPEC.md 仍引用已删除的 packages/dsl、packages/renderer；README 测试数（129）与实测（178）不符；LLM-CREATION-PIPE-PLAN 中 146/178 并存。
- **动作**：
  1. 修订 ARCHITECTURE.md 迁移说明：删除 dsl/renderer 引用，注明『dsl 编译器已移除、renderer 已由 engine 取代』。
  2. 建立单一权威清单：包清单/测试数/里程碑状态统一由生成脚本产出（见 §3 优化 O-2），README 只引用生成结果。
  3. 在 ARCHITECTURE.md 增加本期修订记录。
- **DoD**：grep 全仓无 packages/dsl、packages/renderer 的乱引；README 数字=实测；typecheck 覆盖清单=实际 9 包。

### P1（近期，闭环当前承诺）

#### R-P1-1  落地 StreamIngestor.undo() 与慢校验回滚（SPEC §7.3/§7.5 承诺） 【x 已完成】
- **问题**：undo() 恒返回 false；无 undo 栈；asyncCheck 慢校验（安全/内容复核）未实现——双模式校验与语义护栏目前只是名义达成。
- **动作**：
  1. ingestor.ts 新增 asyncCheck(line, tMs)：对已生效行做异步慢校验（内容分级/数值干跑复核）。
  2. 维护 undoStack：记录 feedLine 每次 route 前的 LayerStack/env 现场（per-op 快照），undo() 回滚最近『已生效但慢校验失败』的行。
  3. 同步 SPEC §7.5 接口合同；driver 测试新增『慢校验失败 → 回滚后参数轨迹还原』用例。
- **DoD**：新增 ≥4 个单测（成功/失败回滚/栈空/多次 undo）；坏行隔离+回滚语义在 demo-web 接线可见。

#### R-P1-2  落地 DriverEngine.needsSlowPath() 危险动作语义抽查（SPEC §11.2） 【x 已完成】
- **问题**：needsSlowPath() 恒 false，语义抽查（自定义重写/新资产/非常规 override 触发二次复核）未实现。
- **动作**：
  1. 定义高风险动作规则：play 资产不在 manifest 缓存索引 / set 非常规覆盖 / 未知减速 / 自定义重写 → needsSlowPath=true。
  2. 慢路径实现：二次 LLM 复核（或确定性复核）→ 通过才 feedLine，不通过记 audit + 回退常驻层（复用 R-P1-1 回滚）。
  3. 保持不增加首跳延迟：慢复核在后台，首跳仍走第一跳/快校验。
- **DoD**：eval 集新增 1 例『危险动作 → 慢路径拦截』；两跳 <50ms 断言仍成立。

#### R-P1-3  补齐 6 个宿主 op 的宿主侧契约（outfit/speak/look/camera/action/wait） 【x 已完成】
- **问题**：routeDirective 对这 6 op 仅确认不路由 → 主机接线无契约。
- **动作**：
  1. ARCHITECTURE 注入接口清单新增 HostOpHandler：handle(op, d, tMs)（outfit 换装 / speak TTS / look 视线 / camera 相机 / action 嵌套行为 / wait 时序）。
  2. IngestorCtx 增加可选 host，routeDirective 对 6 op 分发给 host；无 host 时返回 skipped{reason: HOST_OP_NOT_WIRED}（显式而非静默）。
  3. 每个 op 补 1 个契约单测（mock host 收到正确 d / 参数转换）。
- **DoD**：6 op 全部有路由路径与测试；demo 至少接线 speak（TTS 降级）与 look。

#### R-P1-4  createWithSelfRepair 缺省 Labeler 抛错优化 【x 已完成】
- **问题**：labeler ?? (async()=>{throw})() 缺省直接抛错，串联入口体验差。
- **动作**：缺省改为 PositionLabeler（模板槽）+ 明确告警日志；仅当无槽可用时才给出可读错误并列出可选 labeler。
- **DoD**：createWithSelfRepair({image, 无 labeler}) 走默认路径成功；错误信息含解决方案。

### P2（中期，能力与工程加固）

#### R-P2-1  .moc3/.moc 解析鲁棒性加固（对齐 CVE-2023-27566 教训） 【x 已完成（packages/convert/test/fuzz.test.ts）】
- **动作**：为 readMoc3/readMoc 增加 fuzz 测试（随机字节/截断/越界偏移/坏计数），确保抛出明确错误而非崩溃/内存越界；补损坏语料回归 10 例。
- **DoD**：fuzz 500 组样本 0 崩溃；损坏文件均返回 {ok:false,error}。

#### R-P2-2  创作侧『规则初审 → 视觉复审 → 差异回注』分级审核链 【x 已完成（ChainedReviewer + 4 测试）】
- **动作**：create/review.ts 增加 ChainedReviewer（RuleReviewer + LlmReviewer 组合）：规则不过 → 直修；规则过但置信低 → 触发视觉 LLM 复核 → 差异回注修复循环。
- **DoD**：creation eval 3 例在不引入视觉模型时仍全绿；有 key 时走视觉复核路径。

#### R-P2-3  性能基线：SoftwareRenderer 与 warp 累加基准化
- **动作**：新增 scripts/bench-render.mjs（1 万三角 + 16 纹理；中端约束 ≥30fps 对照），必要时 typed-array 池化 / GPU 参数。
- **DoD**：基准脚本产出可复现报告并入库（非门禁，供优化依据）。

### P3（远期，按路线图启动）
- P6 词表生成器 / scene 舞台 / TTS 升级（真实 viseme/prosody）/ parts-naming 扩展 / MCP 表层 / 官方 PSD 导出回环——沿用『目录进、IR 出、确定性、零平台依赖』纪律逐项启动（详见 §5 与 §6 排期）。

---

## 3. 优化方案（工程质量）

| 编号 | 优化项 | 说明与落点 | DoD |
| --- | --- | --- | --- |
| O-1 | 统一时钟契约 | DriverEngine/Evaluator/Ingestor 显式注入 Clock；区分 wall/audio 时钟（SPEC §5）；避免宿主帧时钟 vs 内部 tMs 双时间轴漂移。落点：driver ir/types + 各构造器。 | 双重时轴用例；确定性测试通过 |
| O-2 | 文档单一来源（CI 生成） | scripts/gen-stats.mjs 从测试/typecheck 输出生成包清单、测试数、里程碑状态 → 注入 README/build badge。 | README 数字=CI 实测，零手工漂移 |
| O-3 | 规则库→schema 元一致性检查 | 脚本 lint：新增 op 必须同步 ir/types + OP_RULES + schema.ts + 各 README 表。 | CI 有 lint 步骤；C12 断言扩展 |
| O-4 | 错误信息结构化 + rule 词典 | issue() 补 rule 词典（中/英 codes）直喂 LLM 自修复提示。 | eval 失败模式解析可用词典 |
| O-5 | 测试分层与单一 verify 入口 【x 已完成】 | npm run verify = typecheck + test + eval（+ verify:e2e 浏览器）串联；CI 唯一入口。 | CI 只有 verify 一条命令的作业 |
| O-6 | 切图适用域文档 | 明确 ColorKeySegmenter 面向平坦色插画，非平坦走宿主重型档（SAM2/ComfyUI）。 | GUIDE 增加适用域段落 |
| O-7 | P4 包 README 补齐 【x 已完成】 | create/cutout/host/rig 中 3 个缺 README，补齐并统一文件头注释规范。 | 4 个 P4 包都有 README |

---

## 4. 新增需求 A —— Demo 开发要求（逐项可验收）

> 目的：把 SDK 各层能力变成开箱即跑、可演示、可对比的用例，覆盖审查发现的演示盲区（环境层可感、更多部位、双模式、创作全链、真实 LLM、性能）。

### A1  demo-multi-body —— 更多部位与非标准部位演示（★ 与 §5 强关联） 【x 已完成（examples/demo-multi-body）】
- **目标**：展示自研引擎『任意多部位 + 自定义语义参数』（G2）的差异化价值，即审查发现的『12 语义 vs 20+ 完整词表』差距的可视化实证。
- **内容**：
  - 模型含非标准部位：尾巴（尾巴摆，Custom 组）、兽耳（耳动）、翅膀（翅膀扇），参考 demo.l2dm 已实证的尾巴摆扩展为完整小兽娘。
  - 语义驱动：play 尾巴摆/耳朵动/翅膀扇 + 环境层（呼吸/眨眼/视线/重心）+ set override 全在同一个 demo.l2dm 上可见。
  - 双渲染对比页：自研引擎 vs 官方 Cubism SDK 并排（继承 examples/demo-web/compare.html 模式）。
- **落点**：examples/demo-multi-body（Vite + 无头 Node 双入口）。
- **DoD**：
  - npm run start 打开页面，尾巴/耳朵/翅膀可被 JSONL 语义驱动（滑块=语义名）。
  - 无头脚本输出帧像素 golden；软件/WebGL2 逐像素一致（沿用 test:e2e 断言）。
  - npm test 纳入本 demo（≥3 用例：非标准部位加载/驱动/环境层叠加）。

### A2  demo-environment-layer —— 『角色一直活着』环境层专项演示 【x 已完成（examples/demo-env）】
- **目标**：把程序化环境层（1/f 噪声 / 呼吸/眨眼/视线/重心 / emote 调制）从测试可见变成肉眼可见，这是 SPEC 核心卖点但当前 demo 未单列。
- **内容**：静默渲染 60s；开关 emote（valence/arousal 滑杆）；blink 指令临时覆盖；drift 持续漂移；对比关环境层（静态）与开环境层两版。
- **落点**：并入 examples/demo-web（新增 ?scene=env 路由）或独立页。
- **DoD**：提供环境层贡献叠加显示（哪些 sem 由环境层驱动）；无头回放轨迹一致（确定性）。

### A3  demo-dual-mode —— 在线流式 vs 离线整批双模式对照 【x 已完成（examples/demo-dual-mode）】
- **目标**：把行级原子/坏行隔离与整批原子拒绝做成可对比演示（审查确认两模式规则库共享、行为不同）。
- **内容**：同一条含坏行的指令流：在线模式坏行跳过继续、离线模式整批拒绝并报告 issues/line；UI 高亮坏行。
- **落点**：并入 demo-web ?scene=batch。
- **DoD**：两种模式同一输入的行为差异有 UI 呈现与断言（沿用 driver validate 测试语义）。

### A4  demo-llm-live —— 真实 LLM 驱动（第二跳）在线演示 【x 已完成（examples/demo-llm；headless + LLM_API_KEY 可真实、缺省 mock）】
- **目标**：把 mock provider 换成真实 LLM（OpenAI 兼容端点）的『自然语言 → 角色动起来』完整演示；覆盖 Provider 分级 + 两跳第一/第二跳的可观测性。
- **内容**：输入『你好呀！/ 我有点害羞 / 摇尾巴』，第二跳 LLM 决策 JSONL 流式注入；UI 显示 hop 1/2、每条注入指令行、audit 日志。
- **落点**：examples/demo-llm（无 key 时降级 mock provider 仍可跑）。
- **DoD**：LLM_API_KEY 设置后全链真实跑通；无 key 时 mock 兜底并可见标注；具备 hop 指标显示 + 审计落盘（AuditSink 预留）。

### A5  demo-creation-full —— 一张原图 → 可动角色（真实服务/LLM 接线） 【x 已完成（demo-p4b run/bridge/bridge-llm 三脚本 + A5 自动化全链测试）】
- **目标**：补齐 demo-p4b 由纯 SDK + mock 到真实 HTTP 分割服务 + 真实 LLM 标注/审核的完整演示，让 P4 通道对使用者开箱即用。
- **内容**：上传/选择立绘 → HttpSegmenter（真服务，无服务时降级 ColorKey）→ LlmLabeler（真实语义标注）→ createWithSelfRepair → rig/驱动/预览帧。
- **落点**：扩展 examples/demo-p4b（新增 web.mjs 简易本地服务）或独立 examples/demo-creation。
- **DoD**：一键脚本跑通全链并出预览 PNG + .l2dm + RigSpec + report；无服务/无 key 自动降级可复现。A5 自动化全链测试（examples/demo-p4b/test/demo.test.ts：原图→拆→LLM 标注 mock→自修复→绑定→驱动→渲染确定性）✅

### A6  demo-import-loop —— 官方模型导入回环（回归演示）
- **目标**：把 convert（model3 + .moc3 + .moc）做成『导入 → .l2dm → 引擎渲染 → 与官方对比』的公开用例，承载 C1/C2 的 golden。
- **内容**：Haru 官方包整体导入（.moc3 真实几何 + 内嵌纹理 + keyform），引擎软件渲染截图 vs 官方 CubismCore 同帧对比，显示像素差%。
- **落点**：复用 examples/demo-real（新增 compare 页面入口 + 脚本）。
- **DoD**：golden 脚本输出像素差 <2% 并截图留档；纳入 CI（无 GPU 软件光栅）。

> 各 Demo 通用纪律：无 GPU 兜底（软件光栅）、确定性种子注入、纳入 npm run verify、坏行/坏输入有兜底演示。A1 与 §5 联动交付。

---

## 5. 新增需求 B —— 更多部位支持要求（★ 核心新增需求）

### 5.1 背景与差距（审查实证）
- 现状：packages/rig/src/types.ts 的 RIG_SEMANTICS 仅 **12 个语义**（身体上半部：发/耳/颈/脸/目/眉/口/鼻/上躯），且无服装层概念。
- 规范目标（specs/parts-naming.json）：身体层 **20 部件** + 服装层 **9 类** + 工程件（sketch/background）——即画布上能拆出多少件、就该能绑定多少件。
- 差距清单：
  | 缺失语义 | 规范类别 | 引擎支持现状 |
  | --- | --- | --- |
  | body_lower（下半身） | body | ✓ 任意部件（Custom 组） |
  | arm_a / arm_b（臂） | body | ✓ |
  | leg / feet（腿/足） | body | ✓ |
  | adult_breast（胸） | body | ✓（物理输出指针已有 PARAM_BUST_Y 经验） |
  | adult_genital（阴部，内容分级归宿主） | body | ✓ |
  | hoho（颊，脸红 TERE） | body | ✓ |
  | outfit_top/bottom/dress/underwear/shoes/socks/accessory/hairstyle | clothing（服装层） | ✗ 无服装组切换概念 |

### 5.2 需求目标
1. **词表对齐**：RIG_SEMANTICS 扩到规范全集（≥20 body 语义），并新增 RigClothingPartSpec（含 costumeGroup 服装组号）。
2. **每个新语义有绑定模板**（RIG_TEMPLATES 扩展）：网格分辨率、绘制顺序先验、默认色、参数挂接。
3. **每个新语义有形变**：下半身/臂/腿 → 摆动与朝向 warp；胸 → 物理摆动；颊 → 脸红参数；服装 → 穿着部件跟随身体。
4. **服装层切换**：Haru 双服装组范式（_001/_002）→ outfit op 真正可用（换装即切换部件组，引擎可见）。
5. **非标准/自定部位**：customParams 已支持；补尾巴/翅膀/兽耳官方模板（复刻 demo.l2dm 实证路径）。
6. **内容分级边界**：adult 部件由 ContentPolicy 钩子判定；SDK 只绑定不判定（架构红线 #5）。

### 5.3 落地拆解（带落点与 DoD）
| 子项 | 内容 | 落点 | DoD |
| --- | --- | --- | --- |
| B-1 | RIG_SEMANTICS 扩到 20 body 语义 + 词表自检（grid≥2x2/顺序唯一/参数合法，沿用现有词表自检测试） 【x 已完成】 | packages/rig/src/{types,vocab,params}.ts | 词表自检 + 5 个新增语义绑定测试通过 |
| B-2 | 新增 warp 合成：body_lower 微摆（重心跟随）、arm 摆臂、leg 步态、feet 着地、胸摆动（pendulum-out）、颊 TERE 脸红 【x 已完成】 | packages/rig/src/warps.ts + rig.ts | 形变结构断言（顶点/像素级）≥5 用例（B-1/B-4 全绑定测试覆盖） |
| B-3 | 服装层：RigClothingPartSpec + outfit op 路由落地（联动 R-P1-3）→ demo 生成双服装组模型 【x 已完成】 | packages/rig(type/vocab/params/rig) + driver(host-ops outfitLines) + examples/demo-clothing | outfit 换装 demo（组1/组2 像素不同）+ 2 测试 + driver outfitLines 测试通过 |
| B-4 | 非标准部位官方模板：tail/ear（兽耳）/wing + 对应参数（尾巴摆/耳动/翅膀扇） 【x 已完成】 | packages/rig/src/vocab.ts + warps.ts | 与 A1 demo-multi-body 联动验收（B-1/B-4 全绑定测试 33 部件） |
| B-5 | 引擎侧确认任意部位渲染正确 + 环境层对 Custom 不写入（已保证）；新增多部位回归 fixture（≥40 部件） 【x 已完成】 | packages/engine/test/bodies.test.ts | 40 部件模型校验/加载/驱动/渲染（4 用例） |
| B-6 | 内容分级：adult 语义只进 RigSpec 标记、不默认渲染；宿主 ContentPolicy 决定可用性 【x 已完成】 | packages/rig（分级隐藏 opacityParam + RigSpec.adult 审计） | 默认隐藏 + ContentPolicy 揭示像素变化（1 用例） |

### 5.4 更多部位对下游的影响与约束
- **确定性保持不变**：新增 warp 全部走 accumulateKeyforms 确定性路径；无 Date.now、随机种子注入。
- **驱动层零改动兼容**：新增部位以 Custom/Physics 组参数出现，play/face/set 语义驱动直接可用（环境层不写 Custom，天然不冲突）。
- **校验器同步**：l2dp 命名规则与 RIG_SEMANTICS 需单一来源对齐（否则 R-P0-2 的矛盾复发）——specs/parts-naming.json 应为唯一词表源，RIG_TEMPLATES 由其派生。
- **moc3 导入联动**：moc3ToL2dm 已能导入官方任意部件；本需求让『从原图 rig 出来的模型』与『官方导入模型』在部位类型上对齐。

---

## 6. 里程碑排期（建议顺序，含 DoD）

| 阶段 | 内容 | 主要落点 | DoD 出口 |
| --- | --- | --- | --- |
| S1 工程基建（1–2 周） | R-P0-1 入库 / R-P0-2 文档对齐 / O-1 时钟 / O-2 文档单一来源 / O-5 verify 入口 | 全部 P0 + docs | git 干净 + verify 全绿 |
| S2 承诺闭环（2–4 周） | R-P1-1 undo+慢校验 / R-P1-2 语义抽查 / R-P1-3 宿主 op 契约 / R-P1-4 默认 Labeler | driver + create + ARCHITECTURE | 新增 ≥12 单测；eval 仍全绿 |
| S3 更多部位（3–5 周，★） | §5 B-1..B-6 全部 | rig + warps + vocab + create + host | 20 body 语义 + 服装层 + 非标准部位全部可绑定驱动；词表自检全绿 |
| S4 Demo 矩阵（3–5 周，★ 与 S3 联调） | §4 A1..A6 全部 | examples/demo-multi-body、demo-llm、demo-creation、demo-environment-layer、demo-dual-mode、demo-import-loop | 6 个 demo 一键跑通并入 verify |
| S5 加固与性能（2–3 周） | R-P2-1 fuzz / R-P2-2 分级审核 / R-P2-3 基准 / O-3 lint / O-4 词典 | convert + create + scripts | fuzz 0 崩溃；基准报告入库 |
| S6 远期（按路线图） | P6 词表生成器 / scene 舞台 / TTS viseme-prosody / MCP 表层 / PSD 导出回环 | 新包/新模块 | 各子项独立 DoD |

> 排期可并行：S3/S4 前置依赖为 S1；Demo 依赖其对应能力落点。建议 S2/S3/S4 由不同工作流拆分并行推进。

---

## 7. 验收总览与开发纪律

### 7.1 全局验收（每次提交必须满足）
1. npm run verify（typecheck 9 包 + test 全绿 + eval 6/6 + 3/3 + e2e）通过。
2. 确定性回归：同（模型/流/seed/时钟）→ 轨迹/像素逐帧一致（含新部位的 golden）。
3. 零平台依赖不破：核心包不引 fastify/react/onnxruntime/fetch；推理与 TTS 仍可注入。
4. 词表达单一来源：任何新增语义必须同步 specs/parts-naming.json（或由它派生）。
5. 权限/内容中立：adult 部件只标记不判定；ContentPolicy 维持主机责任。

### 7.2 文档与版本
- 本文档版本：v1.0（2026-08 审查交付）——执行计划 + 新增需求；实施后每次合入更新变更记录。
- 与现有权威文档的关系：冲突时以 SPEC-DSL-v1.0.md（确认版）为准。

### 7.3 新增需求总览
- **Demo 开发要求（§4）**：A1 更多部位演示（与非标准部位强关联）→ A2 环境层专项 → A3 双模式对照 → A4 真实 LLM 直播示 → A5 创作全链（真实服务/LLM）→ A6 官方导入回环对比；每个 demo 都需纳入 npm run verify 与确定性断言。
- **更多部位支持要求（§5）**：RIG_SEMANTICS 12 → 20+（含非标准部位与服装层），每语义配绑定模板/形变/物理/顺序；服装组换装（outfit op）；词表单一来源对齐；adult 分级由主机裁定；引擎/驱动/校验三层零破坏扩展。

---

### 变更记录
| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-08（审查交付） | 由全面审查结论产出：问题分级修复方案 + 优化方案 + Demo 开发要求（新增）+ 更多部位支持要求（新增）+ 排期与验收 |
| v1.1 | 2026-08（S1+S2 交付） | 完成 R-P0-1（P4 入库 commit 4f51925）、R-P0-2（文档对齐）、R-P1-1（undo+asyncCheck 慢校验回滚）、R-P1-2（语义抽查即可 needsSlowPath+spotCheck）、R-P1-3（宿主 op 契约 HostOpHandler 透明上报）、R-P1-4（缺省 PositionLabeler）、O-5（verify/verify:e2e 入口）、O-7（rig/cutout/create README）；实测 187 测试全绿 + typecheck 9 包 + eval 6/6+3/3 |
| v1.2 | 2026-08（S3 部分交付） | 完成 B-1（RIG_SEMANTICS 12→23，含 20 body + tail/wing/ear_beast）、B-2（新增 8 个 warp 合成：下躯/臂/腿/胸/尾巴/翅膀/兽耳/脸红 opacity）、B-4（非标准部位模板）+ 33 部件全绑定测试；实测 188 测试全绿 + typecheck 9 包 + eval 6/6+3/3 |
| v1.3 | 2026-08（S4-A1 交付） | 完成 A1 demo-multi-body（examples/demo-multi-body：33 部件 rig + 尾巴/翅膀/兽耳/脸红 JSONL 语义驱动 + 环境层 + 无头出图 + 3 自动化断言）；实测 191 测试全绿 + typecheck 9 包 + eval 6/6+3/3 |
| v1.4 | 2026-08（S4-A2 交付） | 完成 A2 demo-env（examples/demo-env：环境层恒动统计 + emote 调制三态对比 + 渲染帧 + 3 断言：恒动/调制/确定性）；实测 194 测试全绿 + typecheck 9 包 + eval 6/6+3/3 |
| v1.5 | 2026-08（S5 部分交付） | 完成 R-P2-1（fuzz.test.ts：moc3 560 样本 + .moc 560 样本 0 崩溃，截断/翻转/计数损坏/版本篡改 + 空输入回归；转换校验抽样控制耗时）；实测 197 测试全绿 |
| v1.6 | 2026-08（S3-B3 交付） | 完成 B-3 服装层：8 服装语义（outfit_dress/top/bottom/shoes/hairstyle 等）+ RigClothingPartSpec(costumeGroup) + 衣装组<N> 可见性参数 + outfitLines 换装工具（driver）+ 双服装组 demo（demo-clothing）；实测 199 测试全绿 + typecheck 9 包 |
| v1.7 | 2026-08（S3-B5/B6 交付） | 完成 B-5（engine/bodies.test.ts 40 部件校验/加载/驱动/渲染 4 用例）、B-6（adult 分级：分级隐藏 opacityParam + RigSpec.adult 审计 + ContentPolicy 揭示）；实测 203 测试全绿 + typecheck 9 包 + eval 6/6+3/3 |
| v1.8 | 2026-08（S4-A3 交付） | 完成 A3 demo-dual-mode（在线流式坏行隔离 vs 离线整批原子拒绝对照 + 规则库共享验证，3 断言）；实测 206 测试全绿 + typecheck 9 包 + eval 6/6+3/3 |
| v1.9 | 2026-08（S5-R-P2-2 交付） | 完成 R-P2-2 ChainedReviewer 分级审核链（规则初审→低置信触发视觉复审→差异回注；免无谓复审短路；4 测试）；实测 210 测试全绿 + typecheck 9 包 + eval 6/6+3/3 |
| v1.10 | 2026-08（S4-A4 交付） | 完成 A4 demo-llm（headless：两跳 hop 指标 + audit；LLM_API_KEY 走真实 OpenAI 兼容端点，缺省 Mock 兜底；3 断言）；实测 213 测试全绿 + typecheck 9 包 + eval 6/6+3/3 |

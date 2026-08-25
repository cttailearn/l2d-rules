# LLM 驱动创作管线 · 技术方案与差距分析（原图 → 拆解 → 绑定 → 驱动）

> 依据：本仓库现状（146 测试全绿基线）、docs/SPEC-v2.0.md §7–10（平台规格中的自动分层/自动绑定/装配台/导入导出）、docs/SPEC-DSL-v1.0.md §9.4（P4 创作模式）、docs/DEVELOPMENT-SPEC.md §4（P4 后置为 M7+ 可选项）。
>
> **落地状态**：✅ **P4a**（@l2dp/rig，16 用例 + 像素 golden）。✅ **P4b**（@l2dp/cutout 7 用例 + @l2dp/create 13 用例 + demo-p4b + 创作评估集 3/3）。✅ **P4c 宿主桥接骨架**（@l2dp/host 13 用例：HttpClient/ComfyUI 桥/HttpSegmenter/LLM Labeler+Reviewer/P4c 装配 + demo-p4b bridge.mjs 真实 HTTP 服务跑通全链）。✅ **P4 完整 LLM 创作通道**（@l2dp/host LlmDesigner few-shot 生成 CreationDirective + LlmRepairer 校验回注自修复 + create Designer 注入点）。全仓 **254 测试全绿** + typecheck（9 包）+ eval 双门禁（drive 6/6 + creation 3/3）。⬜ 剩余宿主工程（装配台 UI/上传存储/ComfyUI workflows 落地）属平台侧。
> **开发向导**：`docs/GUIDE-FROM-IMAGE-TO-LIVE2D.md`（原图→拆→绑→驱动 全链，含真实服务/LLM 接线与 demo 命令）。
>
> 结论先行：**本仓库的"驱动"半边已经完整（M5–M7/P2/P3 + C1/C2 转换链），而"从一张原图做出可驱动模型"的创作半边（拆解/切图 + 自动绑定/rig）恰好是当前唯一没有落地的目标**——对应平台规格 §9 的「自动分层」「自动绑定」与路线图 P4「LLM 创作通道」。下面逐项拆解：哪些现成可复用、哪些是新增、缺什么、怎么补。

---

## 1. 目标管线（用户诉求）

```
上传原图
   │
   ▼ ① 拆解（切图/分层）
   ├─ 背景抠除（matting）
   ├─ 语义部件切分：后发/前发/脸/目/眉/口/躯干/臂/腿/服装…
   ├─ 每部件 = alpha PNG + 归属语义类（specs/parts-naming.json = 语义类表）
   │
   ▼ ② 绑定（自动 rig）
   ├─ 关键点检测 → 网格生成（三角剖分/配准模板）
   ├─ 语义部件 ↔ 引擎参数挂接（standard-params.json + 参数分组 = 参数槽表）
   ├─ 形变合成：warp keyform / warp2d 转头 / deformer 层级 / 绘制顺序 / 物理摆锤 / 可见性
   │   产物 = .l2dm（自包含）＋ RigSpec（可回溯修改）＋ 质检报告
   │
   ▼ ③ 驱动（复用现成驱动栈）
   ├─ 生成基础 motion3/exp3（idle 眨眼/呼吸/口型）
   ├─ @l2dp/driver：JSONL 流式 / 分层求值 / 环境层 / Provider / 两跳 / TTS
   ├─ @l2dp/engine：软件 + WebGL2 双渲染，headless 可预览
   │
   ▼ ④ LLM 闭环（贯穿全程）
   └─ LLM 出结构化指令（CutoutResult / RigSpec / MotionSpec）→ 校验 → 错误回注 → 修复
      → headless 渲染截图 → 多模态自检 → 迭代（"3 轮内修出合法运动文件"，路线图 P4 原话）
```

---

## 2. 现状盘点：已有与缺失

| 管线环节 | 本仓库现状 | 载体 | 缺什么 |
| --- | --- | --- | --- |
| ③ 驱动 | ✅ **完整** | packages/driver（IR v2/JSONL/分层/环境层/校验/Provider/两跳/TTS）+ packages/engine（.l2dm 运行时/双渲染/headless） | 无（直接复用） |
| 官方模型→.l2dm | ✅ **完整** | packages/convert：readMoc3/moc3ToL2dm（真实几何+keyform 形变烘焙+绘制顺序+参数范围，41 模型回归）、readMoc/mocToL2dm（Cubism2，164 模型回归）、model3 JSON 链 | 无（这是"改已有模型"路径，不是"从原图造模型"） |
| 从零构建/二次修改 | ✅ **基础已具备** | packages/convert/src/author.ts：createL2dm + addPart/ensureMesh/addWarp/addDeformer/addPendulum/attachTexture/embedTexture/setParamRange/validate —— **这就是"绑定"结果的写入面** | 只差"谁会来调用它"（模板/LLM） |
| ② 自动绑定 | ⬜ **全新（核心缺口）** | — | 关键点检测、模板网格库、三角剖分/配准、**warp 形变合成**、自动绘制顺序、自动物理、rig 质检规则 |
| ① 拆解/切图 | ⬜ **全新** | — | 抠图/语义分割（U2Net/SAM2/LayerDiffusion）、部件候选+语义标注、覆盖率/重叠质检 |
| ④ LLM 创作编排 | ⬜ **全新（路线图 P4）** | driver 已有"可复用骨架"（校验回注 LLM 自修复、Provider 函数调用、headless 渲染） | 创作 IR + 创作 JSON Schema + 创作规则 + function tools、多模态自检循环 |
| 词表锚点 | ✅ | specs/parts-naming.json（语义部件表 = 拆解类表）、specs/standard-params.json + paramGroups（参数槽表 = 绑定目标） | 无；新代码直接消费 |

> 注：DEVELOPMENT-SPEC/ARCHITECTURE 中提到的 packages/dsl（语言 A 编译 .ldsl→motion3/exp3）与 packages/renderer 在本仓库**不存在**——dsl 是创作/驱动资产的编译器（P4 会用到），renderer 已由 engine 取代退役。specs/evals/drive-cases.json 已有 6/6 评估门禁（驱动向），创作向评估集待建。

---

## 3. 技术方案（4 个新构建块）

### 块 A —— 拆解/切图：`@l2dp/cutout`（新包，或宿主注入）
平台规格 §9.2 已定义三模式（本地 ComfyUI SAM2/LayerDiffusion / 平台托管 / 浏览器半自动）。SDK 侧落地"宿主无关核心"：
- **轻量/半自动档（本仓库能做的）**：onnxruntime(-node/web) 载入 U2Net（rembg 同款）做抠图 → 连通域候选 → LLM 视觉模型按 parts-naming.json 语义类为每个候选命名 → 输出 `CutoutResult`。
- **重型档（宿主）**：ComfyUI REST（SAM2/LayerDiffusion/part_gen）→ 同一 `CutoutResult` 契约。
- **质检规则**（平台 §9.2 已定）：总覆盖率 ≥98%、重叠区 ≤2%、小碎片并入最近部件、边缘羽化 2–4px —— 全部可写成确定性规则进校验器（沿用 driver 规则库模式）。
- **LLM 角色**：调用工具（函数调用）执行切分命令；对候选件语义归类；处理分歧/缝隙；最终输出结构化 `CutoutResult`（目录进、IR 出，符合架构红线 #4）。

```ts
// 契约草案（与平台 §7.3 layers 输出对齐）
interface CutoutPart { semantic: string;             // parts-naming 语义名
                       image: string;                 // dataURI / 引用
                       confidence: number; bbox: {x,y,w,h} }
interface CutoutResult { canvas: {width,height}; parts: CutoutPart[];
                         issues: {rule:string;message:string}[] }
```

### 块 B —— 自动绑定/rig：`@l2dp/rig`（新包，SDK 核心新增）
这是**最大也最缺**的一块。好消息：写出合法 .l2dm 的一切"笔"都在（createL2dm + 编辑 API + `moc3ToL2dm` 证明了一个 rig 生成器长什么样），缺的是"模板与合成逻辑"。
1. **关键点**：mediapipe tasks-vision（官方 TS，Node 原生）Face 168 / Pose 33，或 onnxruntime ONNX —— 平台 §9.3 已选型。
2. **模板网格库**：按 parts-naming.json 的语义类型建模板（目/眉/口/前发/脸/臂…），关键点三角剖分（delaunator + 受约束 Delaunay/cdt2d 纯 TS）→ 非刚性配准到模板 → 每个部件的 .l2dm mesh。
3. **参数挂接表**：语义部件 → 引擎参数（复用 standard-params.json + paramGroups）：目→EyeBlink 组/眼开合；口→LipSync 组/嘴开合+口型；头→Head 组 warp2d 转头；眉→眉升降；发/胸→Physics 摆锤输出。
4. **形变合成**（全自动 rig 的难点）：模板内置"参数→顶点偏移"预设（转头=warp2d 网格剪切、微笑=口角外上偏移、眨眼=眼睑闭合偏移…），配准后映射到新网格 → 写 .l2dm.mesh.warps/warp2d。引擎运行时不改，`accumulateKeyforms` 直接消费。
5. **绘制顺序/层级**：由语义类先验推导顺序（后发<侧发<耳<脸<前发…），身体层/服装层按 parts-naming category 分组。
6. **自动物理**：模板给摆动部件（前/后发、胸）挂 pendulums（engine 已实现摆锤运行时，author.addPendulum 即写入面）。
7. **质检报告**（平台 §9.4 schema）：triangles_no_flip / no_dangling_vertices / occlusion_order_valid / confidence —— 结构校验引擎已能覆盖前两项，后两项新增。

### 块 C —— LLM 创作编排：`@l2dp/create`（新包，= 路线图 P4）
- **创作 IR**（区别于驱动 IR）：op 集如 {op:"cutout"} / {op:"label_part"} / {op:"rig_param", part, param, warp} / {op:"set_order"} / {op:"add_physics"} / {op:"emit_motion"}…… 与驱动 IR v2 并列，schema 由同一规则库同源生成（照抄 driver ir/schema.ts 的"从规则生成 schema"模式，供 function calling / MCP 同源）。
- **规则库**：校验 CutoutResult/RigSpec/MotionSpec（覆盖/重叠/命名/参数范围/悬空顶点/翻转三角形/资产可解析），错误结构**直接回注 LLM**（driver validate 已是这个模式）。
- **自修复闭环**：LLM 提案 → 校验 → 失败原因回注 → 重试（≤3 轮）→ 通过后 headless 软件渲染出图 → 多模态自检（遮挡/断裂/美观/语义正确）→ 调整 RigSpec → 再渲染。**这正好是本仓库独有优势：engine 软件光栅让 LLM 能"看到"自己 rig 出来的模型**。
- **资产与求值复用**：产出 motion3/exp3 后走现成 driver 验证（CURVE/表达式规则）与 engine 播放；干跑（DRY_RUN）批量已实现。

### 块 D —— 驱动铺垫与宿主缝（量最少）
- 生成基础 idle motion / 呼吸 / 眨眼 exp 的"资产生成器"（可 LLM 驱动，走块 C 规则校验）。
- 宿主（live2d-forge）侧：上传/存储/ComfyUI 桥/装配台 UI 属宿主（架构边界），SDK 只给接口与契约。

---

## 4. 缺少的东西（差距清单，按优先级）

| # | 缺失能力 | 影响 | 落点建议 | 可复用 |
| --- | --- | --- | --- | --- |
| 1 | **warp/形变"合成"**（从模板发明形变，而非仅从 .moc3 解码） | 没有它=rig 出来不会动 | 新：模板 + 配准 + MeshWarpAuthor | engine 形变运行时/校验；convert 的 keyform 烘焙范式 |
| 2 | **自动 rig 全流程**（关键点→网格→参数挂接→顺序→物理） | 拆完图没人把这些变成模型 | 新：@l2dp/rig | author.ts 编辑 API、standard-params.json、engine 结构校验 |
| 3 | **拆解/切图与质检**（抠图+语义分割+部件命名+覆盖/重叠规则） | 没有切图就没有部件输入 | 新：@l2dp/cutout（半自动档）+ 宿主 ComfyUI 桥 | specs/parts-naming.json、driver 规则库模式、平台 §9.2/9.4 规则表 |
| 4 | **创作 IR + Schema + 函数工具 + 自修复循环**（P4） | LLM 无法结构化操控创作、无法自我修正 | 新：@l2dp/create | driver ir/schema + validate 回注模式 + Provider 工具/结构化输出 + engine headless 渲染 |
| 5 | **motion/exp 资产生成器**（新角色的基础动作） | 绑定完没有可播资产 | 新：MotionsAuthor（few-shot/模板）+ 规则校验 | driver CURVE 规则、engine motion 播放、评估集框架（specs/evals） |
| 6 | **创作向评估集**（drive-cases 只有"驱动"向 6 例） | 无法回归保证 | 新：specs/evals/creation-cases.json | eval-drive.mjs 框架 |
| 7 | packages/dsl（语言 A 编译 .ldsl→motion3/exp3）不存在 | 创作资产缺少高级编译入口（可选） | 延后/可选 | SPEC-DSL workflow |

**没有阻塞项**：现有 SDK 的"写入面/运行时/校验/渲染/LLM 通道"全部命中创作管线的消费端——缺的是**上游生成逻辑与编排**，不是底层能力。

---

## 5. 分阶段落地建议（每阶段带 DoD）

**阶段 P4a（SDK 内，纯外部依赖少）——先打通"半自动 rig"**
- `@l2dp/rig`：模板网格 + 参数挂接 + warp 合成 + 自动顺序 + 物理；输入=人工/脚本给出的 PartSpec（部件图 + 语义类），输出=合法 .l2dm + RigSpec + 质检报告。
- DoD：手绘/图片角色 → rig → headless 渲染出图可看；engine 校验通过；warp 合成有像素 golden；typecheck+测试全绿。

**阶段 P4b —— 拆解半自动 + 创作编排**
- `@l2dp/cutout`（onnxruntime U2Net 半自动档）+ `@l2dp/create`（创作 IR/规则/函数工具/自修复枚举）。
- DoD：原图 → 半自动切图 → LLM 语义归类 → RigSpec → .l2dm → 驱动栈播放的**全链路 demo**（对标 examples/demo-real 的"从图片"版本）；motion 资产生成器；creation-cases 评估集 ≥3 例；多模态自检循环打通。

**阶段 P4c —— 宿主缝 + 重型档（可交 host）**
- 平台 services/ai（ComfyUI SAM2/LayerDiffusion/part_gen）+ 装配台自动绑定向导 + 上传/存储；SDK 只补接口契约。
- DoD：平台一键"生成立绘→自动分层→入库→自动绑定→预览可动→导出"闭环（平台 §10.2 自动绑定向导 DoD）。

---

## 6. 风险与红线（保持本仓库纪律）

- **确定性**：切图/rig 建议保持"LLM 出结构化 RigSpec、确定性代码落地"——LLM 幻觉只进结构化产物，不进像素（架构红线 #4：目录进、IR 出）。
- **零平台依赖**：onnxruntime/mediapipe 等属"可选推理注入"（驱动器已立先例：Provider/TTS 由宿主注入），核心规则/IR/校验/合成保持纯 TS 确定性。
- **形变合成的验证**：warp 合成无法与官方 Core 对拍（原图无官方模型），需自建"模板→期望像素/顶点"golden（仿 C2 的 golden-moc3 范式）。
- **版权/内容分级**：原图来源与成人部件判定归宿主 ContentPolicy（SDK 内容中立，红线 #5）。
- **不重复造的上游**：SAM2/LayerDiffusion/LoRA/超分属平台 ComfyUI（非本仓库代码，只做 REST 调用方）；别在 SDK 里重写。
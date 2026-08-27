# demo-app —— 统一小型使用应用 demo：一个应用、四个功能界面（真实模型/真实图像）

这是一个**打开就能用的小型应用**，且**按功能分成四个独立界面**（顶栏导航切换，互不堆叠）：
**💬 聊天助手 · 🎨 人物创建（必须上传真实图像）· 🎛 全功能演示（行走/换衣/头部/脸部）· 🔄 转换对比**。

> 定位：**统一收敛后的唯一 demo**（其余 examples/demo-* 已并入删除）——「用这套 SDK 能搭出一个什么样的应用」，
> 并且**示例数据必须是真实的**：默认角色为官方真实 Haru；人物创建页不使用任何内置合成示例，只从用户上传的真实立绘构建。

## 四个功能界面（`http://localhost:5173` + 顶栏导航）

| 界面 | 页面 | 演示什么 |
|---|---|---|
| 💬 **聊天助手** | `/` | 聊天输入 → 两跳决策 → 台词+语音+口型+动作；角色：官方真实 Haru（默认）/ 衣装酱 / 小骨架 / 我的创作 / **导入的 .l2dm** |
| 🎨 **人物创建** | `/create.html` | **上传自己的真实 PNG 立绘**（含质量预检）→ 内置链或**真实服务**（HttpSegmenter+LLM）→ 可下载成品 .l2dm →「我的创作」 |
| 🎛 **全功能演示** | `/features.html` | 行走 / 换装·组1·组2 / 头部·点头·摇头 / 脸部·微笑·张嘴·眨眼·惊讶 + 本页聊一句（同一两跳决策） |
| 🔄 **转换对比** | `/compare.html` | **内置真实 Haru 一键现场对比**（官方 .moc3 → 自研转 .l2dm vs 官方 Cubism SDK）；也可上传任意模型 |

「我的创作」经 `sessionStorage` 在四个页面间共享 + 可**下载为 .l2dm / 在聊天页导入**。

## 一条消息走完的链路（全部是 @l2dp/* 的真实能力）

```
你输入「你好呀！」
  └─ @l2dp/driver · 两跳决策（DriverEngine）
       ① 第一跳：BehaviorIndex 本地规则（<50ms，不进 LLM）→ 命中 greet
       ② 未命中关键词 → 第二跳 Provider（确定性 mock 或真实 LLM）输出 JSONL
  └─ 确定性应答器 → 角色台词（离线可跑、同输入同输出）
  └─ 台词 → estimateSpeechTimeline + blendVisemes → 说话口型（ParamMouthOpenY / 微笑 / 点头）
  └─ JSONL 逐行 → StreamIngestor（行级校验，坏行隔离不阻塞）→ LayerStack + EnvironmentLayer + Evaluator
  └─ @l2dp/engine · L2dmPlayer（播放/形变/物理）写入每帧参数
  └─ @l2dp/engine · SceneStage（背景 + 相机缩放 + 多角色 z-order）→ RenderSink（WebGL2 / 软光栅）
  └─ run.mjs/浏览器 → 出帧 / 实时渲染 + 播语音（Haru 4 句官方语音）
```

## 四个角色（演示「模型无关」：同一套规则驱动四种形态）

| 角色 | 形态 | 你能看到 |
|---|---|---|
| **Haru**（默认） | **官方真实模型** .moc3 真实几何 + 内嵌 2 张纹理 + 4 句语音 | 官方同观感呈现；环境层映射呼吸/眨眼/视线；语音即时变化 |
| **衣装酱** | `@l2dp/rig` 半自动绑定（10 部件 / 8 参数 + 2 组服装） | 点头/摇身/害羞（warp 形变）+ **换装**（outfit op）+ 行走（腿摆/身摆步态） |
| **小骨架** | 语义骨架（3 部件 + 3 warp + 物理 + deformer） | `play` 微笑点头/尾巴摇/害羞低头 + `face` 开心——网格真实形变 |
| **✨ 我的创作** | 你的上传图像在浏览器内构建 | 切图→绑定→动作（idle/blink/talk/surprise/**walk**）→ 与自己的立绘聊天 |

> ⚠️ 说明：
> - **Haru 双臂修复**：官方 Haru 在 .moc3 里含「可切换的手臂层」，默认姿态下原本会看到两套手臂重叠。
>   已修复：烘焙脚本（`npm run gen:haru`）按 **官方 CubismCore 默认姿态 opacity 过滤**（仅保留可见 ArtMesh，84→73），
>   `@l2dp/convert` 的 `moc3ToL2dm` 相应新增 `visibleArtMeshFilter` 供宿主注入运行时可见性。
> - Haru 当前 `.l2dm` 为官方**基准姿态烘焙**（warp 形变动画管线在下一里程碑），参数驱动/台词/语音正常，
>   **几何形变请切衣装酱/小骨架/我的创作**看到「真的在动」。

## 全功能（features.html）—— 按钮按角色自动生成 JSONL

- 行走：`generateStarterMotions` 的 `walk`（腿摆/臂摆反相 + 身摆/身转 + 头部微动），`MotionKind` 扩展为
  `idle/blink/talk/surprise/walk`；仅当角色存在对应部件参数/动作资产时可用（衣装酱 / 我的创作）。
- 换装：`outfit op → outfitLines` 切换服装组可见性（衣装酱两套服装）。
- 头部：点头/摇头由 头点头/头转向（或 ParamAngleX/Y）驱动；脸部：微笑/张嘴/眨眼/惊讶走
  `play`（动作资产）或 `face`（表情）或直接 set 语义参数；不可用项自动提示。
- 按钮的 JSONL 生成已抽成**纯函数 `src/drive.ts`**（可单测，7→11 例新增 4 例判定矩阵）。
- 页面另有「本页聊一句」轻量输入框（同一 `stage.reply` 两跳决策）。

## 优化项（本轮）

- **人物创建（create.html）**：上传后即时**质量预检**（候选区数量/覆盖率，提示是否适合内置链）；失败日志**友好化**（原因+建议）；可展开「🛠 真实服务接入」用 `@l2dp/host` 的 HttpSegmenter + LLM 标注/审核（`buildP4cBridges`）处理复杂图；成功后**下载成品 .l2dm**。
- **导入 .l2dm（聊天页）**：📥 按钮导入任意 .l2dm/.json 作为「📥 导入」角色（mouthParam/参数字段自动识别），并持久化到 sessionStorage 供其他页使用。
- **基准烘焙提示**：官方 Haru（无几何 warp）在聊天/全功能页显示“几何不形变”提示；全功能页对几何类按钮补充同样的提示。
- **compare 内置真实 Haru**：加载即用 /official-haru 现场装配官方素材，一键「自研转换 vs 官方 SDK」对比；右侧运行时需联网 CDN，断网时左侧照常。
- **性能**：浏览器纹理解码走 `createImageBitmap` 快路径（`texture.ts decodePngBitmap`），失败回退软解码。
- **样式**：统一 compare 主题、favicon、页面淡入、更大画布、状态栏/错误可见区。

## 上传图像 → 构建 Live2D（create.html · 必须上传真实立绘）

在「🎨 人物创建」页**选择/拖入一张你自己的真实 PNG 立绘**（无内置合成示例；未上传前「构建」按钮不可用）→
点「构建 Live2D」，SDK 在浏览器里完成整条创作链（全部 @l2dp/*，无服务器）：

```
上传真实 PNG → @l2dp/cutout（ColorKeySegmenter 平坦色候选选区 + 语义标注）
        → @l2dp/create（createWithSelfRepair：同源 JSON Schema 校验 / RuleRepairer 自修复 ≤3 轮）
        → @l2dp/rig（半自动绑定：参数挂接 + warp 形变 + 绘制顺序 + 呼吸 deformer + 基础动作生成）
        → 自包含可驱动 .l2dm（部件纹理已内嵌 atlas）+ idle/blink/talk/surprise/walk 动作
        → 保存到 sessionStorage → 「聊天助手 / 全功能演示」中用作「✨ 我的创作」（可聊天/走路/说话/对口型）
```

- 页面实时显示 ① 原图 / ② 切图·标注（色块 bbox）/ ③ 绑定·动作 三帧预览，以及切图覆盖率/自修复轮数等日志。
- 「容差 / 最小面积」可调：平坦色画风（如二次元立绘）用内置确定性链就能得到可识别角色；复杂照片/渐变图
  结果会粗糙——SDK 设计即把 **Segmenter/Labeler 做成可注入钩子**：接入 `@l2dp/host` 的
  HttpSegmenter（U2Net/SAM2/ComfyUI REST）与视觉 LLM 标注（LlmDesigner/LlmLabeler）即可升级为任意图，核心零改动。
- 示例为色板已知 → 自动用 `ColorMapLabeler(SAMPLE_MAPPING)`（语义精确）；任意上传 → 默认
  `PositionLabeler(defaultSlots)`（位置槽，粗略但可运行），与 `createWithSelfRepair` 文档一致。

## 运行

要求：Node ≥ 23.6（本 demo 零构建，Node 直跑 TS）。

```bash
npm run dev          # 浏览器应用 → http://localhost:5173（四个功能页面，顶栏导航；WebGL2 优先，软光栅兜底）
npm start            # 无头 CLI：脚本化对话 + 上传构建示例 → 出帧 out/*.png + created-preview.png + report.txt
CHAR=demo npm start  # 指定角色（haru / demo / costume / all）
LLM_API_KEY=… npm start   # 第二跳走真实 OpenAI 兼容端点（LLM_BASE_URL / LLM_MODEL 可选）
npm test             # 同核无头测试（11 例：决策/口型/换装/确定性/场景/上传构建全链 + drive 判定矩阵 4 例）
```

浏览器页面：`/`（聊天助手）、`/create.html`（人物创建 · 必须上传真实立绘）、`/features.html`（全功能演示）、
`/compare.html`（转换对比 · 内置真实 Haru）。直达参数：`?character=demo`、`?character=costume` 等；右上可开「👥 同伴」
（SceneStage 多角色：舞台右侧多一只循环摇尾巴的小骨架，自带环境层）。

## 目录

```
index.html          应用壳（顶栏导航 + 聊天助手界面①）
create.html         人物创建界面②（上传真实 PNG → 构建）
features.html       全功能演示界面③（行走/换装/头部/脸部按钮）
compare.html        转换对比界面④（官方 Cubism SDK 并排；src/compare*.ts）
public/style.css    共享样式；public/ 模型（haru-full/demo/costume .l2dm）+ 真实官方 Haru（official-haru/*）+ 语音 wav
src/stage.ts        舞台壳（无页面胶水：加载/实时渲染/角色/背景/缩放/同伴/预置/换装/指标 + “我的创作”sessionStorage 恢复）
src/pages/chat.ts   界面①入口：聊天面板接线（输入/日志/快捷回复）
src/pages/create.ts 界面②入口：上传→构建→保存“我的创作”（无内置合成示例）
src/pages/features.ts 界面③入口：按角色生成 JSONL 的功能按钮
src/chars.ts        角色规格：模型文件、环境层映射覆盖、反应 JSONL、应答文本、Provider
src/core.ts         应用核心（无 DOM）：两跳决策 + 台词 + 口型 + SceneStage —— 浏览器/无头/测试共用
src/creator.ts      上传图 → 构建（cutout→create→rig 全链，可注入 segmenter/labeler/reviewer）+ SAMPLE 色板（测试用）
src/drive.ts        「全功能演示」纯函数：按角色生成 JSONL（判定矩阵，可单测）
src/texture.ts      PNG 解码（atlas data URI → Tex2D；浏览器 createImageBitmap 快路径 + 软解码兜底）
src/dom.ts          DOM 取元素助手
scripts/run.mjs     无头运行器（同核；FROM_IMAGE 可走磁盘真实图；可选真实 LLM）
scripts/gen-haru.mjs 真实 Haru 烘焙（CubismCore 默认姿态可见性过滤 → haru-full.l2dm）
test/app.test.ts    同核无头测试（node --test，7 例）
test/drive.test.ts  全功能 JSONL 判定矩阵测试（4 例）
```

## 链接

- 两跳决策：`packages/driver/src/twohop/engine.ts`；行为库 `twohop/types.ts`；Provider `provider/*`
- 流式驱动 + 校验：`packages/driver/src/stream/ingestor.ts`；分层 ：`layers/layer-stack.ts`；环境层 `layers/environment.ts`
- 口型/韵律：`packages/driver/src/tts/{estimate,viseme,phonemes}.ts`
- 换装契约：`packages/driver/src/layers/host-ops.ts`（`outfitLines`）
- 场景舞台：`packages/engine/src/scene/stage.ts`；播放器 `packages/engine/src/player/player.ts`
- 上传构建：`packages/cutout`（ColorKey/Position/ColorMap Labeler + Segmenter/Labeler 注入钩子）、
  `packages/create`（createWithSelfRepair + walk 动作生成）、`packages/host`（HttpSegmenter/LlmDesigner 注入）
- 真实模型转换：`packages/convert`（convertLive2dModel + moc3ToL2dm `visibleArtMeshFilter`）；
  烘焙脚本 `scripts/gen-haru.mjs`（CubismCore 默认姿态可见性过滤）
- 规范：`docs/SPEC-DSL-v1.0.md`；`docs/GUIDE-FROM-IMAGE-TO-LIVE2D.md`

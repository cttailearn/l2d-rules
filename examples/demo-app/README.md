# demo-app —— 小型使用应用 demo：Live2D 聊天助手（看板娘/VTuber 小应用）

这不是「跑一个脚本出几张图」的简单 demo，而是一个**打开就能用的小型应用**：你在聊天框里打字，角色就会
**说话（台词 + 语音）**、**做动作（点头/摇身/害羞/换装）**、**张嘴对口型**，整个渲染实时进行。

> 定位：与 demo-web（工程验证控制台）互补 —— demo-web 给开发者看「引擎怎么验证」，
> demo-app 给使用者看「这个 SDK 能搭出一个什么样的应用」。

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

## 三个角色（演示「模型无关」：同一套规则驱动三种形态）

| 角色 | 形态 | 你能看到 |
|---|---|---|
| **衣装酱**（默认） | `@l2dp/rig` 半自动绑定（10 部件 / 8 参数 + 2 组服装） | 点头/摇身/害羞（warp 形变）+ **换装**（outfit op → `outfitLines`）；说话点头 |
| **小骨架** | 语义骨架（3 部件 + 3 warp + 物理 + deformer） | `play` 微笑点头/尾巴摇/害羞低头 + `face` 开心——网格真实形变 |
| **Haru** | 官方 .moc3 真实几何 + 内嵌 2 张纹理 + 4 句语音 | 官方同观感呈现；环境层映射呼吸/眨眼/视线；参数读数与语音即时变化 |
| **✨ 我的创作** | **上传图像浏览器内构建**（第 4 个角色，见下节） | 切图→绑定→动作→内嵌纹理，然后直接与「自己的立绘」聊天 |

> ⚠️ 说明：Haru 当前 `.l2dm` 是官方**基准姿态烘焙**（`@l2dp/convert` 的 warp 形变动画管线在
> 下一里程碑，见 `docs/MOC3-PHASE2-PLAN.md`），所以 Haru 参数改变**不驱动几何形变**（动作语义请切
> 衣装酱/小骨架看到「真的在动」）。你的动作指令在 Haru 上依然被 Driver 逐行校验、求值并写进参数面。

## 上传图像 → 构建 Live2D（浏览器内 · 纯确定性全链）

在左侧「🎨 上传建 Live2D」面板**选择/拖入一张 PNG 立绘**（或点「使用内置示例立绘」）→ 点「构建 Live2D」，
SDK 在浏览器里完成整条创作链（全部 @l2dp/*，无服务器）：

```
上传 PNG → @l2dp/cutout（ColorKeySegmenter 平坦色候选选区 + 语义标注）
        → @l2dp/create（createWithSelfRepair：同源 JSON Schema 校验 / RuleRepairer 自修复 ≤3 轮）
        → @l2dp/rig（半自动绑定：参数挂接 + warp 形变 + 绘制顺序 + 呼吸 deformer + 基础动作生成）
        → 自包含可驱动 .l2dm（部件纹理已内嵌 atlas）+ idle/blink/talk/surprise 动作
        → 注册为第 4 个角色「我的创作」→ 可直接聊天/说话/对口型（behavior 由两跳决策驱动）
```

- 面板实时显示 ① 原图 / ② 切图·标注（色块 bbox）/ ③ 绑定·动作 三帧预览，以及切图覆盖率/自修复轮数等日志。
- 「容差 / 最小面积」可调：平坦色画风（如二次元立面）用内置确定性链就能得到可识别角色；复杂照片/渐变图
  结果会粗糙——SDK 设计即把 **Segmenter/Labeler 做成可注入钩子**：接入 `@l2dp/host` 的
  HttpSegmenter（U2Net/SAM2/ComfyUI REST）与视觉 LLM 标注（LlmDesigner/LlmLabeler）即可升级为任意图，核心零改动。
- 示例为色板已知 → 自动用 `ColorMapLabeler(SAMPLE_MAPPING)`（语义精确）；任意上传 → 默认
  `PositionLabeler(defaultSlots)`（位置槽，粗略但可运行），与 `createWithSelfRepair` 文档一致。

## 运行

要求：Node ≥ 23.6（本 demo 零构建，Node 直跑 TS）。

```bash
npm run dev          # 浏览器应用 → http://localhost:5173（WebGL2 优先，软光栅兜底；含上传构建面板）
npm start            # 无头 CLI：脚本化对话 + 上传构建示例 → 出帧 out/*.png + created-preview.png + report.txt
CHAR=demo npm start  # 指定角色（haru / demo / costume / all）
LLM_API_KEY=… npm start   # 第二跳走真实 OpenAI 兼容端点（LLM_BASE_URL / LLM_MODEL 可选）
npm test             # 同核无头测试（7 例：决策/口型/换装/确定性/场景/上传构建全链）
```

浏览器直达参数：`?character=demo`、`?character=costume` 等；右上可开「👥 同伴」（SceneStage 多角色：
舞台右侧多一只循环摇尾巴的小骨架，自带环境层）。

## 目录

```
index.html          应用壳（顶栏/舞台/聊天面板/控制条/气泡/上传构建面板）
src/chars.ts        角色规格：模型文件、环境层映射覆盖、反应 JSONL、应答文本、Provider
src/core.ts         应用核心（无 DOM）：两跳决策 + 台词 + 口型 + SceneStage —— 浏览器/无头/测试共用
src/creator.ts      上传图 → 构建（cutout→create→rig 全链）+ 创作角色装配 + 示例立绘/SAMPLE 色板
src/texture.ts      PNG 解码（atlas data URI → Tex2D，fflate；与 demo-web 同源）
src/main.ts         浏览器入口（DOM 胶水 + 渲染主循环 + 语音 + 上传构建面板接线）
scripts/run.mjs     无头运行器（同核；含上传构建示例；可选真实 LLM）
test/app.test.ts    同核无头测试（node --test，7 例）
public/             模型（haru-full/demo/costume .l2dm）与 Haru 语音 wav
```

## 链接

- 两跳决策：`packages/driver/src/twohop/engine.ts`；行为库 `twohop/types.ts`；Provider `provider/*`
- 流式驱动 + 校验：`packages/driver/src/stream/ingestor.ts`；分层 ：`layers/layer-stack.ts`；环境层 `layers/environment.ts`
- 口型/韵律：`packages/driver/src/tts/{estimate,viseme,phonemes}.ts`
- 换装契约：`packages/driver/src/layers/host-ops.ts`（`outfitLines`）
- 场景舞台：`packages/engine/src/scene/stage.ts`；播放器 `packages/engine/src/player/player.ts`
- 上传构建：`packages/cutout`（ColorKeySegmenter/PositionLabeler/ColorMapLabeler/Segmenter·Labeler 注入钩子）、
  `packages/create`（createWithSelfRepair/schema/执行/动作生成）、`packages/host`（HttpSegmenter/LlmDesigner 任选注入）
- 画面浏览页（demo-web）：`examples/demo-web/compare.html`
- 规范：`docs/SPEC-DSL-v1.0.md`；`docs/GUIDE-FROM-IMAGE-TO-LIVE2D.md`

---
name: live2d-drive
description: 用 @l2dp/*（l2d-rules）驱动一个 Live2D 模型：转换官方模型为自包含 .l2dm、用 JSONL 语义指令（play/face/blink/环境层）让角色一直活着、并把每帧参数喂给引擎渲染。使用场景：模型/LLM 需要「让角色动起来」——加载示范动作/表情、播放官方 motion、眨眼/呼吸/视线环境层、参数滑杆直驱、软件/WebGL 双渲染。
---

# live2d-drive · 用 @l2dp/* 驱动 Live2D 模型（随包技能）

> 本技能跟随 @l2dp 包交付：你（模型/agent）只要拿到这份说明，就永远知道怎么让一个角色“动起来”。
> 核心：把“模型怎么动”讲成**语义命名的参数** + **逐行 JSONL 指令流**，而不是直接摆官方 PARAM_*。

## 1. 先建模型（三选一）

```ts
// A. 官方 .moc3 → 自包含 .l2dm（含真实几何 + 关键帧形变 + 内嵌纹理）
import { readMoc3, moc3ToL2dm } from "@l2dp/convert";
const r = readMoc3(bytes);
const model = moc3ToL2dm(r.moc, { id: "Haru", groups: [], textures: ["Haru.2048/texture_00.png"], targetHeight: 1100 });
// 已烘焙 mesh.warps（keyform 形变）→ 可直接播放动作

// B. 官方 model3 包（JSON 链路，examples/demo-real/src/run.ts 全流程示例）
// C. 从零构建 createL2dm(...) + addPart/embedTexture 等编辑 API
```

- 产物 .l2dm 是**自包含**的：网格 + UV + 索引 + 参数面 + 内嵌纹理 atlas；一个文件即完整模型。
- parameter id 用**语义名 / 官方 ParamX camelCase** 均可（驱动层不挑）；官方 motion3/exp3 的 ParamX 天然可驱动。

## 2. 加载 + 播放（引擎 L2dmPlayer）

```ts
import { loadL2dmObject, L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
const lr = loadL2dmObject(model);
const player = new L2dmPlayer(lr.model, atlas /* Map<file, Tex2D> */);
player.play(engineMotion);
player.tick(16);
const sw = new SoftwareRenderer();
player.render(sw);
```

- 直接驱参数：`player.params.set("ParamEyeLOpen", 30)` → 下一帧 `render` 立即生效（warp/自身关键帧形变自动应用）。
- 双渲染后端：WebGL2 优先、软件光栅兜底/无头；两者逐像素一致（M3/M5 golden 保证）。

## 3. 让它“活着”——LLM 驱动核心（@l2dp/driver）

用**逐行 JSONL** 说指令，StreamIngestor 逐行原子应用、坏行隔离不阻塞：

```ts
const stack = new LayerStack(defs);
const env = new EnvironmentLayer(defs, { seed: 42 });
const ing = new StreamIngestor({ manifest, library, assets, stack, env, seed });
const ev = new Evaluator(stack, env, defs, { apply(_ch, params) { /* 每帧 params → player */ } });

ing.feedLine('{"op":"play","asset":"haru_g_idle"}', 0);
ing.feedLine('{"op":"face","expression":"F01"}', 0);
ing.feedLine('{"op":"blink"}', 0);
for (let i = 0; i < 120; i++) ev.onFrame(16);
```

- play / face / blink / set 自动叠加；参数分层优先级由 LayerStack 决定。
- 环境层默认把角色“养着”：不喂任何指令，角色也在呼吸/眨眼/视线漂移。
- 确定性：同 (模型, 指令, 时钟种子) 同输出——可测、可离线回归。

## 4. 官方动画级一致（M5 golden）

- 转换层 moc3ToL2dm 烘焙**关键帧形变**（mesh.warps）；运行时零依赖官方 Core。
- 构建期工具 examples/demo-real/scripts/gen-deform.mjs 用官方 Core 烘焙像素级对齐动画模型（haru-anim.l2dm），引擎插值 == 官方渲染（golden 0.001%-0.145% 像素差）。
- 验证：examples/demo-real/scripts/golden-moc3.mjs（引擎 vs 官方，同光栅化器）。

## 5. Do / Don't

- 把“动作”表达成**语义 JSONL 流**（稳定、可回放、坏行隔离）；用 play/face/blink 组合出“一直活着”；直驱前检查参数 min/max/def。
- 不要在源代码里硬编码官方 PARAM_* 白名单（语义层只认映射区）；不要假设有 GPU（软件光栅永远可用）；不要每帧手写状态（用 play / blink / 环境层）。
- 边界：warp 形变来自 .moc3 自身关键帧（自研、零平台依赖）；rotation deformer 为实验性（deformRotation 需显式开启）。

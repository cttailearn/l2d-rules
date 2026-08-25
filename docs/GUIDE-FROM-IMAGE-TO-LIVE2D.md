# 开发者向导：一张原图 → 可驱动角色（拆解 → 绑定 → 驱动）

> 目标：把一张角色立绘变成**能眨眼、会转头、可张嘴、能被 JSONL 驱动**的 Live2D 式模型。
> 全链只用 `@l2dp/*`（零平台依赖、确定性、可无头渲染）。这是 **LLM 创作通道 P4** 的 SDK 侧速成指南，也是宿主接线段落（§7）。
> 仓库内可运行示例：`examples/demo-p4b/scripts/run.mjs`（纯 SDK 链）、`bridge.mjs`（HTTP 服务 + provider 注入）、`bridge-llm.mjs`（真实/模拟 LLM 接线）。

## 0. 三十秒总览

```text
上传立绘 PNG      →①拆解→ 语义部件(每件=裁剪图+语义名+bbox)
                  →②创作编排→ 自修复循环(校验→修复→执行→审核)
                  →③绑定(@l2dp/rig 顺带完成)→ 合法 .l2dm + RigSpec + 质检
                  →④驱动(@l2dp/engine + @l2dp/driver)→ 动起来 + 预览帧
```

| 阶段 | 包 | 关键函数/类 |
| --- | --- | --- |
| ① 拆解 | `@l2dp/cutout` | `decodePng` `Segmenter`(ColorKey/Http/ComfyUI) `Labeler`(ColorMap/Position/LLM) `cutoutMasked` `finalizeCutout` |
| ② 创作编排 | `@l2dp/create` | `validateCreation` `RuleRepairer` `executeCreation` `RuleReviewer/LlmReviewer` `createWithSelfRepair` |
| ③ 绑定 | `@l2dp/rig` | `rigCharacter`（模板网格+参数挂接+warp 合成+顺序/物理）+ `RigSpec` |
| ④ 驱动 | `@l2dp/engine` `@l2dp/driver` | `L2dmPlayer` `SoftwareRenderer`；`StreamIngestor` `LayerStack` `EnvironmentLayer` `Evaluator` |
| 桥接（宿主） | `@l2dp/host` | `HttpSegmenter` `ComfyUIBridge` `LlmLabeler` `LlmReviewer` `buildP4cBridges` |

---

## 1. 原图与前置

- **推荐透明底 PNG**（已抠图）：拆解质量最好。不透明白底也兼容——给 `ColorKeySegmenter` 传 `background:[r,g,b]`。
- `@l2dp/cutout.decodePng(bytes)` → `RgbaImage {width,height,data(RGBA)}`；`encodePng` 可写回 PNG。
- 半自动三档（SPEC §9.2 模式 A/B/C）：
  1. **C 半自动（SDK 兜底，无依赖）**：`ColorKeySegmenter` 平坦色候选 + 手动/色板标注。
  2. **B 平台托管**：宿主分割服务 → `HttpSegmenter`（POST 图 → regions）。
  3. **A 本地重型**：ComfyUI（SAM2/LayerDiffusion）→ `ComfyUIBridge` 拿掩码图 → `maskRgbaToCandidate`。

## 2. ① 拆解（切图 + 语义标注）—— `@l2dp/cutout`

```ts
import { ColorKeySegmenter, ColorMapLabeler, finalizeCutout, decodePng } from "@l2dp/cutout";

const img = decodePng(await readFile("character.png"));    // 原图
const seg = new ColorKeySegmenter({ tol: 8, minArea: 80 }); // 透明底自动判背景
const candidates = await seg.segment(img);                  // → CandidateRegion[]（mask/bbox/color/pixels）

// 标注：色板规范 / 模板槽 / LLM 三选一
const labeler = new ColorMapLabeler([
  { color: [60, 55, 90],   semantic: "hair_back" },
  { color: [214, 188, 162], semantic: "face" },
  // ... 按你的立绘配色表补齐
]);
const parts = await labeler.label(candidates, img);         // → CutoutPart[]（每件=裁剪图+语义+bbox）

const cut = finalizeCutout(img, parts);                     // → 质检：coveragePct / overlapPct
console.log(cut.parts.length + " 件 覆盖率" + cut.coveragePct + "% 重叠" + cut.overlapPct + "%");
```

- `parts` 可直接喂给 §3（`createWithSelfRepair` 自动转成创作指令再绑定）。
- 手工微调：改 `part.bbox` / 增删 `parts` / 换 `side:"left|right"` 后重跑即可。


> ### 🎯 ColorKeySegmenter 适用域与局限性（O-6）
>
> **面向：平坦色插画**（赛璐璐/动漫风无渐变、色块边界清晰）。判定依据：候选区域为近似单色连通域（tol 内色差）。
>
> - **适合**：透明底半身立绘、扁平角色原画、色板分明的拆分图。
> - **不适合（请走宿主重型分割档）**：
>   - 实拍照片 / 厚涂 / 渐变阴影（无平坦色块 → 会拆成碎块或整片连体）；
>   - 背景复杂、前景与背景同色系（需 background:[r,g,b] 也无法稳定分离）；
>   - 交叠遮挡的多个部件（色键无法判断前后关系）。
>
> 上述情况换 **HttpSegmenter（宿主分割服务，SAM2/U2Net 等）或 ComfyUIBridge**——
> 平台托管重型档（见 §6 平台桥接），返回 mask 候选，标注层（LlmLabeler / PositionLabeler）不变。
> 判断经验：finalizeCutout 输出 coveragePct 过低 / overlapPct 过高、或部件碎片化严重时，
> 优先怀疑"色键不适用该图像"，而非只调 tol。

## 3. ② 创作编排（自修复循环）—— `@l2dp/create`

```ts
import { createWithSelfRepair, RuleReviewer } from "@l2dp/create";

const outcome = await createWithSelfRepair({
  character: "my-chan",
  image: img,
  canvas: { width: img.width, height: img.height },
  segmenter: seg,               // 或宿主 HttpSegmenter / ComfyUI
  labeler,                    // 或 LlmLabeler（LLM 语义标注）
  reviewer: new RuleReviewer(),  // 或 LlmReviewer（多模态审核）
  maxRounds: 3,                // 每轮：validate → repair → execute → review
});

if (!outcome.ok || !outcome.result) {
  console.log(outcome.log.join("\n")); // 自修复日志（哪里没通过、改了什么）
}
const { model, rig, motions } = outcome.result;
// model   = 合法 .l2dm（rig 报告已验证）
// rig.spec= 绑定审计（参数↔部件↔warp）
// motions = idle/blink/talk/surprise 基础动作（可播）
```

循环语义：`validateCreation`（词表/重复 id/bbox 越界/关键帧递增）→ `RuleRepairer`（钳置 bbox、去重 id、滤微件）→ `executeCreation`（调 `rigCharacter` + 生成动作）→ 审核（规则或 LLM）。错误结构可直接回注 LLM 修复。

## 4. ③ 绑定内部（`@l2dp/rig` 顺带完成，可单独用）

`rigCharacter(RigCharacterSpec)` 完成：
- 每个语义部件配准到语义模板网格（`packages/rig/src/vocab.ts`：12 种语义的先验顺序/默认色/网格）。
- **参数挂接**：目→`EyeBlink` 组（眼闭左/右）、口→`LipSync` 组（嘴开/嘴笑）、头→`Head` 组 warp2d（头转向/头点头）、眉→升降、发/身→物理/呼吸。
- **warp 形变合成**：眨眼上睑闭合、嘴开上下分唇、嘴角上提、发丝跟随/摆动、头转向刚体旋转（绕颈轴 `hinge`）。
- **自动绘制顺序**（后发<脸<前发…）、发丝摆锤物理、body 呼吸 scale。
- 产物：`RigSpec`（审计，可回注 LLM 修改）+ 质检报告（engine 校验 + 覆盖率统计）。

## 5. ④ 驱动—— `@l2dp/engine` + `@l2dp/driver`

```ts
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
const player = new L2dmPlayer(model, new Map());
player.play(motions.find((m) => m.name === "idle").motion);
const sw = new SoftwareRenderer();
for (let i = 0; i < 60; i++) { player.tick(16); player.render(sw); }

// JSONL 驱动栈：环境层呼吸/眨眼 + 动作叠加
import { StreamIngestor, LayerStack, EnvironmentLayer, Evaluator } from "@l2dp/driver";
const defs = model.parameters.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def, group: p.group }));
const stack = new LayerStack(defs);
const env = new EnvironmentLayer(defs, { seed: 42 });
const ing = new StreamIngestor({ manifest: { sems: defs }, library: { motions: motions.map((m) => ({ name: m.name })), expressions: [], behaviors: [] }, assets: { motions: new Map(motions.map((m) => [m.name, m.motion])), expressions: new Map() }, stack, env, seed: 7 });
const ev = new Evaluator(stack, env, defs, { apply(_ch, params) { for (const [k, v] of Object.entries(params)) player.params.set(k, v); } });
ing.feedLine('{"op":"play","asset":"idle"}', 0);
ing.feedLine('{"op":"blink"}', 500);
for (let i = 0; i < 80; i++) ev.onFrame(16);
```

## 6. 完整示例

> 可直接跑：`node examples/demo-p4b/scripts/run.mjs`（预览 PNG + .l2dm + RigSpec + report.txt）。
```bash
cd examples/demo-p4b
npm run start
```

## 7. 换真实服务 / 真实 LLM（P4 收尾接线）

```ts
import { HttpSegmenter, buildP4cBridges, ComfyUIBridge, maskRgbaToCandidate } from "@l2dp/host";
import { OpenAIProvider } from "@l2dp/driver";
const seg = new HttpSegmenter({ url: "https://seg.example/v1/cut", authToken: process.env.SEG_KEY });
// 或重型：const bridge = new ComfyUIBridge({ baseUrl: "http://127.0.0.1:8188" }); const run = await bridge.run(hostWorkflow);
//          const cands = run.images.map(async (r) => maskRgbaToCandidate(await bridge.fetchImage(r), r.filename));
const provider = new OpenAIProvider({ baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL ?? "gpt-4o" });
const { segmenter, labeler, reviewer } = buildP4cBridges({ segment: { url: "https://seg.example/v1/cut" }, llm: { provider } });
const outcome = await createWithSelfRepair({ character: "my-chan", image: img, segmenter, labeler, reviewer });
```

- 无 key 可跑的真实接线演示：`node examples/demo-p4b/scripts/bridge-llm.mjs`（SET `LLM_API_KEY` 走真模型）。
- 评估：`npm run eval`（确定性 3/3）；真实 LLM：设 `LLM_API_KEY` 后 `node scripts/eval-creation.mjs --llm`。

## 8. 调参与常见问题

| 现象 | 调法 |
| --- | --- |
| 部件拆多/拆漏 | 调 `ColorKeySegmenter({ tol, minArea })` |
| 语义标错 | 换 `PositionLabeler(slots)` 或给 `LlmLabeler` 更清晰词表/示例 |
| bbox 越界/重复 id | 交给 `RuleRepairer` 自动修 |
| 审核不过（覆盖率低） | 放大 bbox/补大件；`RuleReviewer({ coverageMin, minColors })` 调阈 |
| 预览中间态 | `SoftwareRenderer.readPixels` → `encodePng` |

**Do / Don't**：语义参数名 = 词表单一来源；LLM 目录进 IR 出；注入种子保确定性；核心库不引 ComfyUI/onnxruntime；软件光栅兜底。

## 9. 产物与导出

- `.l2dm`（自包含模型）· `RigSpec`（审计，回注用）· 预览 PNG/report（无 GPU，CI 可用）。
- 宿主侧：装配台 UI / 上传存储 / ComfyUI workflows / PSD 导出 → `docs/LLM-CREATION-PIPE-PLAN.md` P4c。

## 10. 仓库内怎么跑

```bash
npm run typecheck && npm test && npm run eval
cd examples/demo-p4b
node scripts/run.mjs | node scripts/bridge.mjs | node scripts/bridge-llm.mjs
```

## 相关文档

- `docs/LLM-CREATION-PIPE-PLAN.md` · `docs/DEVELOPMENT-SPEC.md` · `docs/SPEC-v2.0.md`(§7-10) · `docs/SPEC-DSL-v1.0.md` · README 路线图 P4a–P4c。

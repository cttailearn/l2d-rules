# @l2dp/create —— 创作编排（P4b）

「把切图结果变成可驱动模型的全链编排」：创作 IR v1 + 同源 JSON Schema + 校验 + 执行（rig + 动作生成）+ 规则/多模态审核 + 自修复循环。

- **创作 IR v1**：`{op 部件级指令?}` → 实为结构化 `CreationDirective`（parts + hinge + motions），与驱动 IR v2 并列
- **校验**：词表/重复 id/bbox 越界/关键帧递增/颜色范围（validateCreation，错误回注可修）
- **确定性修复**：RuleRepairer（钳 bbox、去重 id、滤微件、清非法关键帧）
- **执行**：executeCreation → @l2dp/rig.rigCharacter + 基础动作生成（idle/blink/talk/surprise）
- **审核**：RuleReviewer（软件渲染 rest/blink/smile 三态：覆盖/多色/头位置）+ LlmReviewer 钩子（多模态视觉审核）
- **自修复循环**：createWithSelfRepair（每轮 validate→repair→execute→review，默认 3 轮）
- **确定性默认链路**：ColorKeySegmenter + ColorMap/Position Labeler + RuleRepairer + RuleReviewer，全程无网络可复现

## 依赖与安装

- 依赖：@l2dp/engine、@l2dp/rig、@l2dp/cutout；Node ≥ 23.6；纯 ESM

```bash
npm i @l2dp/create
# 当前：npm i file:/path/to/repo/packages/create
```

## 核心 API（入口 src/index.ts）

| 模块 | 导出 |
|---|---|
| ir | `CreationDirective/CreationPart/CreationMotion`、`CREATION_IR_VERSION`(1) |
| schema | `creationDirectiveSchema()`（供 function calling/MCP 同源） |
| validate | `validateCreation(d)` → CreationIssue[] |
| execute | `executeCreation(d)` → `{ model, rig, motions, notes }` |
| motions | `generateStarterMotions(params)`、`motionFromCreation` |
| review | `RuleReviewer`、`RigReviewer` 接口 |
| loop | `createWithSelfRepair(input)` → CreateOutcome（切图→标注→修复→执行→审核全链）、`Designer`/`DesignContext`（P4 注入点：LLM few-shot 生成整条指令）、`Repairer`（同步或异步） |

## 用法

```ts
import { createWithSelfRepair } from "@l2dp/create";
import { ColorKeySegmenter, ColorMapLabeler } from "@l2dp/cutout";

const outcome = await createWithSelfRepair({
  character: "my-chan",
  image: img,                                  // RgbaImage
  segmenter: new ColorKeySegmenter({ tol: 12, minArea: 60 }),
  labeler: new ColorMapLabeler([/* 色板 */]),
  reviewer: undefined,                          // 缺省 RuleReviewer；可传 LlmReviewer
  maxRounds: 3,
});
if (!outcome.ok) console.log(outcome.log.join("\n"));
const { model, rig, motions } = outcome.result!;
// model .l2dm → engine；motions → 可播放基础动作；rig.spec → 审计
```

更贴近生产的接线（真实 LLM / HTTP 分割服务）：见 `@l2dp/host`（LlmDesigner/LlmReviewer/HttpSegmenter）与统一 demo `examples/demo-app`（「上传图像 → 构建 Live2D」面板走同一 createWithSelfRepair 全链）。

## 边界

- **LLM 幻觉只进结构化产物**（RigSpec/CreationDirective），不进像素——执行端确定性落地。
- 视觉审核（LlmReviewer）需宿主注入多模态 provider；无则走 RuleReviewer 兜底。
- 本包不做素材生成/上传/存储，那些属宿主（P4c）。

## 测试

```bash
npm test    # 13 例：validate/repair/execute/review/自修复循环/动作生成
npm run eval  # 根目录 scripts/eval-creation.mjs → creation-cases 3/3（确定性）
```

## 版本与纪律

`CREATE_VERSION` = 0.1.0。仅可擦除语法；确定性默认链路可离线回归。

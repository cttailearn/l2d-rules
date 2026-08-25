# @l2dp/host —— 宿主桥接骨架（P4c）

> 定位：把 @l2dp/cutout 的 Segmenter/Labeler 与 @l2dp/create 的 RigReviewer 接到 **真实宿主服务与 LLM** 的桥接层。
> 纪律：零平台依赖——fetch 全部可注入；ComfyUI/云分割/LLM 均为外部依赖，SDK 只给客户端/契约/提示词。

## 组成

| 模块 | 能力 | 注入点 |
| --- | --- | --- |
| http.ts | 通用 HTTP JSON 客户端（超时/非 2xx 抛错/fetch 可注入） | HttpClientOptions.fetcher |
| comfyui.ts | ComfyUI REST 桥：提交工作流 → 轮询 history → 收集图片 → 取图解码为 RGBA；maskRgbaToCandidate mask→候选 | ComfyUIOptions.fetchImpl |
| http-segmenter.ts | 宿主分割服务 Segmenter：POST {image:dataUri} → {regions:[{id,bbox,maskPng?,color?,confidence}]} | HttpSegmenterOptions.fetchImpl |
| llm.ts | few-shot 提示词 + 响应 JSON Schema（标注/审核） | — |
| llm-labeler.ts | Labeler：候选 → 提示词 → RuntimeProvider 结构化输出 → CutoutPart | RuntimeProvider（@l2dp/driver） |
| llm-reviewer.ts | RigReviewer：软件渲染帧(data URI) → 提示词 → provider 判定（多模态端点直接看图） | RuntimeProvider |
| llm-directive.ts | P4 指令清洗/主色提取/提示词：`sanitizeCreationDirective`（LLM 幻觉只进结构）、`buildDesignPrompt`/`buildRepairPrompt`、`dominantColorOfPart` | — |
| llm-designer.ts | `Designer`（@l2dp/create）：切图 → few-shot 结构化生成整条 `CreationDirective` | RuntimeProvider |
| llm-repairer.ts | `Repairer`（@l2dp/create）：校验问题回注 → LLM 修正整条指令（自修复） | RuntimeProvider |
| host.ts | buildP4cBridges：装配 segmenter+labeler+reviewer 三件套 | — |

## 用法（宿主把三件套喂给 create 的自修复循环）

```ts
import { createWithSelfRepair } from "@l2dp/create";
import { OpenAIProvider } from "@l2dp/driver";
import { buildP4cBridges } from "@l2dp/host";

const provider = new OpenAIProvider({ baseUrl, apiKey, model: "gpt-4o" });
const { segmenter, labeler, reviewer } = buildP4cBridges({
  segment: { url: "https://seg.example/v1/cut", authToken: process.env.SEG_KEY },
  llm: { provider },          // LLM 标注 + 多模态审核
});

const outcome = await createWithSelfRepair({
  character: "my-char", image, segmenter, labeler, reviewer,
});
// → model(.l2dm) + motions + RigSpec，全链可驱动
```

### P4 完整 LLM 创作通道（few-shot 生成 + LLM 自修复 + 干跑审核）

```ts
import { createWithSelfRepair } from "@l2dp/create";
import { ColorKeySegmenter } from "@l2dp/cutout";
import { LlmDesigner, LlmRepairer, LlmReviewer } from "@l2dp/host";
import { OpenAIProvider } from "@l2dp/driver";

const provider = new OpenAIProvider({ baseUrl, apiKey, model: "gpt-4o" });
const outcome = await createWithSelfRepair({
  character: "my-char",
  image,
  segmenter: new ColorKeySegmenter(),   // 或 buildP4cBridges(...).segmenter（HTTP/ComfyUI）
  designer: new LlmDesigner({ provider }),   // ① few-shot 生成整条 CreationDirective
  repairer: new LlmRepairer({ provider }),   // ② 校验问题回注 → LLM 修正
  reviewer: new LlmReviewer({ provider }),   // ③ 渲染帧多模态干跑审核
});
```

## ComfyUI（重型档 / 模式A）

```ts
const bridge = new ComfyUIBridge({ baseUrl: "http://127.0.0.1:8188" });
const run = await bridge.run(hostWorkflow /* SAM2/LayerDiffusion 工作流，宿主注入 */);
const masks = [];
for (const ref of run.images) {
  const rgba = await bridge.fetchImage(ref);            // 解码 mask
  masks.push(maskRgbaToCandidate(rgba, ref.filename));  // → 候选（接入 Labeler）
}
```

> ComfyUI 的 workflows/（SAM2 / LayerDiffusion / part_gen 模板）由宿主维护（SPEC §8），SDK 只做 REST 客户端骨架，不冻结节点名。

## LLM 消息边界（P4 红线：目录进、IR 出）

- LlmLabeler：入 = 候选目录（id/bbox/主色/像素），出 = {assignments} 结构化，cutoutMasked 落成 CutoutPart。LLM 幻觉只进结构，不进像素。
- LlmReviewer：入 = 引擎软件渲染帧 data URI（多模态端点直接看图；文本端点看提示词描述），出 = {ok,confidence,issues,suggestions}。
- 帧渲染走 @l2dp/engine 无 GPU 光栅，构建期/CI 可离线回归。

## Diagnostic / test

```bash
npm test                    # packages/host/test 13 例（mock fetch / mock provider / LLM designer+repairer）
node --test --test-isolation=none packages/host/test/*.test.ts
```

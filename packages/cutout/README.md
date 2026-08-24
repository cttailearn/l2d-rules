# @l2dp/cutout —— 半自动切图（P4b）

「把原图拆成语义部件」：PNG 编解码(fflate) + 平坦色候选选区 + 按 mask 拆部件 + 覆盖/重叠质检 + Segmenter/Labeler 注入钩子。

- **确定性兜底档（模式 C 半自动）**：ColorKeySegmenter 平坦色连通域候选（背景角点检测/容差/小碎片过滤）——无任何 ML 依赖
- **标注三选一**：ColorMapLabeler（色板规范）/ PositionLabeler（模板槽 IoU，含左右）/ LlmLabeler（LLM 语义标注，见 @l2dp/host）
- **质检**：总覆盖率 ≥98% / 重叠区 ≤2%（analyzeCutout + finalizeCutout）
- **宿主重档**：SAM2/LayerDiffusion 掩码 → maskRgbaToCandidate（@l2dp/host ComfyUIBridge）
- **零平台依赖**：PNG 编解码走 fflate；ML 由宿主注入（Segmenter/Labeler 接口）

## 依赖与安装

- 依赖：fflate；Node ≥ 23.6；纯 ESM

```bash
npm i @l2dp/cutout
# 当前：npm i file:/path/to/repo/packages/cutout
```

## 核心 API（入口 src/index.ts）

| 模块 | 导出 |
|---|---|
| png | `decodePng(bytes)` → RgbaImage、`encodePng`、`dataUriToBytes/pngToDataUri` |
| segment | `ColorKeySegmenter`、`colorKeyRegions`、`detectBackground`、`toCandidates` |
| labeler | `ColorMapLabeler`、`PositionLabeler` |
| split | `cutoutMasked`、`maskBBox`（按 mask 拆部件图） |
| qa | `analyzeCutout`、`finalizeCutout`（覆盖率/重叠质检） |
| types | `RgbaImage/CandidateRegion/CutoutPart/Segmenter/Labeler` 接口契约 |

## 用法

```ts
import { decodePng, ColorKeySegmenter, ColorMapLabeler, finalizeCutout } from "@l2dp/cutout";

const img = decodePng(await readFile("character.png"));
const seg = new ColorKeySegmenter({ tol: 12, minArea: 60 });
const candidates = await seg.segment(img);                  // → CandidateRegion[]
const labeler = new ColorMapLabeler([
  { color: [60, 55, 90],   semantic: "hair_back" },
  { color: [214, 188, 162], semantic: "face" },
]);
const parts = await labeler.label(candidates, img);          // → CutoutPart[]
const cut = finalizeCutout(img, parts);                      // 质检：coveragePct/overlapPct/issues
```

- 结果直接喂 `@l2dp/create.createWithSelfRepair`（自动转创作指令 → rig → 驱动）。
- 换真实服务：`HttpSegmenter` / `ComfyUIBridge`（@l2dp/host）实现同一 `Segmenter` 契约。

## 边界

- 面向**平坦色插画**（色块分明）；渐变/厚涂插画建议走宿主重型档（SAM2/ComfyUI/LayerDiffusion）。
- SDK 只出结构化 CutoutResult（目录进、IR 出），不生成像素级成品；像素处理归引擎/宿主。
- 确定性：同 (图像, 参数) → 同候选/同质检。

## 测试

```bash
npm test    # 7 例：PNG 编解码/色键选区/标注(色板+槽)/mask 拆件/质检/确定性
```

## 版本与纪律

`CUTOUT_VERSION` = 0.1.0。仅可擦除语法、零平台依赖（fflate 唯一运行时依赖）；语义标签对齐 specs/parts-naming.json。

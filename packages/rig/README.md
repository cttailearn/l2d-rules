# @l2dp/rig —— 半自动绑定（P4a）

「把拆好的部件图装成活模型」：PartSpec（部件图 + 语义类）→ 参数挂接 + warp 形变合成 + 自动绘制顺序/物理 → 合法 .l2dm + RigSpec + 质检报告。

- **模板网格**：12 种语义（脸/目/眉/口/鼻/耳/颈/前侧后发/上躯）各自带上网格分辨率 + 绘制顺序先验 + 默认色（vocab.ts）
- **形变合成**：眨眼眼睑闭合 / 嘴开分唇 / 嘴角上提 / 眉升降 / 发丝跟随与摆动 / 头转向刚体旋转（绕 hinge）+ 2D warp
- **自动顺序/物理**：语义先验 ×10 + 出现序号；发丝挂摆锤（pendulum-out → sway warp）；body 呼吸 scale deformer
- **输出三重**：.l2dm（自包含，纹理内嵌 atlas）+ RigSpec（可回注 LLM 修改）+ 质检报告（engine 校验 + 覆盖率）
- **确定性**：纯确定性合成，同 (spec) → 同模型；像素 golden 回归

## 依赖与安装

- 依赖：@l2dp/engine、@l2dp/convert（author 写入面）；Node ≥ 23.6；纯 ESM

```bash
npm i @l2dp/rig
# 当前：npm i file:/path/to/repo/packages/rig
```

## 核心 API（入口 src/index.ts）

| 模块 | 导出 |
|---|---|
| types | `RigCharacterSpec`、`RigPartSpec`、`RIG_SEMANTICS`(12)、`RigSpec`、`RigResult` |
| rig | `rigCharacter(spec)` → `{ model, spec, report }` |
| vocab | `RIG_TEMPLATES`（语义模板：顺序/颜色/网格/头簇）、`headClusterSemantics()` |
| warps | `eyeLidOffsets/mouthOpenOffsets/mouthSmileOffsets/browOffsets/hairHeadFollowOffsets/hairSwayOffsets/headTurnOffsets/headNodOffsets/headTurnWarp2D` |
| meshes | `makeGrid/toL2dmMesh`（网格配准） |
| params | `deriveParameters`（最小闭合参数面） |
| report | `buildReport`（质检报告） |

## 用法

```ts
import { rigCharacter } from "@l2dp/rig";

const { model, spec, report } = rigCharacter({
  id: "my-chan",
  canvas: { width: 512, height: 1024 },
  parts: [
    { id: "p_face", semantic: "face", bbox: { x: 190, y: 320, width: 132, height: 170 }, color: [1, 0.85, 0.75, 1] },
    { id: "p_eye_l", semantic: "eye", side: "left", bbox: { x: 210, y: 370, width: 38, height: 34 }, color: [0.99, 0.78, 0.66, 1] },
    // ... 目右/眉/口/发 等
  ],
});
// model = 合法 .l2dm（validateL2dmModel 通过）→ 可交给 engine L2dmPlayer / driver StreamIngestor
// spec  = RigSpec（部件↔参数↔warp 绑定审计，可回注 LLM）
// report= 质检报告（校验 + 覆盖率）
```

## 边界

- **绑定入口是 PartSpec**：切割/语义标注由 @l2dp/cutout 或宿主（ComfyUI/视觉 LLM）负责；本包只消费"部件图 + 语义类"。
- 形变是**模板合成**（预设 warp），不是 .moc3 解码——官方模型导入走 @l2dp/convert。
- 确定性合成、零平台依赖；渲染由 @l2dp/engine（软件光栅兜底）。

## 测试

```bash
npm test            # 16 例：绑定合法/顺序先验/warp 完整性/形变结构/像素 golden/异常输入/服装层/分级/自定义语义
npm run golden      # 生成 /test/fixtures/rig-golden.json 像素 golden（确定性回归基准）
```

## 版本与纪律

`RIG_VERSION` = 0.1.0。仅可擦除语法、零平台依赖；语义词表与 specs/parts-naming.json 对齐（单一来源）。

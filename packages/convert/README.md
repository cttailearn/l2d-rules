# @l2dp/convert —— 官方 Live2D 模型 → SDK 语义资产 转换层

把**既有 Live2D 官方模型**（Cubism Editor 产物）**自研转换**为 SDK 可消费的**自包含 `.l2dm` 模型产物**，全程**不依赖官方 Cubism Core**、不修改官方文件。这是「把已有模型用起来」的入口，也是「从零搭建模型」的工具链。

- **Phase 1（本包当前）**：JSON 格式链路 —— `model3.json / cdi3.json / physics3.json / pose3.json / userdata3.json / motion3.json / exp3.json`；产物 `.l2dm` **内嵌模型资源（纹理 atlas）**
- **Phase 2（`.moc3` 二进制）**：`readMoc3()` 解析容器/分节（头部/SOT/countInfo/canvas + ~90 typed array）+ `moc3ToL2dm()` 生成**真实几何 .l2dm**（顶点/UV/非索引三角/参数真实范围/绘制顺序，41 模型语料回归）—— 动画形变（warp keyform）见 [docs/MOC3-PHASE2-PLAN.md](../../docs/MOC3-PHASE2-PLAN.md)
- **Cubism 2 `.moc`**：`readMoc()` 解析旧代 Live2D（导出格式 V1_9/V1_10/V1_11，164 模型语料回归）+ `mocToL2dm()` 生成**真实几何 .l2dm（官方 runtime 逆向：绘制顶点/索引三角/UV/参数范围/部件树）**

## 定位

| | 本包做 | 不做（宿主 / 平台职责） |
|---|---|---|
| 输入 | 官方模型 **JSON** 资产 + `.moc3`（Phase 2）+ `.moc`（Cubism 2） | 渲染像素（@l2dp/engine） |
| 输出 | **自包含 .l2dm**（参数面 + 骨架几何 + 内嵌纹理）+ 转换包 + 创作/编辑工具链 | 渲染像素（@l2dp/engine） |
| 边界 | 格式转写、id 语义化、范围启发、资源内嵌 | 纹理解码/上传、内容策略、网络/fs（loader 注入） |

真实官方 motion3/exp3 的 id 是 camelCase（`ParamAngleX`），天然不在官方 `PARAM_*` 白名单 → engine compat 的语义门槛直接放行（只有旧 `PARAM_*` 轨道才被拒绝并进 warnings）。

## 依赖与安装

- 依赖：`@l2dp/l2dp`、`@l2dp/engine`（结构型）；Node ≥ 23.6；纯 ESM

```bash
npm i @l2dp/convert
# 当前：npm i file:/path/to/repo/packages/convert
```

## 核心 API

```ts
import { convertLive2dModel, toL2dmArtifact, loadL2dmObject } from "@l2dp/convert";

// 1) 转换：model3 对象 + 文件加载器（相对模型目录的路径 → text/bytes）
const r = await convertLive2dModel(model3Raw, fsLoader, { name: "Haru" });
if (!r.ok) throw new Error(r.error);

// 2) 自包含 .l2dm 产物：骨架几何 + 参数面 + 内嵌纹理（data URI）——一个文件即完整模型
const model = toL2dmArtifact(bundle, { textures: [{ file: "tex_00.png", bytes }] });
const v = loadL2dmObject(model); // engine 校验通过
```

### Cubism 2 旧代 `.moc` 转换

```ts
import { readMoc, mocToL2dm } from "@l2dp/convert";

// 1) 解析 .moc（Cubism 2 二进制）：参数 / 部件树 / 网格（顶点池/UV/索引三角/纹理）
const r = readMoc(mocBytes);
if (!r.ok) throw new Error(r.error);
console.log(r.moc.parameters.length, r.moc.meshes.length);

// 2) 基础姿态 .l2dm（真实几何；绘制顺序按 averageDrawOrder）
const model = mocToL2dm(r.moc, { id: "shizuku", textures: ["texture_00.png", "texture_01.png"] });
const v = loadL2dmObject(model); // engine 校验通过
```

> 语义同官方 runtime：`pointCount`=绘制顶点数、`indices`=索引三角（`polygonCount*3`）、`uv`=每顶点 2 个、
> `points`=位置池（base 姿态 = 前 `pointCount*2` 个坐标）；画布原点是左上、y 向下（与 `.l2dm` 一致，无需翻转）。

### Cubism 2 model.json + `.mtn` 动作（端到端驱动）

```ts
import { parseModel2, readMoc, mocToL2dm, parseMtn, mtnToEngineMotion, embedAtlasInto } from "@l2dp/convert";
import { loadL2dmObject, L2dmPlayer } from "@l2dp/engine";

const m2 = parseModel2(JSON.parse(modelJsonText));      // model.json（旧代）
const r = readMoc(mocBytes);                             // .moc 二进制
const model = mocToL2dm(r.moc, { id: m2.value.name ?? "x", textures: m2.value.textures });
embedAtlasInto(model, textures);                         // 内嵌纹理 → 自包含
const motion = mtnToEngineMotion(mtnText);               // .mtn 动作（文本）→ 引擎动作
const player = new L2dmPlayer(model, new Map());
player.play(motion.motion!);
player.tick(16);                                         // 官方动作即可驱动 .moc 模型
```

> `parseMtn`：`$fps/$fadein/$fadeout/$loop` 头 + `PARAM_X=v0,v1,…`（每帧采样）→ 引擎
> motion3 线性段；`.moc` 参数即官方 `PARAM_*` 名，与模型自身参数直接对应（不经语义门槛）。

### 从零构建 + 二次修改（author 工具链）

```ts
import { createL2dm, addPart, embedTexture, addWarp, setParamRange, attachTexture, validate } from "@l2dp/convert";
import { loadL2dmObject } from "@l2dp/engine";

// 从零：定义参数 + 部件 → 合法 .l2dm
const m = createL2dm({ id: "mascot", parameters: [{ id: "开心", min: 0, max: 1 }] });
addPart(m, { id: "body", color: [1, 0.5, 0.2, 1], mesh: /* quad */ });
embedTexture(m, "tex_00.png", pngBytes);           // 资源内嵌（自动 data URI）
attachTexture(m, "body", "tex_00.png");                  // 部件引用纹理
addWarp(m, "body", { parameter: "开心", keyforms: [...] });
setParamRange(m, "开心", -1, 1, 0);                      // 二次修改（可直接改官方转换产物）
validate(m);                                             // engine 规则 1–7 复核
```

编辑 API：`addPart / removePart / setPartOrder / setParamRange / setParamGroup / addParameter / embedTexture / attachTexture / ensureMesh / addWarp / addDeformer / addPendulum / validate`。

## 端到端示例（真实 Haru，统一 demo）

```bash
cd examples/demo-app
npm run gen:haru   # 官方 CubismCore 提取 Haru 默认姿态几何（含可见性过滤）→ public/haru-full.l2dm（自包含、内嵌纹理，~3.7MB）
npm start          # 无头：脚本化聊天 + 官方 .moc3 转换渲染对比 + 上传构建 → out/*.png + report.txt
npm run dev        # 浏览器：真实模型·转换对比面板（左=自研 .l2dm 渲染，右=官方原画）；/compare.html 与官方 Cubism SDK 并排
```

- `public/haru-full.l2dm` = 官方 Haru 整体转换 → **自包含 .l2dm**（骨架 + 内嵌两张纹理）。
- `moc3ToL2dm` 支持 `visibleArtMeshFilter`（宿主/烘焙注入运行时可见性，剔除默认隐藏的手臂/衣物层）；`buildLeftL2dm`（浏览器内实时 convertLive2dModel）见 `demo-app/src/compare-upload.ts`。
- 二次修改（`addPart/setParamRange/embedTexture/…`）与从零构建（`createL2dm`）示例见 `packages/convert` 测试与 `docs/GUIDE-FROM-IMAGE-TO-LIVE2D.md`。

## 测试

```bash
npm test    # 真实 Haru 样本全链路 + .moc 语料（164 模型解析/转换/校验）+ .moc3 语料（42 模型）回归
```

## 边界与纪律

- **零平台依赖**：纯数据层，无 fs/网络/base64 依赖（`toDataUri` 自实现）；文件读取经 `FileLoader` 注入
- **确定性**：骨架配色/布局由 id 哈希派生，同模型同输出
- **范围是第一类缺省**：Phase 1 参数范围来自 `paramRanges` 覆盖 → 启发式猜测；权威范围在 `.moc3`（Phase 2 覆盖）
- 版本：`CONVERT_SYNTAX_VERSION`（semver）
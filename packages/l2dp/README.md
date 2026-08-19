# @l2dp/l2dp —— 官方 JSON 格式与基础工具

Live2D 官方 JSON 资产（.l2dp 包 / motion3 / exp3 / manifest）的**类型、标准参数白名单、部件命名、校验与打包基元**。是 `@l2dp/engine`（引擎）与 `@l2dp/driver`（LLM 驱动）的格式层基础——本包**不含**任何运行时渲染/驱动逻辑。

- 类型：`Manifest / Part / Mesh / ParamDef / Groups / Pose / Physics / Motion / Expression` 及 `Category / BlendMode / CurveType / ExprBlend` 等
- 词表：`STANDARD_PARAMS`（32 官方参数基线）、`PARAM_GROUPS`、`BODY_TYPES / CLOTHING_TYPES`（与 `specs/standard-params.json` / `specs/parts-naming.json` 单一来源一致）
- 能力：`isStandardParam` / `parsePartId` / `buildPartId` / `validatePartId` / `validateManifest` / `assembleProject` / `packL2dp` / `unpackL2dp`

## 依赖与安装

- 唯一运行依赖：`fflate`（.l2dp 打包/解包）
- 要求 Node ≥ 23.6（原生跑 TS，零构建）；纯 ESM

```bash
npm i @l2dp/l2dp                                          # 未来 registry 发布后
npm i file:/path/to/repo/packages/l2dp                    # 当前以源码/workspace 消费
```

## 用法

```ts
import {
  validateManifest,          // (manifest, parts, meshes, params, groups?, motions?, expressions?, physics?) → { ok, issues: [{path,message}] }
  isStandardParam,           // 官方 PARAM_* 白名单判定
  buildPartId, parsePartId,
  packL2dp, unpackL2dp,      // fflate 打包/解包 (.l2dp)
  type Manifest, type Part, type Mesh, type ParamDef,
} from "@l2dp/l2dp";

// 白名单
isStandardParam("PARAM_ANGLE_X");   // true
isStandardParam("微笑");            // false（非官方 → 语义模式）

// 部件命名（单一来源）
const id = buildPartId("breast", { projectNo: "p01", costumeGroup: 2 });
// 校验
const v = validateManifest(manifest, parts, meshes, params);
if (!v.ok) console.warn(v.issues);

// .l2dp 打包/解包
const bytes = packL2dp({ "model3.json": jsonBytes(model) });
const files = unpackL2dp(bytes);
```

## 测试

```bash
npm test    # 4 例：标准参数白名单一致 / 部件命名规则 / 组装→打包→解包 / manifest 校验
```

## 版本与纪律

- 版本：`0.1.0`；仅可擦除语法（无 enum/namespace）、零平台依赖
- 与官方 SDK 的关系：类型/校验/命名是本 SDK 的**格式合同**；`.l2dp` 打包/解包是纯工具（fflate），不解释资产内容（内容策略归宿主）

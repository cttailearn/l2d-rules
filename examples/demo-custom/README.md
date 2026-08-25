# demo-custom —— 自定义语义演示（B-7）

演示 SDK 的**语义可扩展性**：任何新语义无需修改 SDK 源码即可被绑定、渲染、驱动。

**两种添加路径**（对应两个真实场景）：

| 路径 | 入口 | 说明 |
| --- | --- | --- |
| ① rig 层运行时注入 | `rigCharacter({ customTemplates })` | 调用方传 `Record<语义, RigTemplateLike>`，运行时合并进模板表（custom 优先，可覆盖内置）；新增语义直接可渲染 + drive 驱动 |
| ② 创作路径 | `executeCreation({ customTemplates, parts }) ` | LLM/IPA 产出 `CreationDirective` 时声明 `customTemplates` 与部件 `customParams` → 校验/绑定/渲染全链打通（含服装语义 `outfit_dress` 等） |

**自定义语义模板字段**：`zh` 中文名 / `order` 绘制顺序先验 / `headCluster` 是否随头 / `color` 缺省色 / `grid` 网格分辨率 / 可选 `drive.id`（在部件 `customParams` 声明该参数后自动挂摆动 warp）。

## 运行

```bash
npm start    # ① 披风/翅膀/光环运行时注入 + ② 创作路径(自定义+服装) → out/*.l2dm + report.txt
npm test     # 2 例：注入语义可渲染/drive 可见；创作路径自定义+服装全链
```

## 链接
- rig 扩展点：packages/rig（types `RigTemplateLike` + rig.ts `customTemplates`）
- 创作 IR 透传：packages/create（ir.ts `CreationDirective.customTemplates` + execute.ts 转发 + validate.ts 识别）
- 计划文档：docs/REVIEW-OPTIMIZATION-PLAN.md §5 B-7

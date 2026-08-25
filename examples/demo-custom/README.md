# demo-custom —— 自定义语义 + 完整全链示例（B-7）

一把演示 SDK 的**语义可扩展性** + **完整能力栈**：任意新语义无需修改 SDK 源码即可走通
「图 → 可动角色 → 驱动动画」。

## 完整链路

```
图(内存立绘) --cutout--> 候选/标注(含自定义语义) --create--> CreationDirective.customTemplates
                                                              | executeCreation
                                                              v
                                     rig.customTemplates 运行时注入（cape/halo/翅膀）
                                     --driver--> JSONL 流式 + 环境层 --engine--> 动画帧序列
```

## 六段演示（run.mjs）

| 段 | 内容 | 证明什么 |
| --- | --- | --- |
| 0 | customTemplates 注册 cape/wing/halo 三个全新语义 | 运行时注入，无源码改动 |
| 1 | ColorKeySegmenter 切图 + ColorMapLabeler 标注（把色块标到自定义/服装语义） | 「从图」路径能产出自定义语义 |
| 2 | CutoutPart → CreationDirective（含 customTemplates）→ executeCreation | 校验/绑定/执行全链接受自定义+服装语义 |
| 3 | rigCharacter 直连注入（cape 带 drive: 披风飘） | 自定义语义直接可绑定 + 可驱动 |
| 4 | 4 条 JSONL（play/set 披风飘/set 翅膀扇/blink）+ 环境层 → 24 帧动画 | 自定义语义参数被真实驱动成可见动画 |

## 运行

```bash
npm start   # 输出 out/20-from-image.l2dm + out/anim/frame_00..11.png + report.txt；打印确定性/动画有效性
npm test    # 3 例：注入语义可驱动 / 创作路径自定义+服装 / 驱动全链(帧序列+确定性)
```

## 自定义语义模板字段（RigTemplateLike）

zh(名) · order(绘制顺序先验) · headCluster(是否随头) · color(缺省色) · grid(网格) · 可选 drive.id(在部件 customParams 声明该参数后自动挂摆动 warp)。

## 链接
- rig 扩展点：packages/rig（types RigTemplateLike + rig.ts customTemplates）
- 创作 IR 透传：packages/create（ir.ts / validate.ts / execute.ts）
- 向导：docs/GUIDE-FROM-IMAGE-TO-LIVE2D.md §9.5
- 计划：docs/REVIEW-OPTIMIZATION-PLAN.md §5 B-7

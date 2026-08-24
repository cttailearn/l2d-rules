# demo-multi-body —— 更多部位 + 非标准部位演示（A1｜S3 联动）

展示自研引擎/rig 的关键差异化价值：**任意多部位 + 自定义语义参数**（SPEC 目标 G2）。

- 模型 = **33 部件**：身体层 20 语义（脸/目/眉/口/鼻/耳/颈/前后侧发/上躯/下躯/臂/腿/足/胸/阴部/颊）+ **非标准部位**（尾巴/兽耳/翅膀）
- 语义驱动：`play 尾巴摆 / 翅膀扇 / 耳朵动` + `set 脸红`（hoho 部件 opacity 显隐）+ 环境层（呼吸/眨眼/视线/重心）叠加
- 双端：无头 Node（软件光栅出 PNG + 确定性 sha256）与自动化断言（像素级）

## 运行

```bash
npm start    # 无头：rig 33 部件 → 直驱帧(rest/tail/wing/ear/blush) + JSONL 驱动 → out/*.png + report.txt
npm test     # 3 例：非标准部位加载 / 参数驱动像素(确定性) / JSONL 驱动 tail_wag+环境层
```

## 产物（out/）

| 文件 | 内容 |
| --- | --- |
| 01-multi-body.l2dm | 自包含模型（33 部件 / 19 参数，含尾巴摆/翅膀扇/耳朵动/脸红） |
| 10-rest~14-blush.png | 直驱帧：静止 / 尾巴摆 / 翅膀扇 / 耳朵动 / 脸红 |
| 20-jsonl-drive.png | JSONL 语义驱动（tail_wag + blink + 环境层）帧 |
| report.txt | 各帧 sha256 + 确定性参考 + 参数面/摆锤统计 |

## 链接

- 更多部位支持要求（词表/模板/形变）：docs/REVIEW-OPTIMIZATION-PLAN.md §5（B-1/B-2/B-4 已完成）
- rig 包：packages/rig；引擎渲染：packages/engine；驱动栈：packages/driver

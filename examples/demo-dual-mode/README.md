# demo-dual-mode —— 双模式校验对照（A3）

同一条**含坏行**的指令流，两种消费模式的行为对比（SPEC §7 双模式）：

| 模式 | 入口 | 行为 | 示例结果 |
| --- | --- | --- | --- |
| 在线流式 | `StreamIngestor.feedLine` | 行级原子、坏行隔离不阻塞，好行逐行生效 | applied=2，skipped line1(RANGE) |
| 离线整批 | `StreamIngestor.feedBatch` | 整批原子校验，任一坏行整批拒绝（含行号） | applied=0，skipped [line1 RANGE] |

- **共享同一套校验规则库**（7 类 + IR 专属 + 干跑），只是执行策略不同（C12 保证规则库与 JSON Schema 同源）
- 批内合法子集可独立通过（bad line 是唯一原因）

## 运行

```bash
npm start    # 三态输出：在线隔离 / 离线拒绝 / 子集通过 → out/report.txt
npm test     # 3 例：隔离 / 原子拒绝 / 规则库共享
```

## 链接
- 实现：packages/driver/src/stream/ingestor.ts（feedLine/feedBatch）+ validate/batch.ts + validate/inline.ts
- 计划文档：docs/REVIEW-OPTIMIZATION-PLAN.md §4 A3

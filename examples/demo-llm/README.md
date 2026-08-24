# demo-llm —— 真实/模拟 LLM 驱动演示（A4）

展示**两跳架构**（SPEC §9）：第一跳本地规则 <50ms 不进 LLM，第二跳 LLM 异步决策（JSONL 出）。

- **真实 LLM**：设 `LLM_API_KEY`（+可选 `LLM_BASE_URL` / `LLM_MODEL`）→ OpenAIProvider（native 结构化输出，自动带 IR 同源 JSON Schema）
- **无 key 兜底**：缺省 MockProvider（确定性，CI 可跑）
- **可观测**：hop 1/2、behaviorId、注入行数、llmCalls（第一跳命中不计）、audit 日志（每条投喂行）

## 运行

```bash
npm start              # mock：case1 greeting/hop1, case2 tailwag/hop1, case3 闲聊/hop2, case4 listen/hop1
LLM_API_KEY=xxx node scripts/run.mjs   # 真实 OpenAI 兼容端点
npm test               # 3 例：第一跳不进 LLM / 第二跳注入 / mock 确定性
```

## 链接
- 两跳实现：packages/driver/src/twohop/engine.ts（dispatch hop1/hop2 + audit + needsSlowPath）
- Provider：packages/driver/src/provider/{types,openai,mock,fallback}.ts
- 计划文档：docs/REVIEW-OPTIMIZATION-PLAN.md §4 A4

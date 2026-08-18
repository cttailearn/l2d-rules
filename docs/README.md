# 文档索引

| 文件 | 说明 |
|---|---|
| [SPEC-DSL-v1.0.md](SPEC-DSL-v1.0.md) | **本 SDK 唯一权威规范（确认版，开发以此为准）**：融合分工架构（LLM 决策 + author 表达 + 程序化环境）、扁平指令 IR、分层求值、JSONL 流式驱动 + 双模式校验、环境层、LLM 通道（驱动主/创作辅）、校验器、评估集、决策记录。取代已删除的 SPEC-DSL-v0.1 / DESIGN-v0.2 / DESIGN-v3.0 |
| [DEVELOPMENT-SPEC.md](DEVELOPMENT-SPEC.md) | **完整开发文档（智能体可执行版）**：自研引擎（路线 C：.l2dm 格式/变形/双渲染后端）+ LLM 驱动核心（JSONL 流/扁平 IR/分层求值/环境层/双模式校验/Provider/两跳）+ 里程碑 M0–M7 + 参考项目映射。**开发以此执行** |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **SDK 边界规格**：大脑/宿主分界、宿主注入接口（ParameterSink 等 8 个 + StreamIngestor/AffectSignalSource）、设计红线、版本策略、与 live2d-forge 的迁移说明 |
| [SPEC-v2.0.md](SPEC-v2.0.md) | 平台主规格（参考）：其中 10.3 参数求值管线与 6.2 字段规格是本 SDK 求值/类型的对齐基准 |
| [haru模型对照分析.md](haru模型对照分析.md) | 官方 Haru 示例结构对照：编译目标对齐基准、参考词表实证（32 标准参数表、双服装组范式） |
| ../specs/ | 机器可读数据：standard-params.json（官方参数白名单）、parts-naming.json（命名单一来源） |

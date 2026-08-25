# demo-capabilities —— P6 驱动与场景能力演示

这个 demo 用一个最小可读模型，把新增的 SDK 能力集中展示为可运行产物：

- `generateManifest`：模型参数面 → driver 词表 manifest
- `generateLibraryIndex`：动作/表情资产 → 引用校验索引
- `buildBehaviorIndex`：第一跳行为目录 + seed/weight 加权选择
- `driverToolCatalog`：IR schema 同源 MCP 工具清单
- `phonemeToViseme` / `estimateSpeechTimeline`：音素、口型与韵律
- `SceneStage`：两个角色 + 背景 + z-order 的无头场景合成

## 运行

```bash
npm start
npm test
```

产物写入 `out/`：

- `scene.png`：双角色场景帧
- `report.json`：manifest、第一跳、MCP、TTS、像素哈希统计

这个 demo 不调用网络，不需要 `LLM_API_KEY`，适合本地验收和 CI 回归。

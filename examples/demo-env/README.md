# demo-env —— 环境层专项演示（A2）

「角色一直活着」：**不喂任何 play/face/set，角色也恒动**——呼吸/眨眼/视线微动/重心 1/f 噪声 + emote 调制。
环境层是 SPEC 的差异化底座（§6：程序化 ambient，1/f 粉噪声是"生命签名"），本 demo 把它从测试可见变成肉眼可见。

- 呼吸（Ambient 组）、眨眼（EyeBlink 组）、视线微动（Head 组）、重心（Body 组）——按组管辖，不写 Custom（防与显式动作冲突）
- emote 调制：arousal↑ → 呼吸浅快幅度↑；valence↓ → 呼吸下探更深（深缓）
- 确定性：同 (seed, emote) 同轨迹，可回归

## 运行

```bash
npm start    # 静默 12s 环境层统计 + emote 三态对比 + 渲染帧 out/10-env-alive.png + report.txt
npm test     # 3 例：恒动 / emote 调制 / 确定性
```

## 链接

- 驱动实现：packages/driver/src/layers/environment.ts（Voss-McCartney 1/f 噪声、二阶 emote 平滑、blink 状态机）
- 规范：docs/SPEC-DSL-v1.0.md §6；计划文档 A2

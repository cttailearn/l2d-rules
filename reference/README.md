# reference/ — 自研引擎算法参考（路线 C）

> 本目录克隆两个开源项目作为**自研类 Live2D 引擎的算法参考**。
> **不进 Git 仓库**（`.gitignore` 已排除）。许可：Iki = MIT；Ayagami = MIT/Apache2 双许可。
> 用途：参照其网格形变/参数驱动/物理实现，**自研引擎自主实现**（借鉴思路不复制代码，注意保留各自版权/许可声明）。

## 为什么选这两个

| 项目 | 参考价值 | 与我们的架构映射 |
|---|---|---|
| **Iki** (TS/WebGL2) | 纯 TS、宿主无关、参数驱动、开放 `.iki` 格式 | `ParameterStore` ≈ 我们的 **ParameterSink 写入面**；`player` ≈ 求值循环；`warp/deform` ≈ 网格形变核心 |
| **Ayagami** (Rust/wgpu) | 从零（黑盒逆向）实现 MOC3、driver 计算形变、物理/姿态 | `driver/` ≈ 形变求值器；`file/` ≈ 模型解析；`physics.rs/pose.rs` ≈ 物理与姿态 |

## Iki 关键文件 → 自研引擎设计要点

```
packages/engine/src/
├─ parameter-store.ts  参数集（set/get/normalized/reset）→ 我们 ParameterSink 的目标接口
├─ deform.ts           顶点变形（LBS 线性蒙皮）
├─ warp.ts             ★ 核心：参数插值偏移 keyform 累加（rest + Σ 关键帧插值偏移）
│                        - accumulateKeyformOffsets: 1D 参数→偏移线性插值
│                        - accumulate2DKeyformOffsets: 2D 参数网格双线性插值（转头核心）
│                        - applyWarps: rest 复制 + 逐 warp 查参数累加（确定性、无分配）
├─ warp-grid.ts        空间网格双线性采样（与参数插值区分）
├─ player.ts           IkiPlayer：加载模型→逐帧求值→渲染入口
├─ idle-motion.ts      自动眨眼/呼吸/视线漂移（宿主无关驱动）
├─ physics-motion.ts   物理运动
└─ hair-chain-motion.ts 头发链动力学
packages/format/src/   .iki 开放格式 schema + validator（types/parameters/validate）
packages/mcp/          已有 MCP server 包（原生 LLM 驱动实证）
```

## Ayagami 关键文件 → 自研引擎设计要点

```
ayagami/src/
├─ core.rs             模型格式无关 trait（core 抽象，支持扩展新格式）★ 多部位扩展的关键
├─ file/               MOC3 二进制解析（黑盒逆向，结构体数组 SoA）
│   ├─ classes.rs       文件对象高维描述（自动生成访问器）
│   └─ model.rs         原始数据 → 高层 trait 桥
├─ driver/             参数 → 最终 ArtMesh 形变计算（插值/外推/deformer 链）★ 求值核心
│   ├─ mod.rs
│   └─ deformer.rs      Rotation/Warp deformer
├─ physics.rs          摆锤物理（输入参数→输出参数）
├─ pose.rs             姿态（部件联动，如手臂）
└─ lib.rs
ayagami-render/        wgpu 参考渲染器（跨 Vulkan/DX/Metal/OpenGL/WebGL/WebGPU，支持离屏）
```

## 建议的参考阅读顺序（自研引擎起步）

1. `iki/packages/engine/src/parameter-store.ts` — 参数面（5 分钟，先理解"引擎被谁驱动"）
2. `iki/packages/engine/src/warp.ts` — 网格形变核心（核心算法，建议精读）
3. `iki/packages/format/src/types.ts` — 开放模型格式（决定我们自研格式的形状）
4. `iki/packages/engine/src/player.ts` — 加载/逐帧/渲染循环（搭骨架）
5. `ayagami/ayagami/src/driver/deformer.rs` — 对照 deformer 链实现（看另一种更接近 Live2D 的做法）
6. `iki/packages/engine/src/idle-motion.ts` — 环境层（呼吸/眨眼/视线）参考

## 更新

- 参考仓库如需更新：`cd reference/iki && git pull`（同样的方法 ayagami）
- 注意：iki 是 shallow clone（--depth 1），无历史；如需完整历史去掉 depth 重新克隆

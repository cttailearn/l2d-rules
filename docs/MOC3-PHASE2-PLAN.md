# .moc3 二进制导入 · Phase 2 实施计划

> 现状：`@l2dp/convert` 已完成 **Phase 1（JSON 格式链路）**——model3/cdi3/physics3/pose3/userdata3/motion3/exp3 全部打通，
> 产出**自包含 .l2dm**（参数面 + 占位几何 + 内嵌纹理 atlas）+ 从零构建/二次修改工具链（`createL2dm` / 编辑 API）。
>
> 本篇是 **Phase 2（独立里程碑）**：解析 `Haru.moc3`（官方二进制，未公开格式），把**真实几何/形变/绘制顺序/参数范围**写入 `.l2dm`，让官方模型在 SDK 引擎里像素级可渲染。

## 1. 为什么需要 .moc3（Phase 1 缺什么）

| 数据 | 在 JSON 里？ | 在 .moc3 里？ | 影响 |
|---|---|---|---|
| 参数 id / 部件 id | ✅ cdi3 | ✅（权威） | Phase 1 已用 cdi3 |
| **参数 min/max/default** | ❌ | ✅ | Phase 1 靠启发式猜测 → Phase 2 换成真实值 |
| **ArtMesh 网格（顶点/UV/索引）** | ❌ | ✅ | Phase 1 是占位色块 quad |
| **Warp 形变 keyform（顶点偏移）** | ❌ | ✅ | 官方表情/动作的正确形变 |
| **deformer 树 + 绘制顺序（draw order）** | ❌ | ✅ | 部件层级与遮挡 |
| **ArtMesh 透明度（opacity）** | ❌ | ✅ | 部件可见性 |
| 纹理 | ✅ 文件 | 引用 | Phase 1 已内嵌进 .l2dm atlas |

**结论**：要「官方模型整体转换后能真实渲染」，.moc3 解析是必经之路。做完 Phase 2，官方模型 → `.l2dm` 的几何质量从「占位可渲染」升级到「等价官方渲染」。

## 2. 开源参考资料（GitHub 实证检索，2026-02）

经 `api.github.com/search/repositories` 实证（star 数为检索时刻值；**许可证需克隆后核实，勿直接复制代码**——仅作格式/算法对照）：

| 仓库 | star | 用途 | 链接 |
|---|---|---|---|
| **Eikanya/Live2d-model** | ~3.3k | Python 全家桶：读 model3 / moc3（参数、ArtMesh、warp、deformer），社区最主流的 moc3 解析参考 | https://github.com/Eikanya/Live2d-model |
| **SakuraMotion/PurismCore** | ~24 | 「open source, Live2D-compatible runtime for loading MOC3 files」——直接断言 MOC3 可自研运行时加载 | https://github.com/SakuraMotion/PurismCore |
| **OpenL2D/moc3ingbird** | ~98 | CVE-2023-27566（Live2D moc3 内存只读 OOB）研究仓库，包含 moc3 内部块/引用布局的逆向分析 | https://github.com/OpenL2D/moc3ingbird |
| **LitStronger/live2d-moc3** | ~96 | 直接加载新版 moc3 游戏角色（碧蓝航线），含浏览器侧解析 | https://github.com/LitStronger/live2d-moc3 |
| **HCLonely/Live2dV3** | ~62 | 网页中加载 moc3 模型的封装 | https://github.com/HCLonely/Live2dV3 |
| **moeru-ai/airi** | ~48k | 大规模 Live2D/TTS/数字人框架（架构参考，非解析库） | https://github.com/moeru-ai/airi |
| **wan-h/awesome-digital-human-live2d** | ~2.4k | 数字人+Live2D 生态清单（发现更多参考） | https://github.com/wan-h/awesome-digital-human-live2d |

> 补充：官方 `CubismCore` 是闭源二进制，官方 SDK 源码在 Live2D 专有许可下——**本方案不引用官方 Core、不复制官方 SDK 代码**，只用上述开源项目做「格式逆向」的实证对照，代码自行实现（与 `@l2dp/*` 的零平台依赖纪律一致）。

## 3. .moc3 已知结构（基于社区逆向 + 本地 Haru.moc3 探针）

对 `examples/demo-real/assets-src/haru/Haru.moc3`（384,704 字节）的初步观察（`.scratch-probe.mjs` 探针发现：参数 id 字符串区约 0x7900–0x7f00 环比，`u32==42`（参数数）多处命中，与 cdi3 参数数一致）：

- **大端表驱动**：moc3 不是文档直读格式，而是「计数 + 记录偏移表 + 引用表」，记录多为 16 字节对齐的 u32/f32 混合；
- **关键表**：`Counts`（参数/部件/绘制顺序/ArtMesh/deformer/插件数）→ `Id` 偏移表 → 各记录块；
- **字符串区**：参数/部件 id 为 ASCII（改版前）或偏移+UTF8（新版），`Haru` 样本为 ASCII；
- **验证路径**：把解析出的 id 集合与 cdi3 参数/部件集合做**全等断言**——这是阶段 DoD 的天然门禁（cdi3 42 参数 / 20 部件，与探针 `u32==42` 呼应）。

## 4. 里程碑拆解（每步 DoD 可测）

| 步 | 交付 | 状态 |
|---|---|---|
| M0 | 容器/计数/canvas：`moc3/container.ts` + `moc3/moc3.ts`（头部/SOT(160)/countInfo(23)/canvas） | ✅（2026-08；`readMoc3`） |
| M1 | id 串块：参数/部件/ArtMesh id（STR64 固定 64B） | ✅（Haru 42 参数 == cdi3 全等；41 模型语料回归） |
| M2 | 参数记录：min/max/default 注入 .l2dm（替换启发式） | ✅（`moc3ToL2dm`） |
| M3 | ArtMesh 几何：顶点/UV/非索引三角 + 画布贴合 + y 翻转 + 绘制顺序 | ✅（真实 .l2dm 通过 engine 校验 + 浏览器真实几何渲染 e2e） |
| M4 | deformer 树 + 部件父级接线 → `.l2dm.deformers`（rotation binding 解析工具就绪，实验性开关） | ✅ deformer 树/父级（2026-08）｜warp/rotation keyform 顶点偏移见「M4 尾随」 |
| M5 | 整合 + 像素级 golden 对照 | ✅（examples/demo-real/scripts/golden-moc3.mjs：引擎渲染（关键帧形变烘焙 .l2dm）vs 官方 CubismCore，同光栅化器逐像素对照，key/插值态 0.001%–0.145% 像素差） |
| M6 | 多模型样本 + 回归 + 文档 | ✅（41 模型 moc3 回归 + **164 模型 .moc(Cubism2) 回归**） |
| M7 | **Cubism 2 `.moc`（旧代）**：`readMoc()`（官方 runtime 逆向：对象流/引用缓存/字符串/网格）+ `mocToL2dm()` 基础姿态（164/164 parse→convert→validate） | ✅（2026-08；新里程碑） |

> 样式纪律：moc3/.moc 模块仍是「纯数据层、零平台依赖、确定性」；`Uint8Array`/`DataView` 可注入——保证浏览器与 Node 同一进制输出。

## 7. Cubism 2 `.moc`（2026-08 新增里程碑）

旧代 Live2D（导出格式 V1_9/V1_10/V1_11）二进制 `readMoc()`：
- **官方 runtime 逆向**（`examples/live2d/js/live2d.js` 的 `_\$fP`(大端 varint) / `St._\$4b`(对象 dispatch) / `G._\$9o`(类型→类) / `$t._\$F0`(Mesh) / `W._\$F0`(基础) / `_\$Jb`(对象引用缓存, 33=REF)），并**修正了 rust live2d-parser 的两处方言偏差**：Affine reflect 为 1 字节 u8、Parameter 顺序为 min,max,default；以及最关键的 **Mesh 布局**（rust 版从未解析成功过：缺基础段 GS/int32/双裸数组）。
- 语义：`pointCount`=绘制顶点数、`indices`=索引三角（`polygonCount*3`）、`uv`=每顶点 2 个、`points`=位置池（base 姿态 = 前 `pointCount*2`）；画布左上原点 y 向下（与 `.l2dm` 一致）。
- 语料：**164/164 真实 `.moc` 全解析 → `mocToL2dm()` → engine 校验通过**（`packages/convert/test/moc.test.ts`）。

## 8. M4 尾随（边界，需地面真值）

- **rotation deformer keyform → `.l2dm.warps`**：deformer origin 坐标系（≠顶点单位，实测 `-53.72` 等）无法离线验证 → 仅以 `rotationBindings` 实验性开关输出，默认关闭避免虚假旋转。
- **warp（curved-surface）deformer 网格形变**：需官方网格插值算法；`.l2dm.warps/warp2d` 导出待实现。
- **M3 顶点口径（已闭合，官方 Core 3.3 实证）**：`art_mesh.vertex_counts` = **索引数**（mesh0 243 == 官方 indexCounts），`art_mesh.position_index_counts` = **显示顶点数**（mesh0 54 == 官方 vertexCounts）；`position_index` 段即**真实索引缓冲**（值=本地显示顶点索引，与官方 indices 仅每三角形绕序相反 → 引擎空间翻转校正）。显示顶点基态：多数网格 = 自身 art_mesh rest keyform（池搜索拟合 RMSE≈0–0.003）；少数基态由父链合成（warp 位移参考待基准），像素级精确由构建期官方烘焙提供（gen-deform.mjs）。

## 9. C2 收尾：keyform 形变管线（warp 动画）

- convert/moc3/deform.ts：从 .moc3 还原「自身 art_mesh keyform 插值 + warp（curved-surface）位移场 + 链式合成」，烘焙为 .l2dm.mesh.warps（每 Mesh 每参数 keyform 偏移，engine accumulateKeyforms 驱动）。
  - warp 位移场（黑盒验证）：Δ(u,v) = 双线性(当前网格,u,v) − 双线性(rest 网格,u,v)，u,v = 顶点坐标在 rest 矩形内归一化；与官方 Core 位移同向全中（mesh2 37/37）。自身 keyform 源位置与官方 rest 仿射一致（RMSE≈0–0.003）。
  - rotation deformer 为实验性（多绑定 origin/角映射未逐模型验证 → deformRotation 显式开启，缺省关闭，同 M4 哲学）。
- 构建期官方烘焙：examples/demo-real/scripts/gen-deform.mjs 用官方 Core 逐参数关键帧提取精确形变体积 → out/haru-anim.l2dm（引擎插值 == 官方渲染）；npm run gen:deform。
- M5 golden：examples/demo-real/scripts/golden-moc3.mjs（同光栅化器，引擎 vs 官方逐像素，阈值 <2%，当前 0.001%–0.145%）。
- 技能：skills/live2d-drive.md 随包交付「模型驱动 live2d」用法。

## 5. 边界与授权

- 只读官方 `.moc3`（用户自有/合法获得的模型文件），**不重新分发**官方模型与官方 SDK 代码；
- 输出 `.l2dm` 是我们自己的开放格式（语义参数 + 自定义几何），AI 可生成、可再编辑；
- 若用户模型文件自带 Live2D 发行限制，转换仅限本地使用（不做版权规避判断——内容政策归宿主 `ContentPolicy`）。

## 6. 本次已落地（Phase 1 依赖面，供 M2–M5 无缝接管）

- `engine`：`.l2dm` 新增 `atlas`（内嵌资源，data URI）✅
- `@l2dp/convert`：`ConvertedParam` 已预留 `min/max/def`（paramRanges 覆盖优先 → 启发式兜底）✅
- `skeleton`：占位网格 + pose + 摆锤近似 ✅（Phase 2 以真实几何整体替换 parts）
- 真实样本：`examples/demo-real/assets-src/haru/*`（官方 Haru sample，40MB 内）✅
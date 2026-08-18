# DEVELOPMENT-SPEC：自研 Live2D 类引擎 + LLM 驱动 —— 完整开发文档（智能体可执行版）

> **本文档是"交由智能体进行完整开发"的唯一执行依据**。人类可读、机器可执行。
> 范围：**自研引擎（路线 C）** + **LLM 驱动核心** + **对应完整功能**。从零到端到端可运行。
> 依据：`SPEC-DSL-v1.0.md`（融合分工架构/JSONL 流式/扁平 IR/环境层）、`reference/`（算法参考 Iki/Ayagami）、`ARCHITECTURE.md`（SDK/宿主边界）。
> 路线：**不依赖 Live2D Cubism Core、不绑定 PARAM/PARTS 白名单、原生支持大模型驱动、可无头渲染**。
>
> 开发纪律（继承）：TypeScript strict + 仅可擦除语法、零平台依赖核心、确定性一等公民（种子化时钟/随机）、每阶段 DoD = typecheck 全绿 + 测试全绿 + 确定性回归。

---

## 0. 本文档使用说明（先读）

- **给智能体**：按「§4 里程碑」的 M0→M7 顺序执行，每阶段看对应章节的"内容/文件/DoD"。以"验收"为准，不要臆造未要求的功能。写代码前先读 §5–§11 的接口与格式合同。
- **给人类**：§1 总览、§2 架构、§12 决策记录足够理解全貌。
- **代码位置**：全部新增在 `packages/engine`（自研引擎）与 `packages/driver`（LLM 驱动），复用 `packages/l2dp`（格式/校验基元）与 `packages/dsl`（语言 A 编译）。
- **参考**：`reference/iki`（TS 引擎），`reference/ayagami`（Rust 引擎）。许可：借鉴思路、不复制代码。
- **最终验收 Demo**（M7）：用户/智能体向系统发送 JSONL 流（或自然语言经 LLM 转 JSONL），自研引擎中的模型实时做出动作/表情/口型（环境层+动作层+表情层，override 最高），浏览器可看、Node 无头可录、确定性可回归测试。

---

## 1. 项目总目标与架构原则

### 1.1 目标（为什么自研）
| # | 目标 | 承载 |
|---|---|---|
| G1 | 绕过 Live2D Cubism Core 专有许可 | 自研格式 + 自研形变/渲染，零闭源依赖 |
| G2 | **支持更多身体部位**（无官方 PARAM/PARTS 白名单上限） | 开放模型格式 + 语义参数即引擎参数（无隐藏/无映射丢失） |
| G3 | **原生支持大模型驱动**（LLM 是第一公民，非后期适配） | JSONL 流 + 扁平 IR + 分层求值 + ParameterSink 内建 |
| G4 | 可无头渲染（CI/服务端/录像） | 双渲染后端：软件光栅 + WebGL2 |
| G5 | 确定性可测 | 种子化时钟/随机，同 (流, 模型, 种子) → 逐帧一致 |

### 1.2 架构原则（继承 SPEC-DSL-v1.0）
- **融合分工**：LLM 决策（选行为/表情）+ author 资产表达 + 程序化环境层。
- **LLM 是决策者，不是感知器**：情绪来自可观测信号 + 确定性动力学，不靠 LLM 主观猜。
- **双模式**：在线=JSONL 逐行流（行级原子、坏行隔离）；离线=整批原子校验（固化）。
- **语义层是契约**：DSL 正文只说语义名；官方格式只出现在导入映射。自研引擎中**语义参数直接等于引擎参数**。
- **宿主无关**：ParameterSink 只写不回读；引擎不关心谁在驱动。

---

## 2. 系统架构

```
┌─────────────────────── 意图/驱动层（LLM / 人工 / 事件）──────────────────────┐
│  自然语言 → LLM → 决策（选库行为+表情）→ JSONL 流（在线）/ 整批 IR（离线固化）   │
│  或人工直接写 JSONL / behavior.ldsl（编译为 IR）                              │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               ▼
┌─────────────────────── packages/driver（LLM 驱动核心）───────────────────────┐
│  StreamIngestor（逐行快校验→分层路由）                 Validator（双模式规则库） │
│  LayerStack（动作/表达/override/环境 + 优先级/打断/时钟）                        │
│  EnvironmentLayer（呼吸/眨眼/视线/重心 + 1/f 噪声，emote 调制）                 │
│  Evaluator（每帧合成 → param 表）                    Provider（native/grammar/text）│
└───────────────┬──────────────────────────────────────────────────────────────┘
                ▼ ParameterSink（每帧 param 表）
┌─────────────────────── packages/engine（自研引擎）───────────────────────────┐
│  Format（.l2dm 模型 schema/loader/validator）        Runtime（ParameterStore） │
│  Deform（Warp 网格形变 / 变换层级）                  Physics（摆锤/发丝/胸）    │
│  Player（加载→逐帧求值→输出）                         Render：SoftwareCanvas  │
│                                                      + WebGL2Renderer        │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               ▼
                   宿主（live2d-forge / 编辑器 / 无头录像器）
```

**复用现有包**：
- `packages/l2dp`：官方 JSON 类型（motion3/exp3/manifest/parts/params）、白名单、命名、.l2dp 组装。供「导入兼容层」与 DSL 产物消费。
- `packages/dsl`：语言 A 编译（.ldsl → motion3/exp3/manifest 缓存）。供资产创作。
- `packages/renderer`：其软件光栅（SoftwareCanvas）、曲线采样（anim）、形变基元（deform）、摆锤（physics）算法迁入/参考进 `packages/engine` 后，renderer 作为"旧预览器"退役（见 M6）。

---

## 3. 包与文件结构（目标状态）

```
packages/
├─ l2dp/       (复用) 官方类型/校验/命名/组装
├─ dsl/        (复用) 语言 A 编译
├─ engine/     (新，自研引擎)
│  ├─ src/
│  │  ├─ index.ts
│  │  ├─ format/
│  │  │  ├─ types.ts        # .l2dm 模型类型（见 §5.1）
│  │  │  ├─ validate.ts     # .l2dm 校验（引用完整性/形变/顶点）
│  │  │  └─ loader.ts       # JSON → 模型对象（含 atlas 引用）
│  │  ├─ runtime/
│  │  │  ├─ parameter-store.ts  # 参数集（set/get/normalized/reset）
│  │  │  ├─ hierarchy.ts        # part/deformer 变换层级（local→world）
│  │  │  └─ deform.ts           # Warp 网格形变（§5.4）
│  │  ├─ physics/
│  │  │  └─ pendulum.ts          # 摆锤物理（输入参数→输出参数）
│  │  ├─ render/
│  │  │  ├─ software.ts          # 软件光栅（无头/CI，迁移自 renderer）
│  │  │  ├─ webgl2.ts            # WebGL2 渲染器（浏览器）
│  │  │  └─ sink.ts              # RenderSink 接口（Software/WebGL 双实现）
│  │  ├─ player.ts                # 加载→逐帧驱动（消费 ParameterStore）
│  │  └─ compat/
│  │     ├─ l2dp-import.ts        # .l2dp/manifest/motion3/exp3 → .l2dm 资产
│  │     └─ cdi-import.ts         # (可选) cdi3/model3 → .l2dm 骨架
│  └─ test/
│     ├─ format.test.ts
│     ├─ deform.test.ts
│     ├─ physics.test.ts
│     └─ player.test.ts
├─ driver/     (新，LLM 驱动核心)
│  ├─ src/
│  │  ├─ index.ts
│  │  ├─ ir/
│  │  │  ├─ types.ts            # 扁平指令 IR v2（§6.1）
│  │  │  └─ schema.ts           # IR JSON Schema（供 function calling / MCP 同源）
│  │  ├─ stream/
│  │  │  └─ ingestor.ts          # JSONL 逐行摄入（§6.2）
│  │  ├─ layers/
│  │  │  ├─ layer-stack.ts       # 分层求值（§6.3）
│  │  │  └─ environment.ts       # 环境层控制器（§6.4）
│  │  ├─ eval/
│  │  │  └─ evaluator.ts         # 每帧合成 → param 表
│  │  ├─ validate/
│  │  │  ├─ rules.ts             # 共享规则库（7 类 + 流专属）
│  │  │  ├─ batch.ts             # 离线整批原子校验
│  │  │  └─ inline.ts            # 在线逐行快校验
│  │  ├─ provider/
│  │  │  ├─ types.ts             # RuntimeProvider 接口 + capabilities
│  │  │  ├─ openai.ts            # native（structured outputs）
│  │  │  ├─ fallback.ts          # text 提取器（围栏→括号→尾逗号→重试）
│  │  │  └─ mock.ts              # 测试确定性
│  │  ├─ twohop/
│  │  │  └─ engine.ts            # 两跳：本地规则(<50ms) + LLM 异步增强
│  │  └─ tts/
│  │     └─ types.ts             # SpeechTimeline/viseme/prosody（§7）
│  └─ test/
│     ├─ ingestor.test.ts
│     ├─ layers.test.ts
│     ├─ environment.test.ts
│     ├─ evaluator.test.ts
│     └─ validate.test.ts
├─ examples/
│  └─ demo-web/     (Vite：浏览器端 JSONL 驱动自研引擎)
│     ├─ index.html
│     ├─ src/main.ts
│     └─ assets/demo.l2dm + atlas.png
└─ scripts/
   ├─ typecheck.mjs      (扩为 5 包)
   └─ eval-drive.mjs     (§10 评估集)
```

---

## 4. 开发里程碑 M0–M7（智能体按序执行）

| 里程碑 | 内容 | 落点 | DoD（通过即进入下一阶段） |
|---|---|---|---|
| **M0** | 环境：engine/driver 包骨架 + tsconfig + 测试挂入 | packages/{engine,driver} | `npm run typecheck` 全绿（5 包）；空测试跑通 |
| **M1** | **.l2dm 格式** schema + validator + loader | engine/format | format.test 全绿：合法模型通过、坏模型（悬空引用/顶点越界/无索引）拒绝 |
| **M2** | **形变核心**：ParameterStore + Hierarchy + Warp 网格形变 | engine/runtime | deform.test 全绿：单 keyform/双 keyform/2D 网格/层级变换数值断言；确定性（同参同结果） |
| **M3** | **渲染双后端**：SoftwareCanvas 迁移 + WebGL2（RenderSink 三阶段：uploadTexture/begin+draw/end） | engine/render | 软件渲染：已知网格输入 → 期望像素断言；WebGL2：同输入 → `readPixels` 与软件结果**逐像素一致（容差 ±1）**（自动测试，非手动看 demo） |
| **M4** | **Player + compat**：加载→逐帧；l2dp/motion3/exp3 → 引擎资产 | engine/player, compat | player.test：加载 demo.l2dm + motion3 播一段 → 逐帧参数→像素；无头录 N 帧像素与参考一致 |
| **M5** | **LLM 驱动核心**：扁平 IR + JSONL StreamIngestor + LayerStack + EnvironmentLayer + Evaluator | driver | driver.test 全绿：JSONL 逐行生效、坏行隔离、分层合成分量正确、override 最高、环境层恒动、确定性（同流同种子同轨迹） |
| **M6** | **验证与整合**：双模式校验规则库 + renderer 退役 + demo-web 端到端 | driver/validate, examples/demo-web | batch 拒绝坏批、inline 隔离坏行；demo：输入 JSONL → 引擎模型实时动作 |
| **M7** | **LLM 通道**：Provider(native/text/mock) + 两跳 + 语音接口 + 评估集 | driver/provider, twohop, tts, scripts/eval-drive | mock provider 全流程测试；eval-drive 跑 golden cases 通过；两跳第一跳 <50ms 断言 |

> P4（LLM 创作模式）、MCP 桥、完整物理（发丝/胸）、导入兼容（cdi）标注为 **M7 后可选项**，不在本版 DoD。

---

## 5. packages/engine —— 自研引擎规格

### 5.1 .l2dm 模型格式（开放 schema，版本 1）

> 设计参照 Iki `.iki`（开放、AI 可生成）融合我们语义层需求。核心：**参数即引擎参数（语义名）**，**部件可任意多**。

```ts
// format/types.ts —— .l2dm v1（完整类型以本文件为准，下面是确定性的合同）
export const L2DM_FORMAT_VERSION = 1;

export interface L2dmModel {
  formatVersion: 1;
  id: string;                    // 角色名（= 语义层角色名）
  canvas: { width: number; height: number };
  // 可控制参数 = 语义参数（无官方 ID 概念，多部位自由扩展）
  parameters: L2dmParameter[];
  // 部件（任意多，无白名单上限）。flat 列表，z-order 渲染
  parts: L2dmPart[];
  // 变换层级（可选的 deformer 树，参照 ayagami deformer 链）
  deformers?: L2dmDeformer[];
  physics?: L2dmPhysics;
  pose?: L2dmPose;               // 部件联动（如手臂 A/B）
}

export const L2DM_PARAM_GROUPS = [
  "LipSync", "EyeBlink", "Head", "Body", "Physics",  // 引擎内置：环境层/口型/物理路由
  "Ambient", "Custom",                                 // Ambient=环境层轣辖；Custom=模型作者扩展
] as const;
export type L2dmParamGroup = (typeof L2DM_PARAM_GROUPS)[number];

export interface L2dmParameter {
  id: string;                    // 语义名（如 "微笑" / "头转向" / "尾巴摆" / "耳朵动"）
  min: number; max: number; def?: number;
  group?: L2dmParamGroup;        // 事件组（LipSync/EyeBlink/…）；缺省 = "Custom"
}

// 引擎内置组别规范（P1-2 定案，单一来源）：
//   LipSync → 口型/音频脊梁     EyeBlink → 眨眼环境层     Head/Body → 朝向/体态
//   Physics → 物理输出终点       Ambient → 环境层自动化轣辖（呼吸/视线微动/重心）
//   Custom  → 模型作者自定义（显式动作/表情/override 写入，环境层不碰）

export interface L2dmPart {
  id: string;
  order: number;                 // 渲染顺序（后绘制者覆盖）
  texture?: string;              // atlas 文件名；无 = 纯色
  uvRect?: { x: number; y: number; width: number; height: number }; // atlas 子矩形
  color?: [number, number, number, number]; // 纯色或 tint
  mesh?: L2dmMesh;               // 三角形网格（局部 ±0.5 单位空间）
  parent?: string;               // deformer 引用（层级）
  opacityParam?: string;         // 可见性由参数驱动（可选）
}

export interface L2dmMesh {
  vertices: number[];            // [x0,y0, x1,y1, ...] 局部坐标
  uvs: number[];                 // [u0,v0, ...] 0..1
  indices: number[];             // 三角形索引，3 的倍数
  warps?: L2dmWarp[];            // 参数→顶点偏移 keyform（§5.4）
}

export interface L2dmKeyform {
  value: number;                 // 参数自身范围值（非归一化）
  offsets: number[];             // 与 vertices 同长的 [dx0,dy0,...] 累加偏移
}

export interface L2dmWarp {
  parameter: string;             // 驱动参数（语义名）
  keyforms: L2dmKeyform[];       // ≥2，值单调
}

export interface L2dmWarp2D {
  parameters: [string, string];  // X/Y 轴参数（转头核心）
  valuesX: number[]; valuesY: number[];
  keyforms: L2dmKeyform2D[];     // row-major: k(i,j) = j*valuesX.length + i
}
export interface L2dmKeyform2D { offsets: number[]; }

export interface L2dmDeformer {
  id: string; parent?: string;
  pivot?: { x: number; y: number };
  // 变换可被参数驱动（rotation/scale/translate 的绑定），参照 iki affine + ayagami deformer
  bindings?: L2dmBinding[];
}
export interface L2dmBinding {
  parameter: string; channel: "rotation" | "scaleX" | "scaleY" | "x" | "y";
  from: number; to: number;      // 参数值区间 → 变换值
}

export interface L2dmPhysics {
  pendulums: {
    id: string; input: string;             // 输入参数（如 头转向）
    outputParams: string[];                 // 输出参数（如 前发摆/后发摆）
    delay: number; acceleration: number;    // 摆锤参数
  }[];
}
export interface L2dmPose { groups: { ids: string[] }[] }  // 联动组
```

### 5.2 校验器 validate.ts（参照 Iki format/validate + l2dp）
规则（全部实现）：
1. 参数 id 唯一、min<max（允许负区间）、def∈[min,max]
2. part id 唯一；`parent` 引用的 deformer 存在且不成环
3. mesh：vertices 偶数长、indices 3 的倍数且索引 < 顶点数、warps keyforms ≥2 且 value 单调、offsets 长 = vertices 长
4. warp2D：valuesX/Y 单调、keyforms 数 = lenX×lenY、offsets 长 = vertices 长
5. bindings：parameter 存在、from≠to、channel 合法
6. texture：uvRect∈[0,1]、引用的 atlas 文件存在（loader 阶段）
7. physics：input/output 参数存在
输出：`{ ok, issues: [{path, message}] }`（结构类似 l2dp validate）。

### 5.3 ParameterStore（引擎参数面 = ParameterSink 目标）
```ts
export class ParameterStore {
  // 同 iki parameter-store：set(id,val) 钳制；get(id)；normalized(id)；reset()；list()
}
```
- `set` 驱动面即 `engine` 的 **ParameterSink 实现**（每帧写入）。
- 未知 id 忽略（安全，多部位任意模型友好）。

### 5.4 Warp 网格形变（核心算法，参照 iki warp.ts 思路自主实现）
**原理**：`变形后顶点 = 静止顶点 + Σ_warp (参数值插值的 keyform 偏移累加)`。确定性、无分配、`out += ` 累加。
```ts
export function accumulateKeyforms(
  keyforms: { value: number; offsets: ArrayLike<number> }[],
  value: number, out: Float32Array): void
// 钳制到 [first,last]，不外推；二分/线性找包围对，线性插值，out += 偏移

export function accumulateKeyforms2D(
  valuesX, valuesY, keyforms2d, vx, vy, out): void
// 每轴钳制+找包围对 → 四角双线性插值累加（row-major k=j*W+i）

export function applyWarps(rest, warps, params, out): void
// out = rest；逐 warp：accumulate；无 warp = identity
```
- **决定实现并测**：keyforms 值单调（validator 已保证）；插值在参数**自身范围**（非归一化）。
- 性能：每顶点 O(warps×keyforms)；先不优化，M7 后可考虑 GPU compute（参考 ayagami TODO）。

### 5.5 变换层级 hierarchy.ts（参照 iki affine/adapter + ayagami deformer）
- `L2dmBinding`：参数值 `[from,to]` → 变换分量（rotation/scale/translate）。
- deformer 局部变换 → 世界变换：父级连乘；part 的 mesh 顶点经 local→world。
- **数值要求**：决定性（固定顺序）；测试断言层级连乘结果。

### 5.6 物理 pendulum.ts（参照 renderer/physics + Iki physics-motion）
- 摆锤：输入参数 → 延迟+加速 → 输出参数（如发丝摆动跟随头转）。
- 实现：带惯性/衰减的输入跟踪（`out += (input - out)*accel - out*delay*damping`，固定步长子步，保证确定性）。
- 测试：摆锤收敛到输入、无振荡发散。

### 5.7 渲染双后端
**清软件光栅**（从 renderer/software.ts 迁移）——`RenderSink` 按 **三阶段定案（P2-2 修复）**声明，令软件与 WebGL2 两实现都完整可表达：
```ts
export interface RenderMesh {
  verts: Float32Array; uvs: Float32Array; indices: number[];
  texId: string | null;                // 引用 uploadTexture 注册的纹理；null = 纯色
  color: [number, number, number, number];
}
export interface RenderSink {
  // 阶段 1：上传/注册纹理（软件=存储引用；WebGL2=创建纹理对象；幂等覆盖）
  uploadTexture(id: string, img: Tex2D): void;
  // 阶段 2：清屏 + 逐 mesh 绘制（按 z-order 调用；软件=三角形填充，WebGL2=提交绘制）
  begin(width: number, height: number): void;
  draw(mesh: RenderMesh): void;
  // 阶段 3：结束帧（软件=完成 buffer；WebGL2=flush/present）
  end(): void;
  // 测试面：读回当前帧像素（软件=直接返回 data；WebGL2=readPixels→Uint8Array）
  readPixels(): Uint8Array | null;
}
export class SoftwareRenderer implements RenderSink { /* 三角形填充+UV 采样 */ }
```
**WebGL2**：实现同一 `RenderSink`（uploadTexture/begin/draw/end + readPixels），浏览器渲染；`render/webgl2.ts` 仅在浏览器 import（避免核心 Node 依赖 WebGL）。**验收锚点**：同一 mesh/纹理输入，WebGL2.readPixels 与软件渲染逐像素一致（容差 ±1）。

### 5.8 Player（加载→逐帧）
```ts
export class L2dmPlayer {
  constructor(model: L2dmModel, atlas: Map<string, Tex2D>) 
  params: ParameterStore;          // 外部驱动面
  tick(dtMs: number, seed: SeededRandom): void
    // 1) 物理更新  2) pose 联动  3) 层级→变形  4) deform 网格  5) → render 内容
  render(out: RenderSink): void
}
```

### 5.9 compat（导入兼容层，M4/M7 可选）
- `l2dp-import.ts`：DSL 编译产物（motion3/exp3/manifest）→ 引擎可用资产。**入参必须是 `semantic:true` 编译产物**（曲线 id 已是语义名，与 `.l2dm.parameters` 直接对应，无需二次映射）；若收到非语义产物（PARAM id 轨道），**拒绝并报错**，提示改用语义编译模式重生成——**不做隐式反向映射**（避免运行时猜谜与不确定性）。
  - `importMotion3`：motion3 → `EngineMotion`（非语义轨道拒绝）
  - `importExpression3`：exp3 → 引擎表情（非语义参数拒绝）；`applyExpression` 按 blend 应用
  - `importManifest`：manifest → `L2dmModel` **骨架**（边界见下）
- **manifest 导入的诚实边界**：DSL character manifest 不携带网格/画布/部件层级，故 `importManifest` 只产出**可驱动、可校验的骨架**——sems→参数、layers→部件（order=层 z）、bones→deformer id；几何/uv/纹理/层级绑定不在 manifest 内，由宿主或 M7+ 的 cdi-import 补齐；画布尺寸经 `opts.canvas` 注入（缺省 1000×1000 占位）；outfits 在 .l2dm 无对应概念，不映射。
- 说明：`.l2dm` 模型是「语义参数 + 任意部件」；现有 Live2D 模型若要接入 → `cdi-import` 自动生成 .l2dm 骨架（PARAM→sem 尽力映射 + 部件→parts），**M7 后可选项**。

---

## 6. packages/driver —— LLM 驱动核心规格

### 6.1 扁平指令 IR v2（Directive Stream）
```ts
// ir/types.ts
export const IR_VERSION = 2;
export type Op =
  | "play" | "face" | "set" | "outfit" | "speak" | "blink"
  | "drift" | "look" | "camera" | "action" | "emote" | "wait";

export interface Directive {
  id?: string;
  op: Op;
  target?: string;               // 角色/槽位；默认 "main"
  at?: number | `+${number}` | `+${string}`; // 绝对 ms | 相对上一条 | 依赖 id 开始
  dur?: number;                  // 覆盖时长
  // 各 op 载荷（扁平，禁止嵌套对象套对象 ≥3 层）
  asset?: string; expression?: string; outfit?: string; text?: string;
  sem?: string; value?: number;
  speed?: number; strength?: number; mix?: number; weight?: number;
  interval?: number; amplitude?: number; period?: number;
  gaze?: [number, number]; ms?: number; loop?: boolean;
  cover?: Record<string, number>; // play 覆盖
  emote?: { valence: number; arousal: number };
  interrupt?: "target" | "supersede" | "queue";
  voice?: string; // TTS voice 提示
}
export interface DirectiveStream {
  v: 2; target?: string;
  directives: Directive[];       // 深度 ≤2（顶层 + 数组）
  offlines?: boolean;            // 离线批量标志（默认 false=流式）
}
```
- **schema.ts**：由 types 生成 JSON Schema（server 端 TS 编译期生成），供 OpenAI native 与 MCP 同源。
- **流式限制 / at 时序（P2-1 定案）**：
  - 在线流式：`at` 缺省或 `"+N"`（相对）→ **基准 = 该行的接收时刻**（`feedLine` 传入的 `tMs`），不引用历史行；绝对数字 `at` 按模型时间轴解释（通常仅离线用）。
  - 离线批量：`at` 为绝对 ms（相对流起点）；`"+<id>"`（跨行依赖：依赖指定行**开始**，`dur` 指定则依赖其**结束**）仅此模式允许。
  - 在线流式出现 `"+<id>"` → 快校验拒绝（`skipped{reason:"STREAM_DEP"}`）。

**op 字段约束（P1-1 定案；`validate/rules.ts` 与 `ir/schema.ts` 同源实现，required/forbidden 均为硬校验）**：

| op | required | forbidden | 说明 |
|---|---|---|---|
| `play` | `asset` | `value`,`sem`,`text`,`ms` | `cover/speed/strength/mix` 可选覆盖 |
| `face` | `expression` | `value`,`sem`,`asset`,`text` | `weight/blend` 可选 |
| `set` | `sem`,`value` | `asset`,`expression`,`text` | 写 override 层（唯一参数写入原语） |
| `outfit` | `outfit` | 其余载荷字段 | 换装；`at/dur` 允许 |
| `speak` | `text` | `asset`,`expression`,`value`,`sem` | `voice` 可选 |
| `blink` | — | `value`,`sem`,`text` | 临时覆盖环境层眨眼；`interval` 可选 |
| `drift` | `sem`,`amplitude`,`period` | `asset`,`expression`,`text` | 环境层持续漂移 |
| `look` | `gaze` | 其余载荷字段 | 视线目标 `[x,y]` |
| `camera` | — | `asset`,`text`,`sem` | `zoom/pan` 载荷（宿主）；`at/dur` 允许 |
| `action` | `asset` | `value`,`sem`,`text` | 嵌套调用入库行为 |
| `emote` | `emote` | `value`,`sem`,`text`,其余载荷 | 环境层调制 |
| `wait` | `ms` | `asset`,`sem`,`text`,`value` | 时间轴等待 |

> **同源约束**：表格与 `schema.ts`（逐 op 的 `anyOf`/`required`）必须一致；单测断言二者等价，改一处须同步另一处。

### 6.2 JSONL StreamIngestor（在线，行级原子）
```ts
// stream/ingestor.ts
export interface IngestResult {
  applied: Directive[];          // 已应用
  skipped: { line: number; reason: string }[];  // 坏行隔离
}
export class StreamIngestor {
  constructor(ctx: { manifest: ManifestLike; library: AssetIndex; clock: Clock; seed: SeededRandom })
  feedLine(line: string, tMs: number): IngestResult
    // 1) JSON.parse —— 失败 → skipped {reason:"JSON_PARSE"}
    // 2) inline 快校验（validate/inline.ts）—— 失败 → skipped + reason
    // 3) 分层路由（§6.3）—— 应用
  // 离线入口
  feedBatch(stream: DirectiveStream, tMs: number): IngestResult   // 整批原子（validate/batch）
  undo(): boolean   // 回滚最近"已生效但慢校验失败"的行（慢校验由宿主调 asyncCheck）
}
```
- **语义**：一行 = 一个层上的一个动作。层间不互扰；同层同 sem 冲突交给 LayerStack 仲裁。

### 6.3 LayerStack 分层求值（每帧合成）
```ts
// layers/layer-stack.ts
export class LayerStack {
  // L0 常驻环境层（Engine 构造注入，永不打断）
  // L1 行为层：play（动作曲线，priority + interrupt: target|supersede|queue）
  // L2 表达层：face（表情 Add/Mult/Overwrite，weight 混合）
  // L3 override 层：set（恒定目标，最高）
  push(d: Directive, tMs: number): void
  // 采样依赖 packages/renderer anim（或引擎内新实现）：segments → 时间采样
  tick(tMs: number, clock, seed): Record<string, number>  // 合成参数字典
}
```
**合成顺序（对齐 SPEC-DSL-v1.0 §5）**：
```
base  = Σ 动作层曲线（时间缩放 t' = t/speed；DR D2 混合公式 V=clamp(Σ α·g·β·v,min,max)）
base  = 表情层 blend 应用（Add: b+v; Multiply: b*v; Overwrite: v）
val   = clamp(base + 环境层贡献(仅其命中的参数) * α_ambient, min, max)
       —— override 层：命中 sem → val = override 值（最高）
最终 = clamp(val, param.min, param.max)
```
- **确定性**：LayerStack 不持有 `Date.now`，只用注入 clock；`drift` 用注入 seed 的 AR(1)（正弦+噪声）。
- 同层冲突：`interrupt:target` 立即替换；`queue` 排队（队首继续）；`supersede` 替换且被换者可恢复（记录现场）。

### 6.4 EnvironmentLayer（环境层，程序化常驻）
```ts
// layers/environment.ts —— 呼吸/眨眼/视线/重心 + 1/f 噪声
export class EnvironmentLayer {
  constructor(params: L2dmParameter[], opts: { seed: number; freqHz: number })
  // 控制器：Breath(呼吸) / Blink(眨眼) / GazeDrift(视线微动) / WeightShift(重心微移)
  // 1/f 噪声生成器：Voss-McCartney 或滤波白噪声（种子化）
  setEmote(e: { valence: number; arousal: number } | null): void   // emote 调制
  tick(tMs: number): Record<string, number>   // 增量（仅写入自己管轄的参数）
}
```
- 参数命中规则：`EnvironmentLayer` **只写 `group:"Ambient"` 或显式声明为环境轣辖的参数**，且每个控制器有固定管辖参数（呼吸→Breath 组；眨眼→EyeBlink 组；视线微动→Head 组；重心→Body 组）。
- **`blink` 指令 vs Blink 控制器机制（P1-2 定案）**：`blink` op 是对环境层 Blink 控制器的**临时覆盖**（用 `interval` 覆盖默认间隔；结束后交还控制器）；无 `blink` 指令时，Blink 控制器按种子自动运行。环境层**不写** `Custom` 组参数（防与显式动作/表情冲突）。
- 幅度上限（防"多动症"）：各控制器 maxAmp；`α_ambient` 默认 0.3。
- **眼睛不许静止**：GazeDrift 恒有微动（固视微动生理原理）。

### 6.5 Evaluator（每帧聚合 → ParameterSink）
```ts
// eval/evaluator.ts
export interface ParameterSink {
  apply(character: string, params: Record<string, number>, tMs: number): void;
}
export class Evaluator {
  constructor(stack: LayerStack, env: EnvironmentLayer, engine: { params: ParameterStore }, sink: ParameterSink)
  onFrame(dtMs: number): void
    // t → LayerStack.tick + env.tick → 合并 → clamp → sink.apply("main", params, t)
}
```

### 6.6 校验器：双模式共享规则库
```ts
// validate/rules.ts —— 7 类（语法/语义/命名/范围/曲线/引用/干跑）+ 流专属
//   在 engine 与 driver 间共享：参照 l2dp validate + SPEC-DSL-v1.0 §8
// validate/batch.ts —— 整批原子：全部通过才 apply；失败返回 {issues} 拒绝
// validate/inline.ts —— 逐行快校验（<1ms）：
//   JSON 可解析 / op 合法 / sem 存在 / 值域 / at∈流式允许 / 无 +id 依赖
```
- 规则库是**一套**，batch 与 inline 只是执行策略不同。
- 错误结构：`{ok, issues:[{path,line,col,rule,message}]}` → 直接回传 LLM 自修复。

### 6.7 Provider（LLM 通道分级）
```ts
// provider/types.ts
export interface RuntimeProvider {
  capabilities(): { structured: "native" | "grammar" | "text"; grammarHint?: string };
  createCompletion(req: ChatRequest, opts: { schema?: object; grammar?: string }): Promise<ChatResult>;
}
```
- `openai.ts`（native）：OpenAI 兼容 structured outputs（strict）。
- `fallback.ts`（text）：健壮 JSON 提取（围栏→花括号配对→尾逗号修复→≤3 重试→最简 prompt 兜底），共享跨 provider。
- `mock.ts`：确定性输出（测试）。
- grammar 路径（XGrammar/GBNF）标注为 M7 后可选项（依赖宿主或 vLLM/Ollama 端能力）。

### 6.8 两跳架构
```ts
// twohop/engine.ts
export class DriverEngine {
  constructor(localRules: BehaviorIndex, provider: RuntimeProvider, ing: StreamIngestor)
  dispatch(event: DriverEvent, ctx: Context): void
    // 第一跳（<50ms）：本地规则 → 最高优先已登记 behavior → 直接 feedLine（不进 LLM）
    // 第二跳（异步，不阻塞）：LLM 决策 → JSONL 流注入
    // 危险动作（自定义重写/非常规覆盖）：等待 LLM 结果（慢路径 + 语义抽查占位）
}
```
- 第一跳用库索引（由 manifest cache 生成），遵守"目录进、IR 出"。

### 6.9 情绪（emote）
- **不依赖 LLM 主观猜**：`emote` 由宿主从可观测信号注入（AffectSignalSource，见 SPEC §12）。
- 环境层消费 emote：`arousal↑ → 呼吸浅快/幅度↑；valence↓ → 缓/收`。
- LLM 仅在例外时"确认/微调"，不当感知主力。

---

## 7. 语音与口型（driver/tts）
```ts
export type VisemeId = "silence" | "A" | "I" | "U" | "E" | "O";
export interface SpeechTimeline {
  text: string; lang: string; audio?: Uint8Array;
  durationMs: number;
  visemes?: { tMs: number; viseme: VisemeId; weight?: number }[];
  prosody?: { tMs: number; energy: number; pitch: number }[];
}
export interface TtsProvider {
  synthesize(text: string, opts?: { voice?: string }): Promise<SpeechTimeline>;
  capabilities(): { visemes: boolean };
}
```
- **三级口型**：visemes（60–80ms 入出混合）→ RMS（音量包络）→ 简谐（无音频）。
- **音频脊梁**：`prosody.energy/pitch` → 环境层手势幅度/微表情调制（跨通道相关性=活的信号）。
- **时钟**：说话用 audioClock（playhead），其余 wallClock；一条时间轴内不混用。
- 无 TTS → 降级简谐口型 + 预设时长，不阻塞。

---

## 8. 语义层与资产工具链（复用）

- **引擎参数 = 语义参数**：`.l2dm.parameters` 直接是语义名（`微笑/头转向/尾巴摆/耳朵动`——**任意多，无官方白名单**）。这是"更多部位 + 原生 LLM 驱动"的根本承载（G2/G3）。
- **DSL（packages/dsl）**：语言 A 创作 motion/expression —— 编译为**语义名轨道的 motion3/exp3**。
  **定案（P0-1 修复｜DSL 语义编译模式）**：`packages/dsl` 编译入口新增选项 `semantic: boolean`（默认 `false` 保持现状兼容官方格式导出）：
  - `semantic: true`：`compileMotion/compileExpression` 的曲线/参数 `id` **直接写语义名 `sem.name`**（不再展开为官方 `PARAM_*`），并**跳过 `isStandardParam()` 白名单校验**（`BAD_PARAM` 不触发）；解锁任意自定义语义名（`尾巴摆/耳朵动`）。
  - `semantic: false`（默认/现状）：维持 `compile.ts` 现有行为（`id: p` 展开 + 白名单硬校验），用于兼容官方格式导出（.l2dp 补丁、VTube 等宿主）。
  - **引擎资产一律消费 `semantic: true` 产物**；两模式输出结构相同（都是 motion3/exp3 形状），仅 `id` 值域与校验不同。
  - 落点：`compile.ts` 的 `curves.push({ id: ... })` / `parameters.push({ id: ... })` 与 `compileCharacter` 的白名单检查均受该开关控制。
- **导入现有 Live2D 模型**：cdi-import（M7+ 可选）把 model3/cdi3 → .l2dm 骨架（PARAM→sem 尽力映射），不保证全部落地（D1 跳过而非报错）。
- **词表**：`specs/standard-params.json` 保留作"兼容参考词表"（导入映射用）；不再作为自研引擎运行时硬约束。

---

## 9. MCP 表层（M7 后可选项）
- 由 IR JSON Schema 同源生成工具清单：`emit_directives`（主）+ `play_motion/set_expression/set_parameter/look_at/speak/get_state`。
- 薄桥：MCP 请求 → IR → 同一校验/求值。SDK 不实现 MCP server 本体（宿主注入）。

---

## 10. 评估集与测试（scripts/eval-drive.mjs）
```
# 黄金用例文件结构（P2-3 定案，字段为合同）：
specs/evals/drive-cases.json
```
```json
{
  "version": 1,
  "clock": "fixed",          // "fixed"=固定时间轴（确定性） / "seeded"=种子时序
  "cases": [
    {
      "id": "greet-request",
      "scenario": {
        "event": "user_text",              // 触发事件（两跳 dispatch 输入）；或省略 = 直接 feedLine
        "userText": "你好呀！",            // 用户文本（喂给 provider 决策上下文）
        "context": { "mood": { "valence": 0.4, "arousal": 0.3 }, "recent": [] },
        "seed": 42
      },
      "expectedSemEffect": [
        { "windowMs": [0, 5000], "sem": "微笑", "min": 0.3 },          // 5s 窗口内微笑 ≥0.3
        { "windowMs": [-1, 5000], "op": "play", "kinds": ["greeting"] }  // 出现 greeting 类 play
      ]
    }
  ],
  "metrics": ["pass", "syntax_fail", "semantic_fail", "refuse", "timeout"]
}
```
- `expectedSemEffect[]` 断言语义效果而非字节 IR：`windowMs[0]=-1` 表示从流开始；`sem+min/max` 为参数值断言；`op+kinds` 为行为断言（匹配库索引 kinds）。

```
scripts/eval-drive.mjs      # 批量：对每个 case → mock provider 决策（或注入 text）→ 确定性求值（固定 clock/seed）→ 逐断言评分
                            # 输出 JSON 报告至 specs/evals/report.json：通过率 + 按 metrics 分类的失败模式分布
```
- 度量：通过率 + 失败模式分布（语法/语义/拒绝/超时），按 provider 记录。
- 门禁：改提示词/schema 必过评估集（CI 或手动 `node scripts/eval-drive.mjs`）。
- **语义抽查**：高风险输出（新资产/自定义覆盖）走慢路径二次复核（M7 内含占位）。

---

## 11. 参考项目映射（算法参考，不复制代码）
| 我们实现 | 参考 | 借用的思路 |
|---|---|---|
| Warp 网格形变 (engine/runtime/deform) | Iki `warp.ts` | 参数插值偏移 keyform 累加（钳制不外推、out+=、2D 双线性） |
| ParameterStore | Iki `parameter-store.ts` | set 钳制 / get / normalized / reset |
| .l2dm 格式 | Iki `.iki` format | 开放 schema、flat parts、UV rect、mesh、关键帧偏移 |
| 变形 2.5D 转头 | Iki `warp2d`（2D 参数网格） | valuesX×valuesY 双线性 keyform（head turn） |
| 环境层 | Iki `idle-motion.ts` | 自动眨眼/呼吸/视线漂移（宿主无关） |
| deformer 层级/变换链 | Iki `affine.ts` / Ayagami `driver/deformer.rs` | 局部→世界连乘、旋转/缩放绑定 |
| 物理摆锤 | Iki `physics-motion.ts` / `hair-chain-motion.ts` / 现有 renderer `physics.ts` | 输入跟踪+衰减；发丝链 |
| MOC3 理解（导入/对照） | Ayagami `file/` + `driver/` | 逆向结构、SoA 组织（参考结构而非代码） |
| 软件光栅 | 现有 renderer `software.ts` | 三角形填充+UV 采样 |
| 2D 蒙皮算法原理 | 参考文档：LBS（线性蒙皮）+ 缝隙处理 | 权重非负和 1、接缝共享顶点 |

> **许可边界**：Iki=MIT，Ayagami=MIT/Apache2。**只借鉴思路与算法形态，不复制源码**；若复制片段须保留出处与许可声明。

---

## 12. 决策记录（路线 C 定案）
| # | 决策 |
|---|---|
| C1 | **全自研引擎**（路线 C），绕开 Cubism Core 与 PARAM/PARTS 白名单（G1/G2） |
| C2 | **引擎参数 = 语义参数**：.l2dm.parameters 直接用语义名，DSL 编译产物直接是语义轨道（无 PARAM 映射层）——"更多部位/原生 LLM 驱动"的根本 |
| C3 | **开放 .l2dm 格式**（参照 Iki），AI 可生成、validator 严格 |
| C4 | **双渲染后端**：软件（无头/CI）+ WebGL2（浏览器）（G4） |
| C5 | **driver 包**承载 v1.0 全部 LLM 驱动定案（JSONL 流/扁平 IR/分层/环境层/双模式校验/Provider/两跳） |
| C6 | 复用 l2dp（格式基元）与 dsl（语言 A 编译）；renderer 软件算法迁入 engine 后退役 |
| C7 | 现有 Live2D 模型导入（cdi-import）为 **M7+ 可选**，主路径是原生 .l2dm 资产 |
| C8 | MCP/创作模式(P4)/grammar 约束/完整物理为 M7+ 可选 |
| C9 | 确定性：全链路注入 clock+seed；软渲染像素级回归 | 
| C10 | 接口照 ARCHITECTURE：ParameterSink/AssetSource/ManifestSource/TtsProvider/Clock/SeededRandom/AuditSink/ContentPolicy + 新增 StreamIngestor/AffectSignalSource |
| C11 | **DSL 语义编译模式（P0-1 修复）**：编译入口 `semantic:true` → 曲线/参数 id 直接写语义名 + 跳过白名单；引擎资产一律用语义产物（§8） |
| C12 | **op 字段约束表（P1-1 修复）**：§6.1 逐 op required/forbidden 为硬校验，与 schema.ts 同源（单测断言等价） |
| C13 | **ParameterGroup 枚举（P1-2 修复）**：7 个内置组；环境层只写 Ambient/轣辖参数；`blink` op = 环境层 Blink 临时覆盖（§5.1/§6.4） |
| C14 | **at 时序（P2-1 修复）**：流式相对基准 = 接收时刻，`+<id>` 仅离线；离线绝对 ms 从流起点（§6.1） |
| C15 | **RenderSink 三阶段（P2-2 修复）**：uploadTexture/begin+draw/end + readPixels；WebGL2 与软件逐像素一致验收（§5.7/M3） |
| C16 | **评估集 schema（P2-3 修复）**：drive-cases.json 结构定案（scenario/expectedSemEffect/metrics），断言语义效果（§10） |

---

## 13. 验收总览（整个工程）
1. `npm run typecheck` 全绿（l2dp/dsl/engine/driver/renderer[退役前]）
2. `npm test` 全绿：engine(format/deform/physics/player) + driver(ingestor/layers/environment/evaluator/validate) + 原有 52 例
3. **端到端**：`examples/demo-web` 输入 JSONL → 自研引擎渲染模型实时动作；Node 无头回放逐帧像素一致
4. **确定性**：同样 (JSONL 流, .l2dm, seed) 两跑参数轨迹/像素逐帧一致
5. **LLM 通道**：mock provider 全流程；两跳第一跳 <50ms；eval-drive golden 通过
6. **坏行隔离**：非法 JSONL 行被跳过且不阻塞后续行；坏批被整批拒绝
7. **更多部位实证**：demo 模型包含非标准部位（如 尾巴/翅膀/耳）并以语义名驱动

---

*附：实现过程中的小决策（命名/常量/默认值）由智能体自定，但不得违背上述接口、格式、确定性、DoD。涉及架构变更须写回本文档决策表。*

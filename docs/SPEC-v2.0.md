# Live2D 创作平台 — AI 智能体开发实施规格 v2.0

> 本文件是交给 AI 开发智能体的可执行开发规格：按章节给出硬性约束、技术选型、数据模型、API、文件格式、AI 工作流、模块规格与分阶段任务清单，每项附验收标准（DoD）。
> 开发目标：浏览器端 Live2D 创作平台。核心=开发编辑与组装；AI=素材工厂；默认成人级内容定位（无验证门槛）；导出双轨（PSD 保底 + Editor 脚本化 .moc3）。

---

## 0. 硬性约束（不可更改，违反即打回）

1. 内容定位：默认成人级。无年龄验证、无内容分级限制、开发与导出不受内容限制。
2. 生成路由：成人任务必须仅由本地 ComfyUI 执行；云 API 层严禁承接、转发、降级承接成人任务（云供应商政策）。
3. 涉及未成年人形象的成人内容：禁止生成、禁止入库、禁止导出。默认拒绝（保持为平台级硬约束，全链路校验）。
4. 平台形态：Web 应用。本地 ComfyUI 通过本地桥接入；桥为纯出站（outbound-only）：主动向云端 wss:// 长连接，任务经该通道下发、进度/产物回传；浏览器永不直连用户内网（规避 Mixed Content 与 Private Network Access 限制）。
5. 导出保底：任何版本必须提供 PSD+Cubism 命名规范的导出；Editor 脚本化一键导出 .moc3 为增值链路（允许顺延）。
6. 标准参数语义：参数 ID 采用官方 PARAM_* 命名（最低集 = specs/haru模型对照分析.md 第 2 章 32 参数表：PARAM_ANGLE_X、PARAM_EYE_L_OPEN、PARAM_MOUTH_OPEN_Y、PARAM_BUST_Y 等），语义必须与 Cubism 官方一致；PARAM_BUST_Y（胸部摆动）、PARAM_HAIR_FRONT/BACK（发丝摆动）直接服务成人部位与发丝物理。

---

## 1. 范围与非目标

### 1.1 范围（本规格覆盖）
- AI 素材生成（云 API + 本地 ComfyUI 双轨）、自动分层、自动绑定
- 装配编辑器（部件树/网格/参数/变形器/物理/动作/表情）
- 实时预览（自研渲染器 + Cubism SDK 双预览）
- 导出：.l2dp / PSD+Cubism 命名 /（增值）Editor 脚本化 .moc3
- 资产库、用户/项目/任务后端、本地桥

### 1.2 非目标（本阶段明确不做）
- 移动端适配、多人实时协作、公开市场/支付体系
- 视频/音频生成、口型同步深度集成
- 自定义渲染后端（仅 WebGL/Canvas2D）

---

## 2. 技术选型（选定，不另行讨论）

| 层 | 选型 | 说明 |
|---|---|---|
| Web 前端 | TypeScript + Vite + React + Zustand | 编辑器/素材台/预览 UI |
| 渲染 | 自研 WebGL 渲染核心（编辑态） + Cubism SDK for Web（moc3 预览态） | Canvas2D 低端兜底；WASM 承载网格变形/物理热点 |
| 业务后端 | Node.js（Fastify） | 用户/项目/资产/任务/计费 |
| AI 服务 | TypeScript（Node，全栈统一） | 生成网关编排、自动分层、自动绑定（ONNX Runtime Node）、ComfyUI REST 对接；ComfyUI 本体是外部 Python 服务（用户本机/服务器），属调用方而非我方代码 |
| 存储 | **SQLite3（node:sqlite 内置，零依赖）** + Redis（队列，可选）+ 对象存储（S3 兼容/MinIO） | SQLite 元数据/工程文件（BLOB）；Redis 队列/缓存（生产可选）；OSS 纹理/模型成果物 |
| 通信 | REST + WebSocket（浏览器订阅 / 桥出站长连两条独立通道） | 任务进度、桥心跳与任务下发 |
| 本地桥 | Node.js 单文件程序（约 20MB 分发） | 用户本机连接本地 ComfyUI |

---

## 3. 仓库结构（目标布局）

~~~
live2d-platform/
├─ apps/web/                # 前端：素材工厂、装配台、预览、资产库、导入导出
├─ services/api/            # 业务后端（Node/Fastify）
├─ services/gateway/        # 生成网关（并入 api 或独立，见 7 章）
├─ services/ai/             # 生成/AI 服务（TypeScript）：分层/绑定(ONNX Node)/ComfyUI REST 编排
├─ services/bridge/         # 本地桥（用户本机 Node 程序）
├─ packages/l2dp/           # .l2dp 格式 schema 校验 + 读写库（前后端共用）
├─ packages/renderer/       # 自研 WebGL 渲染核心
├─ packages/cubism/         # Cubism Core 封装：moc3 解析/序列化 + SDK 预览 + 许可标注（解析依赖官方闭源库）
├─ workflows/               # ComfyUI 工作流 JSON 模板（版本化）
├─ specs/                   # 本规格 + 子规格（数据模型/API/格式）
└─ docs/                    # 用户文档、导出说明书模板
~~~

---

## 4. 数据模型（SQLite3，字段级）

> 现行 schema：sql/sqlite-schema.sql（id=TEXT 应用层 UUID、JSON 字段为 TEXT、时间为 INTEGER ms、.l2dp 工程文件存 BLOB 表 project_l2dp_files）。PostgreSQL 版（sql/001_init.sql）保留为参考。

~~~
users(id uuid pk, username text uniq, email text uniq, password_hash text, created_at timestamptz)

projects(id uuid pk, user_id fk, title text, description text,
          character_profile_id fk null,  -- 绑定角色档案
          meta jsonb, version int, created_at, updated_at)

character_profiles(id uuid pk, user_id fk, name text, ref_sheet_url text,
          features jsonb,       -- 发色/瞳色/风格标签等特征描述
          lora_refs jsonb,      -- [{lora_id, trigger_word, weight}]
          thumb_url text)

assets(id uuid pk, user_id fk, project_id fk null,
        category enum('body','clothing') not null,  -- 身体层(器官)/服装层(可脱换)
        type enum('hair','eye','brow','mouth','nose','ear','face_skin','breast','genital','limb',
                  'hairstyle','underwear','top','bottom','dress','shoes','socks','accessory',
                  'part','diff','exp','motion','physics','pose','lora','model'),
        name text, grade_tag text default 'adult',
        costume_group int null, -- 服装组编号（对齐部件后缀 _NNN，Haru 双服装组范式）
        file_refs jsonb,        -- OSS 引用与尺寸信息
        binding_rules jsonb,    -- 套用时的绑定规则（deformers/params 映射）
        meta jsonb, created_at)

generation_jobs(id uuid pk, user_id fk, project_id fk null,
        job_type enum('txt2img','img2img','inpaint','refsheet','consistency','layers','diff_exp','lora_train','adult','upscale'),
        params jsonb, workflow_version text,
        route enum('cloud','local'), status enum('pending','queued','running','succeeded','failed','canceled'),
        claimed_bridge_id text null, claim_expires_at timestamptz null,  -- 任务→桥领取归属
        inputs jsonb, outputs jsonb, error text,
        created_at, finished_at timestamptz null)

model_files(id uuid pk, project_id fk, format enum('l2dp','psd','moc3'),
        url text, checksum text, size bigint, created_at)

bridge_sessions(id uuid pk, user_id fk, bridge_id text, status enum('online','offline'),
        token_hash text, token_expires_at timestamptz, last_heartbeat timestamptz)

audit_log(id bigserial pk, user_id fk, action text, detail jsonb, created_at)
~~~

索引：generation_jobs(user_id, status)、generation_jobs(route, status)、projects(user_id, updated_at)、assets(user_id, type)。

---

## 5. API 规格（REST + WS）

鉴权：JWT（Bearer）。错误统一 {error:{code,message}}。分页 ?page&page_size。

### 5.1 REST
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /auth/register | 注册 {username,email,password} |
| POST | /auth/login | 登录，返回 token |
| GET | /auth/me | 当前用户 |
| GET/POST | /projects | 列表/创建 {title,description} |
| GET/PATCH/DELETE | /projects/:id | 详情/更新/删除 |
| GET/POST | /projects/:id/assets | 项目资产列表/追加 |
| POST | /projects/:id/export | 导出 {format: l2dp|psd|moc3}；moc3=返回 Editor 脚本包+引导（产物在本机生成，可选回传） |
| GET | /models/:id | 下载产物 |
| GET/POST | /profiles | 角色档案列表/创建 |
| GET/PUT | /profiles/:id | 详情/更新（features/lora_refs） |
| GET/POST | /assets | 资产库列表/创建；上传文件走 OSS 预签名直传（POST /upload/url → PUT OSS） |
| POST | /jobs | 创建生成任务 {type, params, project_id?}，头 Idempotency-Key 幂等 → 校验路由 |
| GET | /jobs/:id | 任务详情+产物 |
| GET | /jobs?status= | 任务列表（筛选） |
| POST | /jobs/:id/cancel | 取消任务 |
| POST | /bridge/register | 本地桥注册，返回短期 token |
| POST | /bridge/heartbeat | 心跳 {bridge_id, models, workflows} |

### 5.2 WebSocket
| 端点 | 事件 | 载荷 |
|---|---|---|
| /ws/jobs | job.status | {jobId,status,progress,previewUrl?,outputs?} |
| 桥通道（出站长连，非浏览器端点） | 云端→桥：job.dispatch / job.cancel；桥→云端：job.progress / job.result / heartbeat / workflow.list | 浏览器永不直连桥 |

---

## 6. 自有格式 .l2dp 规范（v0.2，对齐官方 runtime 结构）

> 对齐基准：haru 官方示例（specs/haru模型对照分析.md）。导入/导出以无损双向映射为验收目标。

### 6.1 目录结构
~~~
project.l2dp/
├─ manifest.json       # 版本/元数据/分级/displayInfo 布局
├─ textures/           # 支持多纹理页：textures/page_00.png, page_01.png...
├─ parts.json          # 部件树（含 category/costumeGroup）
├─ meshes.json         # 网格（顶点+UV，引用纹理页）
├─ deformers.json      # 形变器（官方 ArtMesh 形变语义：控制点对+归一化+曲线）
├─ params.json         # 参数表（官方 PARAM_* 白名单）
├─ groups.json         # 参数组(EyeBlink/LipSync) + 部件组
├─ pose.json           # 姿态联动组（对齐 pose3）
├─ hitareas.json       # 命中区（可为空）
├─ physics.json        # 物理（对齐 physics3 schema）
├─ motions/            # 按组存放：motions/<Group>/<name>.json（对齐 motion3，可带 sound）
└─ expressions/        # *.json（对齐 exp3，含 Blend）
~~~

### 6.2 字段规格
~~~
manifest.json  {schemaVersion:2, id, name, author, grade:'adult',
                displayInfo:{width,height,originX,originY,pixelsPerUnit}, layout:{width,height,x,y},
                genFingerprint?: string,   -- 生成参数/输入图哈希（任务去重凭据）
                fileManifest:{textures[],parts,meshes,params,groups,pose,hitareas,physics,motions,expressions}}

parts.json      [{id, name, category enum('body','clothing'), type,
                  costumeGroup int null,       -- 服装组编号（对齐 PARTS_01_XXX_NNN）
                  parent null|id, visible bool,
                  drawOrder int,               -- 全局渲染顺序（导入时保留官方次序）
                  opacity 0..1, blendMode enum('normal','add','multiply'),
                  texturePage int, uvBounds{x,y,w,h},
                  diffs:[{id, target('texture'|'mesh'),
                          paramCondition:[{paramId,min,max}],  -- 参数区间启用该差分（如闭眼）
                          src}]}]

meshes.json     [{id, partId, vertices:[{x,y,u,v}], triangles:[a,b,c...],
                  weights:[{deformerId, values:[每顶点权重]}]}]

deformers.json  [{id, type enum('warp','rotation'), target meshId|partId,
                  controlPoints:[{source{x,y}, destination{x,y}}],  -- 对齐官方 ArtMesh 形变语义
                  normalization:{paramId, min, def, max},
                  curve: 'linear'|'bezier', curvePoints?:[...]}]

params.json     [{id, name, standard bool, min, max, defaultValue}]
                -- 标准参数 ID 必须取官方 PARAM_* 白名单（specs 第 2 章 32 参数表）
                -- 自定义参数不得与标准 ID 冲突

groups.json     {paramGroups:[{target:'Parameter', name:'EyeBlink'|'LipSync'|..., ids:[]}],
                 partGroups:[{name, ids:[]}]}

pose.json       {type:'Live2D Pose', groups:[[{id, link:[]}]]}
hitareas.json   [{id, name, partIds:[]}]

physics.json    {meta:{settingsCount, effectiveForces:{gravity{x,y}, wind{x,y}},
                 dictionary:[{id,name}]},
                 settings:[{id, input:[{sourceParamId, weight, type('X'|'Angle'), reflect}],
                   output:[{destinationParamId, vertexIndex, scale, weight, type, reflect}],
                   vertices:[{position{x,y}, mobility, delay, acceleration, radius}],
                   normalization:{position:{min,def,max}, angle:{min,def,max}}}]}

motions/<Grp>/<name>.json {meta:{duration,fps,loop,curveCount,...},
                   curves:[{target:'Parameter', id, segments:[扁平段数据]}],
                   sound?:'wav 相对路径（口型/配音素材）'}
                  -- 约定：Idle 组必须存在（至少 1 条），工具链默认为空模型生成

expressions/*.json {type:'Live2D Expression', parameters:[{id, value, blend:'Add'|'Multiply'|'Overwrite'}]}
~~~

### 6.3 导入导出映射（无损双向）
- 导入 .model3.json 包：FileReferences(全部) → 各文件；Groups→groups.json；HitAreas→hitareas.json；Pose→pose.json；Motions 分组+Sound→motions/<Group>/；DisplayInfo 参数表/部件表→params/parts（Name 保留为别名）；moc3 内部件/网格/参数经官方 Cubism Core 解析（闭源免费库，许可约束见 14 章）
- 导出：按上述逆映射写回；moc3 生成依赖 Cubism Editor（双轨导出，见 10.5）

### 6.4 兼容与校验规则（packages/l2dp 实现）
- 标准参数 ID 白名单校验（官方 PARAM_* 集），与 SDK 语义一致
- 部件命名规范：PARTS_<工程号>_<部件名>_<服装组号>；非法命名导出前拦截
- 网格校验：无翻转三角形、无悬空顶点、UV 在 0..1、三角面数>0；纹理页引用必须存在于 textures/
- 差分资源必须同时存在于 textures 与 parts.diffs 声明

---

## 7. 生成网关协议与实现（services/gateway 或并入 api）

### 7.1 Job 类型与路由
| job_type | 能力 | 默认路由 | 说明 |
|---|---|---|---|
| txt2img | 概念/立绘 | cloud → local | 云失败可降级本地 |
| img2img | 精修/局部重绘 | cloud → local | |
| inpaint | 部件替换/生成 | cloud → local | |
| refsheet | 三视图参考素材 | cloud → local | |
| consistency | 一致性生成 | local（优先）/cloud（降级） | 上传参考图时优先本地 |
| layers | 自动分层 | local（成人内容强制）/ 平台托管（全年龄内容兜底）/ 半自动（浏览器本地推理+用户点选） | 路由决策见下文 |
| diff_exp | 表情/口型差分 | local | |
| lora_train | 角色 LoRA 训练 | local | |
| adult | 成人素材/全身 | local（硬约束，禁止 cloud） | 服务端强校验路由字段 |
| upscale | 超分/修复 | cloud → local | |

约束实现：adult 任务在 API 层即校验 route 必须为 local，无本地桥则拒绝并提示配置；网关层二次校验，禁止 cloud 适配器接受 adult 输入。
- 分层路由按内容属性联动：成人项目（含成人内容的工程）的分层任务强制 local，内容不落平台服务器；全年龄项目分层可走平台托管或半自动降级。无本地桥的全年龄用户以半自动模式即可闭环。

### 7.2 队列与状态机
- 队列：Redis（BullMQ 或 Streams），优先级：成人任务在本地队列内最高；按桥并发配额调度（桥上报 maxConcurrency，默认 1，高配 2），超限排队
- 状态机：pending → queued → running → succeeded | failed | canceled
- 领取：任务在用户在线桥集合中 claim（claimed_bridge_id + 过期时间，超时重新入队）；取消仅对 queued/running 生效；running 由桥转发 kill
- 进度节流：桥→云端→浏览器全程 200ms 节流合并
- 进度事件 payload：{jobId,status,progress 0-100,stage?,previewUrl?,outputs?,error?}

### 7.3 产物归档
- 阶段产物：长任务按 stage 出中间结果（草稿/预览图），经进度事件 previewUrl 推送，可先于最终结果展示
- outputs 一律写入对象存储，引用记录于 generation_jobs.outputs 数组
- 分层输出：{layers:[{semantic, pngUrl, confidence}]}；绑定输出：{l2dpUrl, qualityReport}

---

## 8. ComfyUI 工作流模板（workflows/ 目录，JSON 版本化）

每个模板 JSON 元数据：{name, version, description, inputs:[{key,type,default}], outputs:[{key,type}], requires:{models:[],customNodes:[]}, params:{steps,cfg,width,height,sampler}}。

| 文件 | 用途 | 关键节点/依赖 | 默认参数 |
|---|---|---|---|
| txt2img_concept | 概念/立绘 | FLUX 或 SDXL 底模 + ControlNet 构图 | 1024², 28 步, CFG 3.5 |
| img2img_refine | 立绘精修 | img2img + FaceDetailer + 4x 超分 | denoise 0.4 |
| refsheet_3view | 三视图参考素材 | 3:2 三栏布局（正面/背面全身+面部特写） | 1536×1024 |
| consistency_instantid 等四变体 | 角色一致性 | InstantID / PuLID / IP-Adapter / FLUX Kontext + 参考图输入 | adapter 权重 0.6–0.8 |
| part_gen | 部位素材（服装/发型/成人部位） | inpaint + 部位 LoRA + 遮罩 + refImage（角色参考图约束肤色/光照/风格） | 遮罩/参考图由前端传入 |
| auto_layer | 自动分层 | LayerDiffusion 透明输出 或 SAM2 分割 | 语义类表见 9.1 |
| diff_exp | 表情/口型差分 | 批量差异生成（闭眼/嘴型档位/眉毛） | 4–16 张/组 |
| lora_train | 角色 LoRA 训练 | AI-Toolkit 或 Kohya 参数预设 | 15–30 张, 10–20 epochs |
| adult_part | 成人素材（默认场景） | Pony/Illustrious/NoobAI 底模 + 部位 LoRA | 仅本地 |
| upscale_face | 修复放大 | FaceDetailer + 4x 超分 | - |

实现：services/ai 持模板清单，按 requires 校验本机模型/节点，缺失返回安装指引数组；工作流 JSON 锁定节点版本 hash，桥启动时校验，漂移时引导升级/回退。

---

## 9. 自动分层与自动绑定服务（services/ai，TypeScript）

### 9.0 实现语言策略（全 TS/Node 落地，无 Python 代码）
- 关键点检测：@mediapipe/tasks-vision（官方 TS/JS，支持 Node）或 onnxruntime-node 载入 ONNX 模型
- 轻量分割/抠图：rembg 的 U2Net ONNX 模型 → onnxruntime-node 直接推理（无 Python）
- 重型分割（SAM2/Layer Diffusion）与 LoRA 训练：作为 ComfyUI 自定义节点/工作流，我方 Node 服务经 REST 调用（ComfyUI 机器上运行 Python 运行时，非我方代码）
- 三角剖分/网格：纯 TS（cdt2d / delaunator / earcut）
- 物理/插值/贝塞尔解析：纯 TS（无外部依赖）
- 结论：我方全部仓库代码为 TypeScript；Python 仅作为 ComfyUI 运行时的外部依赖存在（等价于数据库/缓存的位置）

### 9.1 分层方案表（默认模板对齐 Haru 部件集，specs 第 3 章）
~~~
身体层（category=body，部件不带服装组号）：
face 脸 / hoho 颊 / ear 耳 / nose 鼻 / eye 目 / eyeball 目玉 / brow 眉 / mouth 口 / neck 首
hair_back 后发 / hair_side 侧发 / hair_front 前发
body_upper body_lower 躯干 / arm_a arm_b 臂 / leg 腿 / feet 足
adult_breast 胸 / adult_genital 阴部（成人器官：独立部件、独立网格、参与物理 PARAM_BUST_Y）

服装层（category=clothing，部件带 costumeGroup 1..n）：
outfit_<组号>_<type> 整套服装部件（对齐 Haru ワンピース/制服双组范式），按需拆分：
  outfit_top / outfit_bottom / outfit_dress / outfit_underwear(outfit_bra/outfit_panties)
  outfit_shoes / outfit_socks / outfit_accessory
对应关系：部件后缀 type 即资产 type（top/bottom/dress/underwear/shoes/socks/accessory），命名规则与资产分类同一套标识
hairstyle_<组号> 发型配件（可换造型，不覆盖身体层发丝）
~~~

### 9.2 分层管线（三模式，按 7.1 路由）
模式A 本地（ComfyUI：SAM2/LayerDiffusion）→ 模式B 平台托管（服务端 SAM2/rembg，仅全年龄内容）→ 模式C 半自动（浏览器 onnxruntime-web 跑 U2Net 出候选选区，用户点选语义）
1. 输入：立绘 PNG + 可选用户 mask
2. 检测：A/B 模式经 REST 取掩码集；C 模式前端本地推理（无本地桥、无服务器依赖）
3. 后处理：掩码膨胀/收缩、边缘羽化 2–4px、小碎片合并（小于 200px² 并入最近部件）
4. 输出：每部件 alpha PNG（命名=映射名）+ 置信度
5. 校验：总覆盖率 ≥98%、重叠区 ≤2%（超出标黄提示）

### 9.3 绑定管线
1. 关键点：mediapipe tasks-vision（Node 原生）Face 168 + Pose 33；或 onnxruntime-node 载入人脸/姿态 ONNX 模型
2. 模板网格配准：关键点三角剖分（受约束 Delaunay）→ 非刚性配准到模板网格
3. 参数映射表（内置，官方 ID）：眼开合→PARAM_EYE_L/R_OPEN；嘴形/开合→PARAM_MOUTH_FORM/PARAM_MOUTH_OPEN_Y；眉→PARAM_BROW_L/R_Y/X；头→PARAM_ANGLE_X/Y/Z；胸/发丝摆动→PARAM_BUST_Y/PARAM_HAIR_FRONT/BACK（物理输出）
4. 权重生成：顶点到控制点距离衰减 + 部件约束区域
5. 输出：meshes/params/deformers 增量补入 .l2dp 工程 + 质检报告

### 9.4 质检报告 schema
~~~
{overall: pass|review|fail,
 checks:[{name:'triangles_no_flip', ok, detail},
          {name:'no_dangling_vertices', ok},
          {name:'occlusion_order_valid', ok},
          {name:'confidence', ok, value}],
 confidence: 0..1,        -- 小于 0.7 返回 review，前端引导手动修正
 manualHints: [string]}
~~~

---

## 10. 客户端模块规格（apps/web）

### 10.1 素材工厂
- 生成向导：选分类（身体层器官 / 服装层服饰）→ 选类型（概念/立绘/部位/差分/成人）→ 参数表单（提示词助手、底模、尺寸）→ 提交 job → 队列进度（WebSocket）→ 多方案结果网格 → 一键入库（自动写入 category/costume_group）
- 入库向导三分支：成功（部件入库）/ 需手动指定语义（候选选区+点选，半自动；无桥用户默认此模式，候选选区由浏览器 onnxruntime-web 本地推理）/ 失败（保留结果图可重试分层）
- DoD：从提交到结果出现有进度反馈；入库 ≤2 次点击进入装配台部件树
- 提示词助手：按底模（FLUX/SD/成人底模）的提示词模板 + 中英转换；成人类型默认本地路由并提示
- 身体层素材（发丝/眼/眉/嘴/胸/阴部等器官）：入库后替换身体部件；服装层素材（发型配件/内衣/上衣/下身/连衣裙/鞋袜）：按 costume_group 成组入库，实现多套装切换
- 部件树组织直接采用 9.1 语义命名（前后端共用 specs/parts-naming.json 单一映射表，入库/装配/导出三处引用同一来源）

### 10.2 装配台
- 画布：多画布（正文前/后）、缩放平移、对齐线、吸附；可选工程层（底稿/背景，对齐 Haru 的 下絵/背景 部件）
- 部件树：拖拽排序/嵌套/锁定/可见性/透明度；命名规范实时校验高亮
- 网格编辑：顶点增删移、UV 重映射、镜像、自动三角剖分、细分、左右对称编辑
- 权重编辑：权重热力图视图 + 权重笔刷（强度/衰减半径）+ 部件约束区域锁定
- 参数面板：标准参数 + 自定义，滑杆实时驱动；参数联动矩阵视图
- 变形器：warp 顶点变形、rotation 旋转、parent 层级、权重曲线
- 物理：输出参数绑定、摆锤参数、实时预览、录制对比
- 动作/表情：关键帧时间轴、曲线编辑、内置 idle/说话/眨眼；表情快照切换
- 自动绑定向导：一键跑 9 章服务 → 质检报告展示 → 手动微调入口
- DoD：模型保存/重开不丢状态；所有编辑可撤销重做（命令栈）

### 10.3 预览
- 双预览切换（自研渲染器 / Cubism SDK）；两渲染器共用同一形变/求值公式（对齐官方 ArtMesh 语义）
- 参数求值管线（唯一实现，防止写冲突）：动作曲线 → 表情(Add/Multiply/Overwrite) → 物理输出 → 用户 override（最高）
- 动作台（播放/循环/参数注入）；性能面板（三角面数、纹理内存、帧率）
- DoD：同一参数组在自研渲染器与 Cubism SDK 下输出画面一致（±1px 容差）
- DoD：1 万三角面 + 16 张纹理常规模型 ≥30fps（中端笔记本）

### 10.4 资产库
- 列表/搜索/类型过滤（部位/服装/发型/成人/表情/动作/LoRA）
- 导入导出（zip 包）；一键套用：选资产 → 按 binding_rules 替换部件并重绑

### 10.5 导入导出
- 导入：.model3.json 全家桶（映射规范见 6.3）／PSD（按命名重建）／.l2dp
- PSD 导出规范（保底链）：层组=Part（PARTS 命名含服装组号）、子层=部件纹理、层内路径/参考线标记网格范围、画布取官方模板尺寸（2048² 起、部件满幅排布避免跨页）；发包内置 PARTS 命名树模板 + 官方 PSD 导入规范链接，供 Cubism Editor 直接导入
- 路径区分：自研分层生成的项目走 PSD 保底链；**导入的 moc3 项目再开发走「换图差分 + 参数/物理/动作编辑 + .l2dp→Editor 脚本重建」路径**（已有模型还原回可精修 PSD 官方无现成支持，不承诺）
- 导出：.l2dp / PSD+Cubism 命名（含绑定说明书）／（增值）Editor 脚本包
- 导出前质检：命名（PARTS 规范含服装组号）、网格、参数范围、纹理页引用、分组完整性、分级字段（默认 adult 自动写入）
- DoD：haru_ja 示例导入 → 编辑 → 导出回环无损；导出包可在官方 Cubism Editor 打开并完成精修导出

### 10.6 本地桥集成
- 首次引导：下载/指导安装桥 → 注册 → 状态灯（在线/离线）
- 连接断线：运行中任务标记失败并幂等重入队（生成任务无法断点续跑，只能重跑）；桥重连后按优先级恢复
- DoD：从注册到首次生成任务成功 ≤5 分钟（网络正常）

---

## 11. 分阶段构建计划（agent 按序执行，每阶段完成定义勾选）

### M1 平台骨架（0–4 周）
- [ ] 仓库初始化 + CI/lint/测试基建
- [ ] API：auth、projects、assets CRUD + JWT
- [x] 数据层：SQLite3 schema（sql/sqlite-schema.sql）+ OSS 集成（待密钥）
- [ ] 前端壳：路由、状态、布局；项目列表/详情页
- [ ] 生成网关骨架：Job 创建/查询/取消 + Redis 队列 + WS 进度
- [ ] packages/l2dp：schema 校验 + 读写库（含命名/网格校验规则）
- [ ] DoD: 可注册登录 → 建项目 → 上传资产 → 建 job 入队（planned）

### M2 素材工厂 v1 + 人脸装配 v1（5–10 周）
- [ ] AI 服务：ComfyUI 对接（模板 1/2/3）+ 云适配层（即梦/通义万相/DALL·E 任一可用即达标）
- [ ] 素材工厂 UI：向导/队列进度/结果入库
- [ ] 自动分层服务 v1（模板 6 + 9 管线：本地/托管/半自动三模式）
- [ ] 自动绑定服务 v1（脸部，**半自动装配导向**：Haru 部件模板槽拖入 + 自动参数挂接；全自动后置 P1）
- [ ] 装配台 v1：画布/部件树/网格编辑/参数面板/撤销重做
- [ ] 自研渲染器 v1（分层渲染 + 参数驱动变形）
- [ ] 导入 haru_ja 示例（仅作开发/测试 fixture，许可=非公开测试用途）→ SDK 预览 → .l2dp 映射 → 导出回环
- [ ] DoD: 生成立绘→自动分层→入库→半自动面部装配→预览可动→导出 PSD 全链路跑通；6 成用户 5 步内完成面部装配；haru_ja 回环无损；无桥用户（半自动模式）同样可达闭环

### M3 全身与成人（11–16 周）
- [ ] 自动绑定全身（Pose + 肢体模板）
- [ ] 物理系统（发丝/胸部/裙摆/饰品）
- [ ] 动作/表情编辑器 + 内置动作
- [ ] 成人素材全流程（模板 9 + 路由硬约束验证）
- [ ] 角色 LoRA 训练接入（模板 8）
- [ ] 资产库 v1（套用/换装）：服装层按 costume_group 成组切换（Haru 双服装组范式）；成人器官部件 + PARAM_BUST_Y 物理
- [ ] DoD: 全身成人角色 demo 端到端完成；R-18 任务确认从未进入云侧

### M4 集成打磨与导出闭环（17–24 周）
- [ ] Editor 脚本化导出 PoC（导入 .l2dp → 输出 .moc3）【并行】
- [ ] 素材工厂/装配台/预览联调打磨、性能达标
- [ ] 端到端验收（12 章用例）全绿
- [ ] 部署（Web 集群 + 网关 + SQLite/可迁移 PG + OSS/MinIO）
- [ ] DoD: 10 位内测用户 3 日内独立完成一个导出模型；.moc3 在 VTube Studio 可载入

---

## 12. 端到端验收脚本（agent 自测）

1. 注册 → 建项目 → 建角色档案（含参考图） → 生成立绘素材 → 入库
2. 自动分层 → 半自动装配（模板部件槽 + 自动参数挂接） → 预览播放 idle → 导出 PSD；无桥用户全程半自动模式完成同一用例
3. 成人项目：建 adult job → 校验 route=local；无桥时返回配置引导
4. 导入示例 .model3.json → SDK 预览 → 换装（资产套用）→ 原格式写回
5. 错误路径：云 API 失败 → 降级本地成功；任务取消在中途生效
6. 性能：1 万三角面 + 16 纹理 ≥30fps；断网重连桥任务续跑
7. 官方模型回环：haru_ja 导入 → 参数/部件/物理/动作/表情完整映射 → 编辑一处 → 导出；再导入无结构损失
8. 换装：衣服/内衣/鞋按服装组切换，身体层器官不受影响；成人部位（胸/阴部）保留并参与物理
9. 并发/故障：50 并发建 job + 桥离线 30 分钟重连后积压恢复且无重复扣费（幂等键生效）
10. 单桥并发调度：任务排队顺序按优先级正确（成人任务最高）

---

## 13. 工程约束与质量门禁

- 代码：ESLint + Prettier + TS strict；核心库（l2dp/renderer/ai）单测覆盖率 ≥80%
- 性能预算：编辑态常规交互 <100ms；预览 ≥30fps（中端笔记本，1 万三角面+16 纹理）；首屏 <3s（gzip CDN）
- 渲染策略：纹理页图集合并（>8 部件/页）、draw call 排序合并、闲置层级 LOD；GPU 常驻纹理内存预算上限 128MB
- 安全：JWT 短时 + 刷新；上传按文件魔数校验（防伪装扩展名）；OSS 下载预签名 URL 短时有效；桥凭证短期签名；审计日志落库；adult 任务记录提示词哈希（可审计不可逆）
- 可观测：结构化日志 + 指标（任务成功率/延迟）+ 错误上报
- 合规字段：所有导出产物强制写 grade 字段（默认 adult）；成人任务日志留存用于审计

---

## 14. 保留边界（一行）

- NSFW 未成年人形象：全链路禁止；成人任务仅限本地 ComfyUI 执行。
- Cubism Core / Cubism Editor 为不可替代的闭源依赖：许可（免费但限规模与标注）发布前由法务核对；产品内置 demo 使用自生成资产，不分发官方示例模型。


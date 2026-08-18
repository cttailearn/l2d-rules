# Haru 官方示例模型对照分析（用于修订 v2.0 开发规格）

> 分析对象：G:\\AI\\live2d设计平台\\haru_ja（Live2D 官方 Haru 示例，含 Cubism Editor 源文件与 runtime 分发包）
> 结论先行：Haru 直接验证了「身体层/服装层」双层资产模型、双服装组换装范式、成人部位可用标准参数（PARAM_BUST_Y 胸部摆动）；同时暴露了 v2.0 中 8 处需要修正/补充的规格点。

---

## 1. 文件结构清单（真实样例）

| 文件 | 大小 | 说明 |
|---|---|---|
| haru_t01.cmo3 | 11.9MB | Cubism Editor 场景源文件（编辑态工程） |
| haru_motions_t01.can3 / haru_expressions_t01.can3 / haru_normal_voice_t01.can3 | ~0.4MB | Cubism Editor 动画/表情/语音源 |
| runtime/haru.moc3 | 231KB | 网格与变形数据（二进制，私有格式） |
| runtime/haru.model3.json | 2.5KB | 主模型清单（FileReferences/Groups/HitAreas） |
| runtime/haru.cdi3.json | 4.5KB | DisplayInfo：参数表 + 部件表（含日文名） |
| runtime/haru.physics3.json | 3.3KB | 物理（2 组摆动） |
| runtime/haru.pose3.json | 298B | 姿态（手臂联动组） |
| runtime/haru.1024/texture_00/01/02.png | 3 页 1024² | 多纹理图集页面 |
| runtime/expressions/*.exp3.json | 8 个 | 表情（Add 混合） |
| runtime/motion/*.motion3.json | 23 个 | 动作（含声音引用） |
| runtime/sounds/*.wav | 10 个 | 动作配音（口型素材） |

关键结论：分发包 XML 级结构 = moc3 + model3.json + 多页纹理 + physics + pose + cdi3 + motions(分组+声音) + expressions。**v2.0 的 .l2dp 格式必须以这套结构为对齐基准**（此前简化过度）。

---

## 2. 标准参数集（32 个，官方 ID 命名）

官方 ID 采用 PARAM_ 前缀全大写风格，**v2.0 第 0.6 条写的 ParamAngleX 等社区命名是错的**，须修正为下表（Haru 全集即最低白名单）：

| 参数 ID | 含义 | 参数 ID | 含义 |
|---|---|---|---|
| PARAM_ANGLE_X / Y / Z | 头角度 | PARAM_EYE_L_OPEN / R | 眼开合 |
| PARAM_EYE_L_SMILE / R | 眼笑 | PARAM_EYE_FORM | 眼形变 |
| PARAM_EYE_BALL_X / Y | 瞳孔位移 | PARAM_EYE_BALL_FORM | 瞳孔收缩 |
| PARAM_BROW_L_Y / R_Y | 眉上下 | PARAM_BROW_L_X / R_X | 眉左右 |
| PARAM_BROW_L_ANGLE / R | 眉角度 | PARAM_BROW_L_FORM / R | 眉形变 |
| PARAM_MOUTH_FORM | 嘴形 | PARAM_MOUTH_OPEN_Y | 嘴开合 |
| PARAM_TERE | 害羞(脸红) | PARAM_BODY_ANGLE_X / Y / Z | 身体角度 |
| PARAM_BREATH | 呼吸 | PARAM_ARM_L_A / R_A | 上臂 |
| PARAM_ARM_L_B / R_B | 前臂 | PARAM_BUST_Y | 胸部摆动（成人部位物理可直接用） |
| PARAM_HAIR_FRONT | 前发摆动 | PARAM_HAIR_BACK | 后发摆动 |

## 3. 部件集（26 个）与双服装组范式

部件 ID 模式：PARTS_01_<部件名>_<服装组号>。_001=连衣裙组、_002=制服组 → **官方自己的换装范式 = 同身体、多服装组部件集切换**，与用户要求的「服装层面资产（衣服/鞋/内衣等）」完全一致。

| 分类 | 部件（Haru 命名 → 中文） |
|---|---|
| 身体器官 | 顔(脸)、頬(颊)、耳、鼻、目(眼)、目玉(瞳孔)、まゆ毛(眉)、口、首(颈) |
| 头发 | 前髪(前发)、横髪(侧发)、後ろ髪(后发) |
| 服装组 A（_001） | ワンピース(连衣裙)、腕 A/B（服装上的袖子部件） |
| 服装组 B（_002） | 制服(校服)、腕 A/B |
| 工程辅助 | [ 下絵 ](底稿)、背景、ラフ(草稿)、コアパーツ(核心部件) |

## 4. 物理/姿态/动作/表情结构（对齐基准）

- physics3.json：Meta{PhysicsSettingCount, EffectiveForces{Gravity,Wind}, PhysicsDictionary[]} + PhysicsSettings[{Id, Input[{Source{Target:'Parameter',Id}, Weight, Type('X'|'Angle'), Reflect}], Output[{Destination, VertexIndex, Scale, Weight, Type, Reflect}], Vertices[{Position,Mobility,Delay,Acceleration,Radius}], Normalization{Position/Angle:{Min,Default,Max}}}]。Haru 演示：输入=头/体角度 → 输出=PARAM_HAIR_FRONT/BACK。
- pose3.json：{"Type":"Live2D Pose", Groups:[[{Id, Link[]}]]}（手臂 A/B 联动）。
- motion3.json：Meta{Duration,Fps,Loop,CurveCount,TotalSegmentCount,...} + Curves[{Target:'Parameter', Id, Segments:[扁平关键帧+贝塞尔]} ]。
- exp3.json：{"Type":"Live2D Expression", Parameters:[{Id, Value, Blend:'Add'|'Multiply'|'Overwrite'}]}。
- model3.json：FileReferences{Moc,Textures[],Physics?,Pose?,DisplayInfo?,Motions{<组名>:[{File, Sound?}]}}, Groups[{Target:'Parameter', Name:'LipSync'|'EyeBlink', Ids[]}], HitAreas[]。

## 5. 对 v2.0 的修改点清单

| # | 修改 | 主文档章节 |
|---|---|---|
| 1 | 标准参数白名单改用官方 PARAM_* ID（Haru 32 参数为最低集） | 0.6 / 6 / 9.3 |
| 2 | .l2dp 增加多纹理页（textures[] + uvBounds.page），对齐 3 页图集 | 6.1 / 6.2 |
| 3 | .l2dp 增加 groups(参数组 EyeBlink/LipSync)、hitareas、pose、displayInfo/layout | 6.2 |
| 4 | .l2dp motions 对齐 motion3 结构（Meta+Curves 分段贝塞尔，支持 Sound）；expressions 对齐 exp3（Blend） | 6.2 |
| 5 | .l2dp physics 对齐 physics3 schema（Input/Output/Vertices/Normalization），替代简化摆锤 | 6.2 |
| 6 | 资产双层分类：assets.category enum('body','clothing') + type 细化（内衣/衣服/鞋/发型配件/胸/阴部等）；部件命名支持服装组后缀 _NNN | 4 / 6 / 10 |
| 7 | 分层映射表 9.1 改用 Haru 真实部件命名（前发/侧发/后发/脸/颊/耳/鼻/目/瞳孔/眉/口/颈/肢/体+服装组），成人器官（胸/阴部）独立部件 | 9.1 |
| 8 | 导入导出必须完整映射 Groups/HitAreas/Pose/Motions 分组+声音；haru_ja 作为导入回环自测 fixture | 10.5 / 12 |

## 6. 资产双层分类设计（用户确认的素材观）

| 层级 | 定义 | 资产类型 | Haru 参考 |
|---|---|---|---|
| body（身体层） | 生物器官，不可脱换 | 头发（发丝：前发/侧发/后发）、眼睛、眉、嘴、鼻、耳、脸/皮肤、胸、阴部、四肢 | 顔/目/口/前髪/後髪… |
| clothing（服装层） | 可脱换外观 | 发型（发型配件/造型）、内衣、上衣、下身、连衣裙、鞋、袜、饰品 | ワンピース组/_002 制服组 |

待确认点：用户把「发型」列入服装层（与身体层「头发」并列）→ 本设计按「头发=发丝本体(身体层)，发型=可换造型配件(服装层)」落地。


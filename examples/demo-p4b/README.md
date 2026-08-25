# demo-p4b —— 原图 → 拆解 → 绑定 → 驱动 全链路（P4 完整通道）

```bash
npm run start   # 产出 out/: 原图 PNG + .l2dm + RigSpec + 预览帧 + report.txt
npm run bridge  # HttpSegmenter + LlmLabeler（确定性 mock LLM）
npm run bridge-llm  # 真实 LLM 全链（设 LLM_API_KEY）：LlmDesigner（few-shot 生成指令）+ LlmRepairer（自修复）+ LlmReviewer（多模态审核）
```

链路（全部 @l2dp/*，零平台依赖、确定性）：
1. **原图**：内存绘制一张"半身角色立绘"（透明底 + 平坦色，模拟已抠图上传的 PNG）。
2. **拆解**：`@l2dp/cutout` ColorKeySegmenter → 候选选区；ColorMapLabeler（素材色板规范）→ 语义部件（含左右）。
3. **设计（P4 few-shot）**：`@l2dp/host` LlmDesigner 从切图候选经 LLM 结构化输出生成完整 `CreationDirective`（含 parts + motions + hinge/physics），替代默认映射。
4. **绑定**：`@l2dp/rig` 半自动绑定——参数挂接 + warp 形变合成 + 自动顺序/物理；校验 + 质检报告。
5. **自修复（P4 回注）**：`LlmRepairer` 读取校验问题，LLM 修正指令（≤3 轮）。
6. **驱动**：`@l2dp/create` 生成 idle/blink/talk/surprise 基础动作；并用 `@l2dp/driver`（StreamIngestor + LayerStack + EnvironmentLayer + Evaluator）以 JSONL 指令流驱动，软件渲染出预览帧。

宿主只需把 ColorKeySegmenter 换成 U2Net/SAM2（实现 `Segmenter`）、ColorMapLabeler 换成视觉 LLM（实现 `Labeler`），即从"示范场景"升级为"任意上传原图"。

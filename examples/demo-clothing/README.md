# demo-clothing —— 服装层双服装组换装演示（B-3）

演示 @l2dp/rig 的**服装层**能力：同一角色多套服装组（Haru 双服装组范式 _001/_002），
运行时用 `outfit` op 切换可见服装组。

- **服装语义**：outfit_dress / outfit_top / outfit_bottom / outfit_shoes / hairstyle 等（specs/parts-naming.json clothingPartTemplates）
- **换装机制**：服装部件挂 `opacityParam: 衣装组<N>`，引擎按参数显隐（partVisible opacity>0）；
  `RigSpec.costumes` 审计给出 组→部件 映射
- **驱动契约**（@l2dp/driver）：host 的 `HostOpHandler.outfit` 默认实现 = `outfitLines(costumes, n)`
  → 生成 `set 衣装组N=…` override 行 → StreamIngestor 逐行生效
- **确定性/零依赖**：软件光栅出图，无 GPU

## 运行

```bash
npm start    # rig 双服装组模型 → 组1/组2 直驱帧 + outfit JSONL 换装帧 → out/*.png + report.txt
npm test     # 2 例：换装像素变化 / outfitLines 经 ingestor 生效
```

## 链接
- rig 服装层：packages/rig（types/vocab/params B-3）
- driver 换装工具：packages/driver/src/layers/host-ops.ts（outfitLines / costumeGroupFromParam）
- 计划文档：docs/REVIEW-OPTIMIZATION-PLAN.md §5 B-3

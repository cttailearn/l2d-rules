// .l2dm 校验器 —— DEVELOPMENT-SPEC §5.2（7 类规则，全部实现）
// 输出结构 `{ ok, issues: [{path, message}] }` 与 l2dp validate 一致。
// 校验不依赖加载后的纹理位图，仅验引用/几何/范围；atlas 文件存在性由 loader 阶段补充检查。

import { L2DM_FORMAT_VERSION, L2DM_PARAM_GROUPS, type L2dmModel } from "./types.ts";

export interface L2dmIssue {
  path: string;
  message: string;
}

export interface L2dmValidation {
  ok: boolean;
  issues: L2dmIssue[];
}

function push(issues: L2dmIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 列表中的数值是否单调递增（严格递增，validator 保证 keyform/网格轴不重复断层） */
function isStrictAscending(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (!(values[i] > values[i - 1])) return false;
  }
  return true;
}

/**
 * 校验 .l2dm 模型（§5.2 规则 1–7）。
 * @param model 已通过结构解析的模型对象（loader 产出的 L2dmModel）
 * @param atlasFiles 可选：可用 atlas 文件名集合（loader 阶段传入，检查 texture 引用存在性）
 */
export function validateL2dmModel(model: L2dmModel, atlasFiles?: ReadonlySet<string>): L2dmValidation {
  const issues: L2dmIssue[] = [];

  // ---- 版本 / 根字段 ----
  if (model.formatVersion !== L2DM_FORMAT_VERSION) {
    push(issues, "formatVersion", `formatVersion 必须为 ${L2DM_FORMAT_VERSION}`);
  }
  if (typeof model.id !== "string" || model.id.length === 0) {
    push(issues, "id", "id 必须为非空字符串（= 语义层角色名）");
  }
  if (!isFiniteNum(model.canvas?.width) || model.canvas.width <= 0 || !isFiniteNum(model.canvas?.height) || model.canvas.height <= 0) {
    push(issues, "canvas", "canvas 宽高必须为正数");
  }

  // ---- 内嵌资源（atlas）：可用纹理 = 显式 atlasFiles ∪ 内嵌键；条目值需为 data URI/base64 ----
  const availableAtlas = new Set<string>(atlasFiles ?? []);
  const hasAtlasContext = (atlasFiles !== undefined && atlasFiles.size > 0) ||
    (model.atlas !== undefined && Object.keys(model.atlas).length > 0);
  if (model.atlas) {
    for (const [name, v] of Object.entries(model.atlas)) {
      if (name.length === 0) {
        push(issues, "atlas", "atlas 文件名不能为空");
        continue;
      }
      availableAtlas.add(name);
      if (typeof v !== "string" || v.length === 0) {
        push(issues, `atlas."${name}"`, "值必须为非空字符串");
      } else if (!/^data:image\/[a-z0-9.+-]+;base64,/.test(v) && !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) {
        push(issues, `atlas."${name}"`, "值必须为 data URI('data:image/*;base64,') 或 base64 字符串");
      }
    }
  }

  // ---- 规则 1：参数 ----
  const paramIds = new Set<string>();
  (model.parameters ?? []).forEach((p, i) => {
    const path = `parameters[${i}] (${p.id})`;
    if (typeof p.id !== "string" || p.id.length === 0) {
      push(issues, path, "参数 id 必须为非空字符串");
      return;
    }
    if (paramIds.has(p.id)) push(issues, `parameters[${i}]`, `参数 id 重复: '${p.id}'`);
    paramIds.add(p.id);
    if (!isFiniteNum(p.min) || !isFiniteNum(p.max) || p.min >= p.max) {
      push(issues, path, `范围无效: min(${p.min}) 必须 < max(${p.max})（允许负区间）`);
    }
    if (p.def !== undefined && (!isFiniteNum(p.def) || p.def < p.min || p.def > p.max)) {
      push(issues, path, `默认值 def(${p.def}) 必须在 [min,max] 内`);
    }
    if (p.group !== undefined && !(L2DM_PARAM_GROUPS as readonly string[]).includes(p.group)) {
      push(issues, path, `group '${p.group}' 不在规范组 ${L2DM_PARAM_GROUPS.join("/")} 内`);
    }
  });

  // ---- 规则 2：部件 / deformer ----
  const partIds = new Set<string>();
  (model.parts ?? []).forEach((pt, i) => {
    const path = `parts[${i}] (${pt.id})`;
    if (typeof pt.id !== "string" || pt.id.length === 0) {
      push(issues, path, "部件 id 必须为非空字符串");
      return;
    }
    if (partIds.has(pt.id)) push(issues, `parts[${i}]`, `部件 id 重复: '${pt.id}'`);
    partIds.add(pt.id);
    if (isFiniteNum(pt.order) === false) push(issues, path, "render order 必须为数字");
    // 规则 6 前半：uvRect ∈ [0,1]
    if (pt.uvRect) {
      const { x, y, width, height } = pt.uvRect;
      const uv = ["x", "y", "width", "height"] as const;
      const vs = [x, y, width, height];
      if (!vs.every(isFiniteNum)) push(issues, `${path}.uvRect`, "uvRect 各分量必须为数字");
      if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
        push(issues, `${path}.uvRect`, "uvRect 必须在 [0,1] 内且不越界");
      }
    }
    if (pt.color && (pt.color.length !== 4 || !pt.color.every(isFiniteNum))) {
      push(issues, `${path}.color`, "color 必须为 4 个数字 (r,g,b,a)");
    }
    // 规则 6 后半：atlas 引用存在（显式 atlasFiles ∪ 内嵌 atlas；两者皆无则跳过检查，保持向后兼容）
    if (pt.texture !== undefined && hasAtlasContext && !availableAtlas.has(pt.texture)) {
      push(issues, `${path}.texture`, `atlas 文件 '${pt.texture}' 在可用纹理集中不存在`);
    }
    // opacityParam 引用的参数必须存在
    if (pt.opacityParam !== undefined && !paramIds.has(pt.opacityParam)) {
      push(issues, `${path}.opacityParam`, `引用的参数 '${pt.opacityParam}' 不存在`);
    }
  });

  // deformer：id 唯一 + parent 成环检测（规则 2 后半）
  const defers = model.deformers ?? [];
  const deferIds = new Set<string>();
  defers.forEach((d, i) => {
    const path = `deformers[${i}] (${d.id})`;
    if (typeof d.id !== "string" || d.id.length === 0) { push(issues, path, "deformer id 必须为非空字符串"); return; }
    if (deferIds.has(d.id)) push(issues, `deformers[${i}]`, `deformer id 重复: '${d.id}'`);
    deferIds.add(d.id);
  });
  // part.parent 引用的 deformer 必须存在
  (model.parts ?? []).forEach((pt, i) => {
    if (pt.parent !== undefined && !deferIds.has(pt.parent)) {
      push(issues, `parts[${i}] (${pt.id}).parent`, `引用的 deformer '${pt.parent}' 不存在`);
    }
  });
  // deformer.parent 必须存在且树不成环（DFS）
  defers.forEach((d, i) => {
    if (d.parent !== undefined && !deferIds.has(d.parent)) {
      push(issues, `deformers[${i}] (${d.id}).parent`, `引用的父 deformer '${d.parent}' 不存在`);
    }
  });
  detectDeformerCycles(defers, issues);

  // ---- 规则 3/4：mesh / warp ----
  (model.parts ?? []).forEach((pt, pi) => {
    const m = pt.mesh;
    if (!m) return;
    const base = `parts[${pi}] (${pt.id}).mesh`;
    const n = m.vertices.length;
    if (n === 0 || n % 2 !== 0) push(issues, `${base}.vertices`, `vertices 长度必须为偶数且非空（得 ${n}）`);
    if (m.uvs.length !== n) push(issues, `${base}.uvs`, `uvs 长度(${m.uvs.length}) 必须等于 vertices 长度(${n})`);
    if (m.indices.length === 0) push(issues, `${base}.indices`, "indices 不能为空（无三角形可画）");
    if (m.indices.length % 3 !== 0) push(issues, `${base}.indices`, `indices 长度必须为 3 的倍数（得 ${m.indices.length}）`);
    m.indices.forEach((idx, ii) => {
      if (!Number.isInteger(idx) || idx < 0 || idx * 2 + 1 >= n) {
        push(issues, `${base}.indices[${ii}]`, `索引 ${idx} 越界（顶点数 ${n / 2}）`);
      }
    });
    // 规则 3：warps（1D）
    (m.warps ?? []).forEach((w, wi) => {
      const wb = `${base}.warps[${wi}]`;
      if (!paramIds.has(w.parameter)) push(issues, `${wb}.parameter`, `引用的参数 '${w.parameter}' 不存在`);
      if (w.keyforms.length < 2) push(issues, `${wb}.keyforms`, "keyforms 至少 2 个");
      if (!isStrictAscending(w.keyforms.map(k => k.value))) push(issues, `${wb}.keyforms`, "keyforms value 必须单调递增");
      w.keyforms.forEach((k, ki) => {
        if (k.offsets.length !== n) push(issues, `${wb}.keyforms[${ki}].offsets`, `offsets 长度(${k.offsets.length}) 必须等于 vertices 长度(${n})`);
      });
    });
    // 规则 4：warp2D
    (m.warp2d ?? []).forEach((w2, wi) => {
      const wb = `${base}.warp2d[${wi}]`;
      const [px, py] = w2.parameters;
      if (!paramIds.has(px)) push(issues, `${wb}.parameters[0]`, `引用的参数 '${px}' 不存在`);
      if (!paramIds.has(py)) push(issues, `${wb}.parameters[1]`, `引用的参数 '${py}' 不存在`);
      if (w2.valuesX.length < 2) push(issues, `${wb}.valuesX`, "valuesX 至少 2 个");
      if (!isStrictAscending(w2.valuesX)) push(issues, `${wb}.valuesX`, "valuesX 必须单调递增");
      if (w2.valuesY.length < 2) push(issues, `${wb}.valuesY`, "valuesY 至少 2 个");
      if (!isStrictAscending(w2.valuesY)) push(issues, `${wb}.valuesY`, "valuesY 必须单调递增");
      const expect = w2.valuesX.length * w2.valuesY.length;
      if (w2.keyforms.length !== expect) push(issues, `${wb}.keyforms`, `keyforms 数(${w2.keyforms.length}) 必须 = lenX×lenY(${expect})`);
      w2.keyforms.forEach((k, ki) => {
        if (k.offsets.length !== n) push(issues, `${wb}.keyforms[${ki}].offsets`, `offsets 长度(${k.offsets.length}) 必须等于 vertices 长度(${n})`);
      });
    });
  });

  // ---- 规则 5：bindings ----
  defers.forEach((d, di) => {
    (d.bindings ?? []).forEach((b, bi) => {
      const bpath = `deformers[${di}] (${d.id}).bindings[${bi}]`;
      if (!paramIds.has(b.parameter)) push(issues, `${bpath}.parameter`, `引用的参数 '${b.parameter}' 不存在`);
      if (b.from === b.to) push(issues, `${bpath}`, "from 必须 ≠ to");
      const channels = ["rotation", "scaleX", "scaleY", "x", "y"] as const;
      if (!(channels as readonly string[]).includes(b.channel)) push(issues, `${bpath}.channel`, `非法 channel '${b.channel}'`);
    });
  });

  // ---- 规则 7：physics ----
  (model.physics?.pendulums ?? []).forEach((pd, i) => {
    const pth = `physics.pendulums[${i}] (${pd.id})`;
    if (!paramIds.has(pd.input)) push(issues, `${pth}.input`, `输入参数 '${pd.input}' 不存在`);
    (pd.outputParams ?? []).forEach((op, oi) => {
      if (!paramIds.has(op)) push(issues, `${pth}.outputParams[${oi}]`, `输出参数 '${op}' 不存在`);
    });
  });

  // ---- pose：联动组 id 必须引用存在的部件 ----
  (model.pose?.groups ?? []).forEach((g, gi) => {
    (g.ids ?? []).forEach((pid, ii) => {
      if (!partIds.has(pid)) push(issues, `pose.groups[${gi}].ids[${ii}]`, `部件 '${pid}' 不存在`);
    });
  });

  return { ok: issues.length === 0, issues };
}

/** deformer 树成环检测（DFS 三色标记） */
function detectDeformerCycles(
  defers: { id: string; parent?: string }[],
  issues: L2dmIssue[],
): void {
  const byId = new Map(defers.map(d => [d.id, d]));
  const state = new Map<string, 0 | 1 | 2>(); // 0=未访问 1=访问中 2=完成
  const visit = (id: string, trail: string[]): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 2) return false; // 已完成
    if (s === 1) {
      push(issues, `deformers (${id})`, `deformer 层级成环: ${trail.concat(id).join(" → ")}`);
      return true;
    }
    state.set(id, 1);
    const d = byId.get(id);
    if (d?.parent !== undefined) visit(d.parent, trail.concat(id));
    state.set(id, 2);
    return false;
  };
  for (const d of defers) visit(d.id, []);
}

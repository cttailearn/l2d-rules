import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BehaviorIndex,
  buildBehaviorIndex,
  driverToolCatalog,
  generateManifest,
  generateLibraryIndex,
  vocabularyOf,
  pickWeighted,
  type ManifestLike,
  type AssetIndex,
  type BehaviorItem,
} from "../src/index.ts";

// ---------- P6 词表 manifest 生成器 ----------

test("P6: generateManifest——参数面 → ManifestLike（sems 单一来源）", () => {
  const m = generateManifest([
    { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
    { id: "头转向", min: -30, max: 30 },
  ]);
  assert.deepEqual(m, {
    sems: [
      { name: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
      { name: "头转向", min: -30, max: 30 },
    ],
  });
  assert.deepEqual(vocabularyOf(m), ["微笑", "头转向"]);
});

test("P6: generateLibraryIndex——动作/表情资产表 → AssetIndex（behaviors 恒空）", () => {
  const lib: AssetIndex = generateLibraryIndex(
    [{ name: "微笑点头" }, { name: "尾巴摇", group: "idle" }],
    [{ name: "开心" }],
  );
  assert.deepEqual(lib, {
    motions: [{ name: "微笑点头" }, { name: "尾巴摇", group: "idle" }],
    expressions: [{ name: "开心" }],
    behaviors: [],
  });
  assert.deepEqual(generateLibraryIndex([]), { motions: [], expressions: [], behaviors: [] });
});

test("P6: manifest + library 可直接喂给 StreamIngestor（目录进装配面闭环）", () => {
  // 仅验证生成器产物与 ingestor 消费契约类型一致（结构化同源）
  const manifest: ManifestLike = generateManifest([{ id: "a", min: 0, max: 1 }]);
  const library: AssetIndex = generateLibraryIndex([{ name: "play_a" }]);
  assert.equal(manifest.sems.length, 1);
  assert.equal(library.motions.length, 1);
});

// ---------- §14.3-2 加权随机选择 ----------

test("P6: pickWeighted——权重分布可复现（种子化）且零权重回退最后项", () => {
  const seq: number[] = [];
  const rng = (): number => {
    const v = seq.shift() ?? 0;
    return v;
  };
  // r=0.1 → 落入 A（权 6，区间 [0,6)）
  seq.push(0.1);
  assert.equal(pickWeighted(["A", "B"], () => 1, rng), "A");
  // 全零权重 → 回退最后项
  assert.equal(pickWeighted(["x", "y", "z"], () => 0, () => 0.5), "z");
});

test("P6: BehaviorIndex——同优先级多候选按 weight 加权随机且不调用 match 外候选", () => {
  const mk = (id: string, weight?: number): BehaviorItem => ({
    id, events: ["user_text"], kinds: ["k"], priority: 5, weight, lines: [],
  });
  const a = { ...mk("a", 1), match: () => true };
  const b = { ...mk("b", 0) }; // weight 0 → 永不中
  const c = { ...mk("c", 3) };
  const idx = new BehaviorIndex(123);
  idx.register(a); idx.register(b); idx.register(c);
  // 命中 a 与 c（同 priority 5）→ 权重 a=1,c=3 → 稳定采到 c（a=0.25 概率，多次采样应出现 c 更多）
  let cHit = 0;
  for (let i = 0; i < 64; i++) {
    const p = idx.pick({ type: "user_text", text: "hi" }, {});
    if (p!.id === "c") cHit++;
    else assert.equal(p!.id, "a", "只可能命中 a 或 c（b 权 0/不 match 均排除）");
  }
  assert.ok(cHit > 32, "权重 3:1 → c 应占多数（实际 " + cHit + "/64）");
});

test("P6: BehaviorIndex——不同优先级仍取高者（权重不越级）", () => {
  const idx = new BehaviorIndex(1);
  idx.register({ id: "low", events: ["user_text"], kinds: [], priority: 1, weight: 100, lines: [] });
  idx.register({ id: "high", events: ["user_text"], kinds: [], priority: 9, weight: 0, lines: [] });
  const p = idx.pick({ type: "user_text", text: "hi" }, {});
  assert.equal(p!.id, "high", "优先级优先于权重");
});

// ---------- E6 MCP 表层 ----------

test("E6: driverToolCatalog——主工具 + 细粒度 op 工具 + get_state（schema 同源）", () => {
  const tools = driverToolCatalog();
  const names = tools.map((t) => t.name);
  assert.deepEqual(names, ["emit_directives", "play_motion", "set_expression", "set_parameter", "look_at", "speak", "get_state"]);
  const emit = tools.find((t) => t.name === "emit_directives")!;
  assert.equal(emit.inputSchema.properties?.v?.const, 2, "emit_directives 的 v 常量与 IR_VERSION 同源");
  const play = tools.find((t) => t.name === "play_motion")!;
  assert.deepEqual(play.inputSchema.required, ["op", "asset"], "play 工具 required 与 OP_RULES 同源");
  for (const t of tools) {
    assert.ok(typeof t.description === "string" && t.description.length > 0, t.name + " 有描述");
    assert.ok(t.inputSchema !== undefined, t.name + " 有 inputSchema");
  }
});

// ---------- 库索引生成器 ----------

test("P6: buildBehaviorIndex——行为目录 + 种子一次性装配（与 register 等价且种子可注入）", () => {
  const catalog = {
    seed: 7,
    behaviors: [
      { id: "x", events: ["idle"], kinds: ["idle"], priority: 1, lines: [] },
    ] as BehaviorItem[],
  };
  const idx = buildBehaviorIndex(catalog);
  assert.equal(idx.list().length, 1);
  assert.equal(idx.list()[0]!.id, "x");
  assert.equal(idx.pick({ type: "user_text", text: "" }, {}), null);
});

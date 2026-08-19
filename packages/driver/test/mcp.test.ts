// mcp —— 同源工具清单 + 薄桥（DEVELOPMENT-SPEC §9）
// 目标：工具 schema 与 IR 规则库（OP_RULES）同源；工具调用落地为与手写 JSONL 完全同源
// 的指令对象（同一 opShapeIssues）。覆盖：
//   1) 清单完整性：恰好 7 工具（emit_directives 主 + play_motion/set_expression/set_parameter/look_at/speak/get_state）
//   2) 同源：指令类工具参数 = perOpSchema(op) 去掉 op（properties/required/子 schema 逐键一致）
//   3) emit_directives 参数 ≡ emitDirectiveSchema()（直接复用）
//   4) 往返：每指令工具合法参数 → 指令对象注入 op → opShapeIssues 通过
//   5) 非法拒绝：表外字段 FORBIDDEN / 缺 required / 坏 directives 行整批失败 / 未知工具
//   6) get_state 只读识别

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_TOOL_DEFS,
  MCP_TOOL_NAMES,
  mcpToolsList,
  mcpToolsOpenAI,
  mcpToolSchema,
  toolParametersForOp,
  READ_ONLY_TOOLS,
  type McpToolName,
  type OpenAiTool,
} from "../src/mcp/tools.ts";
import { toolCallToDirectives, type ToolCallLike } from "../src/mcp/bridge.ts";
import { perOpSchema, emitDirectiveSchema, type JsonSchema } from "../src/ir/schema.ts";
import { OP_RULES, opShapeIssues } from "../src/validate/rules.ts";
import type { Op } from "../src/ir/types.ts";

const TOOL_NAMES: McpToolName[] = ["emit_directives", "play_motion", "set_expression", "set_parameter", "look_at", "speak", "get_state"];

test("§9: 工具清单恰好 7 个，emit_directives 为主、get_state 只读", () => {
  assert.deepEqual([...MCP_TOOL_NAMES].sort(), [...TOOL_NAMES].sort());
  const labels = MCP_TOOL_DEFS.map((t) => t.label);
  assert.ok(labels.includes("emit_directives"));
  const defs = new Set(MCP_TOOL_DEFS.map((t) => t.label));
  assert.equal(defs.size, MCP_TOOL_DEFS.length, "工具名不得重复");
  assert.deepEqual(READ_ONLY_TOOLS, ["get_state"]);
  // 非只读工具都必须绑定 IR op
  for (const t of MCP_TOOL_DEFS) {
    if (!t.readOnly && t.label !== "emit_directives") assert.ok(t.toOp, `${t.label} 需绑定 toOp`);
  }
  assert.equal(mcpToolsList().length, 7);
  assert.equal(mcpToolsOpenAI().length, 7);
});

test("§9: 指令类工具参数 = perOpSchema(op) 去掉 op（同源逐键一致）", () => {
  for (const t of MCP_TOOL_DEFS) {
    if (t.readOnly || t.label === "emit_directives") continue;
    const op = t.toOp!;
    const s = perOpSchema(op);
    const tool = toolParametersForOp(op);
    // properties 键 = s.properties 去掉 "op"，子 schema 逐键相同
    const sKeys = Object.keys(s.properties ?? {}).filter((k) => k !== "op").sort();
    assert.deepEqual(Object.keys(tool.properties ?? {}).sort(), sKeys, `${t.label} properties 键不同源`);
    for (const k of sKeys) {
      assert.deepEqual(tool.properties![k], s.properties![k], `${t.label} 字段 '${k}' 的 schema 不同源`);
    }
    // required = OP_RULES[op].required（无 "op"）
    assert.deepEqual(tool.required ?? [], [...OP_RULES[op].required], `${t.label} required 不同源`);
    assert.equal(tool.additionalProperties, false);
    // 工具参数 ∪ {"op"=op} 的键恰好 = perOpSchema 的键（双向一致）
    const toolKeys = new Set([...Object.keys(tool.properties ?? {}), "op"]);
    assert.deepEqual(toolKeys, new Set([...sKeys, "op"]), `${t.label} 与 perOpSchema 键集不一致`);
  }
});

test("§9: emit_directives 参数 ≡ emitDirectiveSchema()（同源复用）", () => {
  assert.deepEqual(mcpToolSchema("emit_directives"), emitDirectiveSchema());
  const openai = mcpToolsOpenAI().find((x) => x.function.name === "emit_directives") as OpenAiTool;
  assert.deepEqual(openai.function.parameters, emitDirectiveSchema());
});

test("§9: get_state 的 inputSchema 为空对象参数（只读）", () => {
  const s = mcpToolSchema("get_state");
  assert.deepEqual(s.properties, {});
  assert.equal(s.additionalProperties, false);
});

test("§9: 往返——每指令工具合法参数 → 注入 op → opShapeIssues 通过", () => {
  const samples: Record<Exclude<McpToolName, "emit_directives" | "get_state">, Record<string, unknown>> = {
    play_motion: { asset: "wave", speed: 1.5, loop: true },
    set_expression: { expression: "smile", weight: 0.5 },
    set_parameter: { sem: "微笑", value: 0.8 },
    look_at: { gaze: [0.2, -0.1] },
    speak: { text: "你好", voice: "default" },
  };
  for (const [name, args] of Object.entries(samples)) {
    const r = toolCallToDirectives({ name, arguments: JSON.stringify(args) } satisfies ToolCallLike);
    assert.ok(r.ok, `${name} 应成功: ${JSON.stringify(r)}`);
    if (!r.ok) continue;
    assert.equal(r.directives.length, 1);
    const d = r.directives[0]!;
    const expectedOp = MCP_TOOL_DEFS.find((t) => t.label === name)!.toOp;
    assert.equal(d.op, expectedOp, `${name} 应注入 op='${expectedOp}'`);
    // 与手写 JSONL 走同一校验
    assert.ok(opShapeIssues(d, 0, true).ok);
    // 载荷字段透传
    for (const [k, v] of Object.entries(args)) assert.deepEqual((d as unknown as Record<string, unknown>)[k], v);
  }
});

test("§9: 对象型参数同样可解析（非 JSON 字符串）", () => {
  const r = toolCallToDirectives({ name: "set_expression", arguments: { expression: "surprise" } });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.directives[0]!.expression, "surprise");
});

test("§9: 表外载荷字段 → FORBIDDEN（与规则库同源拒绝）", () => {
  // play_motion 不允许 text
  const r = toolCallToDirectives({ name: "play_motion", arguments: { asset: "wave", text: "x" } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.rule === "FORBIDDEN"));
});

test("§9: 缺 required → REQUIRED", () => {
  const r = toolCallToDirectives({ name: "set_parameter", arguments: { sem: "微笑" } }); // 缺 value
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.rule === "REQUIRED" && i.path === "value"));
});

test("§9: 参数 JSON 解析失败 / 非对象 → 明确 issue", () => {
  const bad = toolCallToDirectives({ name: "play_motion", arguments: "{oops" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.issues.some((i) => i.rule === "JSON_PARSE"));
  const nonObj = toolCallToDirectives({ name: "play_motion", arguments: "[1,2,3]" } as ToolCallLike);
  assert.equal(nonObj.ok, false);
  if (!nonObj.ok) assert.ok(nonObj.issues.some((i) => i.rule === "SHAPE"));
});

test("§9: emit_directives 透传 directives 数组；坏行整批失败（batch 原子一致）", () => {
  const ok = toolCallToDirectives({
    name: "emit_directives",
    arguments: { directives: [{ op: "play", asset: "wave" }, { op: "face", expression: "smile" }] },
  });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.directives.map((d) => d.op), ["play", "face"]);
    assert.equal(ok.directives[0]!.asset, "wave");
  }
  // 空数组合法
  const empty = toolCallToDirectives({ name: "emit_directives", arguments: { directives: [] } });
  assert.ok(empty.ok);
  // 坏行 → 整批失败
  const bad = toolCallToDirectives({
    name: "emit_directives",
    arguments: { directives: [{ op: "play", asset: "wave" }, { op: "nope" }] },
  });
  assert.equal(bad.ok, false);
  // 缺 directives 数组
  const noArr = toolCallToDirectives({ name: "emit_directives", arguments: {} });
  assert.equal(noArr.ok, false);
  if (!noArr.ok) assert.ok(noArr.issues.some((i) => i.path === "directives"));
});

test("§9: 未知工具 / get_state → 明确结果", () => {
  const unk = toolCallToDirectives({ name: "fly_to_moon" });
  assert.equal(unk.ok, false);
  if (!unk.ok) assert.ok(unk.issues.some((i) => i.rule === "OP"));
  const gs = toolCallToDirectives({ name: "get_state" });
  assert.ok(gs.ok);
  if (gs.ok) {
    assert.equal(gs.readOnly, true);
    assert.deepEqual(gs.directives, []);
    assert.equal(gs.op, undefined);
  }
});

test("§9: MCP 与 OpenAI 两种序列化信息一致", () => {
  const list = mcpToolsList();
  const openai = mcpToolsOpenAI();
  assert.equal(list.length, openai.length);
  for (const t of list) {
    const o = openai.find((x) => x.function.name === t.name)!;
    assert.equal(o.function.description, t.description);
    assert.deepEqual(o.function.parameters, t.inputSchema);
    assert.deepEqual((o as unknown as { type: string }).type, "function");
  }
});

// 反向契约：工具 schema 声明的字段，opShapeIssues 不判 FORBIDDEN（往返，同 C12 模式）
test("§9: 往返——toolParametersForOp 声明的字段在校验器中均被允许", () => {
  for (const t of MCP_TOOL_DEFS) {
    if (t.readOnly || t.label === "emit_directives") continue;
    const op = t.toOp!;
    const props = toolParametersForOp(op).properties ?? {};
    for (const field of Object.keys(props)) {
      if (field === "op") continue;
      if ((["id", "target", "at", "dur", "interrupt"] as string[]).includes(field)) continue; // 公共字段不进载荷判定
      const d = { op, [field]: "x" } as Record<string, unknown>;
      const res = opShapeIssues(d, 0, true);
      if (!res.ok) {
        assert.equal(res.issues.filter((i) => i.rule === "FORBIDDEN").length, 0,
          `op '${op}' 字段 '${field}' 在工具 schema 中允许但校验器判 FORBIDDEN`);
      }
    }
  }
});

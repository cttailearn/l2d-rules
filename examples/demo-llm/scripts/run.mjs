// demo-llm（A4）：真实/模拟 LLM 驱动演示——两跳 + hop 指标 + audit 日志
// 设 LLM_API_KEY（+可选 LLM_BASE_URL/LLM_MODEL）走真实 OpenAI 兼容端点；否则 MockProvider 兜底（确定性）
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BehaviorIndex, DriverEngine, MockProvider, OpenAIProvider,
  StreamIngestor, LayerStack, EnvironmentLayer, Evaluator,
} from "@l2dp/driver";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
await mkdir(OUT, { recursive: true });
const report = [];
const log = (s) => report.push(s);

// 参数面 + 资产（微笑/尾巴摆/头转向）
const defs = [
  { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "尾巴摆", min: 0, max: 1, def: 0, group: "Custom" },
  { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
];
const manifest = { sems: defs.map((d) => ({ name: d.id, min: d.min, max: d.max, def: d.def, group: d.group })) };
const library = {
  motions: [{ name: "微笑点头" }, { name: "尾巴摇" }, { name: "害羞低头" }],
  expressions: [], behaviors: [],
};
const assets = {
  motions: new Map([
    ["微笑点头", { durationMs: 1000, loop: true, curves: [{ id: "微笑", segments: [0, 0, 0, 1, 1] }] }],
    ["尾巴摇", { durationMs: 1000, loop: true, curves: [{ id: "尾巴摆", segments: [0, 0, 0, 1, 1] }] }],
    ["害羞低头", { durationMs: 800, loop: false, curves: [{ id: "头转向", segments: [0, 0, 0, 1, -20] }] }],
  ]),
  expressions: new Map(),
};

// 行为库：第一跳本地规则
const index = new BehaviorIndex();
index.register({ id: "greeting", events: ["user_text"], kinds: ["greeting"], priority: 10, lines: ['{"op":"play","asset":"微笑点头"}'], match: (e) => e.type === "user_text" && /你好|hello|嗨|hi/i.test(e.text) });
index.register({ id: "tailwag", events: ["user_text"], kinds: ["wag"], priority: 9, lines: ['{"op":"play","asset":"尾巴摇"}'], match: (e) => e.type === "user_text" && /尾巴|摇/.test(e.text) });
index.register({ id: "listen", events: ["user_voice"], kinds: ["listen"], priority: 5, lines: [] });

// Provider：有 key 用真实 OpenAI 兼容端点，否则 Mock（确定性）
const apiKey = process.env.LLM_API_KEY;
const provider = apiKey
  ? new OpenAIProvider({
      baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
      apiKey,
      model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    })
  : new MockProvider();
log("[Provider] " + (apiKey ? "OpenAIProvider(真实 " + (process.env.LLM_MODEL ?? "gpt-4o-mini") + ")" : "MockProvider（无 LLM_API_KEY，确定性兜底）"));

const ing = new StreamIngestor({
  manifest, library, assets,
  stack: new LayerStack(defs), env: new EnvironmentLayer(defs, { seed: 7 }), seed: 7,
});
const engine = new DriverEngine({ index, provider, ing });

const cases = [
  { event: { type: "user_text", text: "你好呀！" }, ctx: {} },
  { event: { type: "user_text", text: "摇一下尾巴～" }, ctx: {} },
  { event: { type: "user_text", text: "随便聊聊今天的天气吧" }, ctx: {} },
  { event: { type: "user_voice", text: "（用户说话）" }, ctx: {} },
];
for (const [i, c] of cases.entries()) {
  const r = await engine.dispatch(c.event, c.ctx);
  log("case" + (i + 1) + ": hop=" + r.hop + (r.behaviorId ? " behavior=" + r.behaviorId : "") + " lines=" + r.lines.length + (r.blocked ? " BLOCKED" : ""));
}
log("llmCalls=" + engine.llmCalls + "（第一跳命中不计） audited=" + engine.audit.length);
log("--- audit（前 12 行）---");
for (const a of engine.audit.slice(0, 12)) log("  t=" + a.tMs + " " + a.line);

await writeFile(join(OUT, "report.txt"), report.join("\n") + "\n", "utf8");
console.log(report.join("\n"));
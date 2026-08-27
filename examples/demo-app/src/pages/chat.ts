// pages/chat.ts —— 界面①「聊天助手」浏览器入口
// 舞台（Stage）+ 聊天面板：输入 → 两跳决策 + 台词 + 语音 + 口型 + 动作；支持导入 .l2dm 成为角色。
import { loadL2dm, type L2dmModel } from "@l2dp/engine";
import { Stage, saveImported } from "../stage.ts";
import { need, needInput, needBtn } from "../dom.ts";
import { buildCreatedReactions } from "../creator.ts";
import type { AppCharacter, Emotion } from "../chars.ts";
import type { ReplyOutcome } from "../core.ts";

const stage = new Stage({
  stageWrap: need("stageWrap"),
  bubble: need("bubble"),
  badges: need("badges"),
  charBtns: need("charBtns"),
  presetsEl: need("presets"),
  outfitRow: need("outfitRow"),
  outfitBtns: need("outfitBtns"),
  metricsEl: need("metrics"),
  chatStatsEl: need("chatStats"),
  bgBtns: need("bgBtns"),
  zoomIn: needBtn("zoomIn"),
  zoomOut: needBtn("zoomOut"),
  companionToggle: need("companionToggle"),
  soundToggle: need("soundToggle"),
  chatName: need("chatName"),
  input: needInput("input"),
  statusEl: need("stageStatus"),
  onBoot: (s) => {
    if (!s.core) return;
    if (s.hasWarpMotion) s.status("");
    else {
      s.status(
        "⚠ 当前角色「" + s.core.character.label + "」为基准姿态烘焙（无几何形变）：上方动作预置仅改写参数字段、画面不动。" +
        "要看可见动作请切「小骨架 / 衣装酱 / 我的创作」（或导入带 warp 的 .l2dm）。",
        "warn",
      );
    }
  },
});

const logEl = need("log");
const chipsEl = need("chips");
const inputEl = needInput("input");
const sendBtnEl = needBtn("send");
const importBtn = needBtn("importBtn");
const importFile = need("importFile") as HTMLInputElement;

// ---------------- 聊天 DOM ----------------
function pushUser(text: string): void {
  const m = document.createElement("div");
  m.className = "msg user";
  m.textContent = text;
  logEl.appendChild(m);
  logEl.scrollTop = logEl.scrollHeight;
}

function pushChar(outcome: ReplyOutcome): void {
  const empty = logEl.querySelector(".msg.empty");
  if (empty) empty.remove();
  const m = document.createElement("div");
  m.className = "msg char";
  m.textContent = outcome.replyText;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent =
    "hop=" + outcome.hop +
    (outcome.behaviorId ? " · " + outcome.behaviorId : "") +
    (outcome.usedSound ? " · 🔊" : "") +
    " · " + outcome.lines.length + " 行 JSONL · 生效 " +
    (outcome.applied - outcome.skipped) + " 行 · 台词 " + outcome.speechMs + "ms";
  m.appendChild(meta);
  logEl.appendChild(m);
  logEl.scrollTop = logEl.scrollHeight;
}

function pushSystem(text: string): void {
  const m = document.createElement("div");
  m.className = "msg char";
  m.textContent = text;
  m.style.color = "var(--bad)";
  logEl.appendChild(m);
  logEl.scrollTop = logEl.scrollHeight;
}

async function send(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text || !stage.core) return;
  inputEl.value = "";
  pushUser(text);
  try {
    const outcome = await stage.reply(text);
    if (outcome) pushChar(outcome);
  } catch (e) {
    pushSystem("（我好像卡住了：" + (e as Error).message + "）");
  }
}

// ---------------- 导入 .l2dm ----------------
const IMPORTED_ID = "imported";

/** 从任意 .l2dm 文本构造一个可在 demo-app 中驱动的最小角色规格。 */
function charFromModelText(text: string): AppCharacter {
  const loaded = loadL2dm(text);
  if (!loaded.ok || !loaded.model) throw new Error("不是合法的 .l2dm：" + (loaded.ok ? "?" : loaded.error));
  const model = loaded.model as L2dmModel;
  const params = model.parameters.map((p) => p.id);
  const hasMouth = params.includes("嘴开") ? "嘴开" : params.includes("ParamMouthOpenY") ? "ParamMouthOpenY" : null;
  return {
    id: IMPORTED_ID,
    label: "导入模型（.l2dm）",
    file: "",
    kind: "semantic",
    desc: `导入的 .l2dm 模型：${model.parts.length} 部件 / ${params.length} 参数${hasMouth ? "；支持说话口型" : ""}。`,
    mouthParam: hasMouth,
    mouthScale: 0.8,
    envOverrides: {},
    motions: {},
    expressions: {},
    presets: [{ label: "⟲ 重置", lines: [] }],
  };
}

importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  const f = importFile.files?.[0];
  if (!f) return;
  importFile.value = "";
  void f.text().then(async (text) => {
    try {
      const char = charFromModelText(text);
      const params = modelParamsOf(text);
      const reax = buildCreatedReactions(params, []);
      stage.registerImported(char, reax, text);
      saveImported({ character: char, reactions: reax, modelText: text });
      stage.status("已导入「" + char.label + "」→ 正在加载…", "ok");
      await stage.boot(IMPORTED_ID);
      stage.status("已导入 .l2dm 角色并加载。", "ok");
    } catch (e) {
      pushSystem("（导入失败：" + (e as Error).message + "）");
      stage.status("导入失败，请选择合法的 .l2dm / .json 模型文件。", "err");
    }
  });
});

function modelParamsOf(text: string): string[] {
  const model = JSON.parse(text) as L2dmModel;
  return model.parameters.map((p) => p.id);
}

// ---------------- 事件 ----------------
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void send(inputEl.value);
});
sendBtnEl.addEventListener("click", () => void send(inputEl.value));

const CHIPS = ["你好呀！", "你好可爱～", "摇摇尾巴", "我好开心呀", "说点什么吧", "再见啦"];
for (const text of CHIPS) {
  const b = document.createElement("button");
  b.textContent = text;
  b.addEventListener("click", () => void send(text));
  chipsEl.appendChild(b);
}

// ---------------- 启动 ----------------
stage.start(); // 加载默认角色（URL ?character= 或真实 Haru）并启动渲染循环

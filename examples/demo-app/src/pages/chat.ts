// pages/chat.ts —— 界面①「聊天助手」浏览器入口
// 舞台（Stage）+ 聊天面板：输入 → 两跳决策 + 台词 + 语音 + 口型 + 动作。
import { Stage } from "../stage.ts";
import { need, needInput, needBtn } from "../dom.ts";
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
});

const logEl = need("log");
const chipsEl = need("chips");
const inputEl = needInput("input");
const sendBtnEl = needBtn("send");

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

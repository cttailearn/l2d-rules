// pages/features.ts —— 界面③「全功能演示」浏览器入口
// 舞台 + 按角色参数面自动生成 JSONL 的功能按钮（drive.ts 纯函数）+ 轻量聊天输入。
import { Stage } from "../stage.ts";
import { driveFeature, FEATURE_LABELS } from "../drive.ts";
import { need, needInput, needBtn } from "../dom.ts";

const stage = new Stage({
  stageWrap: need("stageWrap"),
  bubble: need("bubble"),
  badges: need("badges"),
  charBtns: need("charBtns"),
  metricsEl: need("metrics"),
  bgBtns: need("bgBtns"),
  zoomIn: needBtn("zoomIn"),
  zoomOut: needBtn("zoomOut"),
  companionToggle: need("companionToggle"),
  statusEl: need("stageStatus"),
});

const featBtns = need("featBtns");
const featHintEl = need("featHint");
const chatInput = needInput("featInput");
const chatSend = needBtn("featSend");
const featChatEl = need("featChat");

function appendChat(user: string, reply: string): void {
  const t = document.createElement("div");
  t.className = "feat-chat-line";
  const u = document.createElement("span");
  u.className = "u";
  u.textContent = user;
  const r = document.createElement("span");
  r.className = "r";
  r.textContent = reply;
  t.append(u, " → ", r);
  featChatEl.prepend(t);
  while (featChatEl.children.length > 30) featChatEl.lastChild?.remove();
}

async function sendChat(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text) return;
  chatInput.value = "";
  const o = await stage.reply(text);
  if (o) appendChat(text, o.replyText + (o.usedSound ? " 🔊" : ""));
}

// ---------------- 功能按钮（drive.ts 纯函数） ----------------
for (const b of featBtns.querySelectorAll("button")) {
  b.addEventListener("click", () => {
    const f = (b as HTMLButtonElement).dataset["feat"] ?? "";
    const core = stage.core;
    if (!core) {
      featHintEl.textContent = "角色尚未就绪";
      return;
    }
    const res = driveFeature(core, f);
    if (!res) {
      featHintEl.textContent = `「${FEATURE_LABELS[f] ?? f}」：当前角色缺少对应部件/资产`;
      return;
    }
    if (f === "reset") {
      stage.reset();
      featHintEl.textContent = "参数已复位";
      return;
    }
    const geometryFeat = ["walk", "nod", "shake", "smile", "open", "blink", "surprised"].includes(f);
    const r = stage.feed(res.lines);
    const noWarp = geometryFeat && !stage.hasWarpMotion
      ? "（注意：当前角色为基准姿态烘焙，几何不形变 —— 想看动作请切衣装酱/小骨架/我的创作）"
      : "";
    featHintEl.textContent =
      `[${res.label}] · 生效 ${r.applied} · 隔离 ${r.skipped}` +
      (res.lines.length === 0 ? "（无可用参数）" : "") + " " + noWarp;
  });
}

chatSend.addEventListener("click", () => void sendChat(chatInput.value));
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void sendChat(chatInput.value);
});

// ---------------- 启动 ----------------
stage.start();

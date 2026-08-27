// pages/features.ts —— 界面③「全功能演示」浏览器入口
// 舞台 + 按角色参数面自动生成 JSONL 的按钮：行走 / 换衣 / 头部 / 脸部。
import { Stage } from "../stage.ts";
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
});

const featBtns = need("featBtns");
const featHintEl = need("featHint");

// ---------------- 按角色生成 JSONL ----------------
function featParam(id: string): boolean {
  return stage.core ? id in stage.core.params() : false;
}
function featMotion(name: string): boolean {
  const m = stage.core?.character.motions;
  return m ? name in m : false;
}
function setp(sem: string, v: number, waitMs?: number): string[] {
  return waitMs
    ? [JSON.stringify({ op: "set", sem, value: v }), JSON.stringify({ op: "wait", ms: waitMs }), JSON.stringify({ op: "set", sem, value: 0 })]
    : [JSON.stringify({ op: "set", sem, value: v })];
}
function featJsonl(feat: string): { lines: string[]; label: string } | null {
  if (!stage.core) return null;
  const core = stage.core;
  switch (feat) {
    case "walk":
      if (featMotion("walk")) return { label: "行走（walk 步态循环）", lines: ['{"op":"play","asset":"walk"}'] };
      if (featParam("腿摆")) return { label: "行走（腿摆/身摆 步态）", lines: ['{"op":"play","asset":"walk"}', '{"op":"set","sem":"身摆","value":0.3}'] };
      return { label: "无腿摆/臂摆 → 行走不可用", lines: [] };
    case "outfit1":
      return core.character.costumes ? { label: "换装·组1", lines: core.setOutfit(1) } : null;
    case "outfit2":
      return core.character.costumes ? { label: "换装·组2", lines: core.setOutfit(2) } : null;
    case "nod":
      if (featParam("头点头")) return { label: "头部·点头", lines: setp("头点头", 12, 600) };
      if (featParam("ParamAngleY")) return { label: "头部·点头", lines: setp("ParamAngleY", 12, 600) };
      return null;
    case "shake":
      if (featParam("头转向")) return { label: "头部·摇头", lines: setp("头转向", 16, 300) };
      if (featParam("ParamAngleX")) return { label: "头部·摇头", lines: setp("ParamAngleX", 14, 300) };
      return null;
    case "smile":
      if (core.character.expressions && "开心" in core.character.expressions) return { label: "脸部·微笑（face 开心）", lines: ['{"op":"face","expression":"开心","weight":0.6}'] };
      if (featParam("ParamMouthForm")) return { label: "脸部·微笑", lines: setp("ParamMouthForm", 1) };
      if (featParam("嘴笑")) return { label: "脸部·微笑", lines: setp("嘴笑", 1) };
      return null;
    case "open":
      if (featParam("嘴开")) return { label: "脸部·张嘴", lines: setp("嘴开", 0.8, 500) };
      if (featParam("ParamMouthOpenY")) return { label: "脸部·张嘴", lines: setp("ParamMouthOpenY", 0.8, 500) };
      return null;
    case "blink":
      if (featMotion("blink")) return { label: "脸部·眨眼（blink）", lines: ['{"op":"play","asset":"blink"}'] };
      if (featParam("眼闭左") && featParam("眼闭右")) {
        return { label: "脸部·眨眼", lines: [
          JSON.stringify({ op: "set", sem: "眼闭左", value: 1 }),
          JSON.stringify({ op: "set", sem: "眼闭右", value: 1 }),
          JSON.stringify({ op: "wait", ms: 160 }),
          JSON.stringify({ op: "set", sem: "眼闭左", value: 0 }),
          JSON.stringify({ op: "set", sem: "眼闭右", value: 0 }),
        ] };
      }
      return null;
    case "surprised":
      if (featMotion("surprise")) return { label: "脸部·惊讶（surprise）", lines: ['{"op":"play","asset":"surprise"}'] };
      if (featParam("嘴开") && featParam("眉左升")) {
        return { label: "脸部·惊讶", lines: [
          JSON.stringify({ op: "set", sem: "嘴开", value: 0.8 }),
          JSON.stringify({ op: "set", sem: "眉左升", value: 1 }),
          JSON.stringify({ op: "set", sem: "眉右升", value: 1 }),
        ] };
      }
      return null;
    case "reset":
      return { label: "复位参数", lines: [] };
    default:
      return null;
  }
}

const FEAT_LABELS: Record<string, string> = {
  walk: "🚶 行走", outfit1: "👗 换装·组1", outfit2: "🧥 换装·组2", nod: "🙆 点头", shake: "🙅 摇头",
  smile: "😊 微笑", open: "😮 张嘴", blink: "😉 眨眼", surprised: "😲 惊讶", reset: "⟲ 复位",
};

for (const b of featBtns.querySelectorAll("button")) {
  b.addEventListener("click", () => {
    const f = (b as HTMLButtonElement).dataset["feat"] ?? "";
    const res = featJsonl(f);
    if (!res) {
      featHintEl.textContent = `「${FEAT_LABELS[f] ?? f}」：当前角色缺少对应部件/资产`;
      return;
    }
    if (f === "reset") {
      stage.reset();
      featHintEl.textContent = "参数已复位";
      return;
    }
    const r = stage.feed(res.lines);
    featHintEl.textContent =
      `[${res.label}] · 生效 ${r.applied} · 隔离 ${r.skipped}` +
      (res.lines.length === 0 ? "（无可用参数）" : "");
  });
}

// ---------------- 启动 ----------------
stage.start();

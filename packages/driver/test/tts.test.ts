import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blendVisemes,
  estimateProsody,
  estimateSpeechTimeline,
  phonemeSegmentsToVisemes,
  phonemeToViseme,
} from "../src/index.ts";

// ---------- 音素 → 视素（TTS 升级） ----------

test("P6: phonemeToViseme——元音按口形、辅音中性、静音/未知不报错", () => {
  assert.equal(phonemeToViseme("iy"), "I");
  assert.equal(phonemeToViseme("uw"), "U");
  assert.equal(phonemeToViseme("ao"), "O");
  assert.equal(phonemeToViseme("ae"), "A");
  assert.equal(phonemeToViseme("b"), "A", "辅音→中性 A");
  assert.equal(phonemeToViseme("sil"), "silence");
  assert.equal(phonemeToViseme(""), "silence");
  assert.equal(phonemeToViseme("zzz-unknown"), "A", "未知→A，绝不抛错");
  assert.equal(phonemeToViseme("ang"), "A", "拼音 ang→A");
  assert.equal(phonemeToViseme("ü"), "U");
});

test("P6: phonemeSegmentsToVisemes——字段可配置，时间戳保留", () => {
  const segs = phonemeSegmentsToVisemes([
    { tMs: 0, phoneme: "iy" },
    { tMs: 70, phoneme: "uw" },
  ]);
  assert.deepEqual(segs, [
    { tMs: 0, viseme: "I", weight: 0.9 },
    { tMs: 70, viseme: "U", weight: 0.9 },
  ]);
  const alt = phonemeSegmentsToVisemes([{ tMs: 10, phone: "ao" }], { phonemeField: "phone" });
  assert.equal(alt[0]!.viseme, "O");
});

// ---------- 视素混合 ----------

test("P6: blendVisemes——60–80ms 渐变 + 间隙静音 + 确定性", () => {
  // 两事件相隔 > ramp：中间无活动段 → 静音包裹
  const out = blendVisemes([
    { tMs: 100, viseme: "I", weight: 0.9 },
    { tMs: 500, viseme: "U" },
  ], { rampMs: 80, stepMs: 50 });
  const at = (t: number) => out.find((o) => o.tMs === t)!;
  assert.ok(at(100).visemes.some((v) => v.viseme === "I" && v.weight > 0.8), "渐入峰值");
  assert.ok(at(500).visemes.some((v) => v.viseme === "U" && v.weight > 0.8), "第二峰");
  assert.ok(at(300).visemes.every((v) => v.viseme === "silence"), "事件间隙=静音");
  // 确定性
  assert.deepEqual(out, blendVisemes([{ tMs: 100, viseme: "I", weight: 0.9 }, { tMs: 500, viseme: "U" }], { rampMs: 80, stepMs: 50 }));
});

test("P6: blendVisemes——空输入返回空数组", () => {
  assert.deepEqual(blendVisemes([]), []);
});

// ---------- 韵律 ----------

test("P6: estimateProsody——问句升调、陈述降调、叹词增能、确定性", () => {
  const q = estimateProsody("你确定吗？");
  const s = estimateProsody("好的。");
  const qLast = q[q.length - 2]!;   // 倒数第二 = 末音节（最后为尾部静音点）
  const sLast = s[s.length - 2]!;
  assert.ok(qLast.pitch > sLast.pitch, "问句末音高 > 陈述句末音高");
  assert.ok(sLast.pitch < 0.46, "陈述句末降调");
  const ex = estimateProsody("太好了！");
  const exLast = ex[ex.length - 2]!;
  assert.ok(exLast.energy > 0.5, "叹词增能");
  assert.deepEqual(q, estimateProsody("你确定吗？"), "确定性");
});

// ---------- 降级时间轴（升级后） ----------

test("P6: estimateSpeechTimeline——英文按元音出真实视素（I/E/O），尾部静音，确定性", () => {
  const t = estimateSpeechTimeline("hello world", { lang: "en" });
  assert.ok(t.durationMs > 0);
  const vis = t.visemes!.map((v) => v.viseme);
  assert.ok(vis.includes("E") || vis.includes("O") || vis.includes("I"), "英文含真实元音视素：" + vis.join(","));
  assert.equal(vis[vis.length - 1], "silence");
  assert.ok(t.prosody!.length >= 2);
  assert.ok(t.prosody!.some((p) => p.energy > 0.2), "有非中性能量脊梁");
  assert.deepEqual(t, estimateSpeechTimeline("hello world", { lang: "en" }), "确定性");
});

test("P6: estimateSpeechTimeline——CJK 音节 A 视素 + 叠问句韵律；空文本不崩且无口型", () => {
  const t = estimateSpeechTimeline("你好呀！");
  assert.ok(t.visemes!.length >= 2);
  assert.equal(t.visemes![t.visemes!.length - 1]!.viseme, "silence");
  const blank = estimateSpeechTimeline("   ");
  assert.equal(blank.durationMs, 0);
  assert.equal(blank.visemes!.length, 0);
  assert.ok(blank.prosody!.length >= 1);
});

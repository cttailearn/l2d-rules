// run.mjs —— demo-app 无头运行器（同核）：脚本化对话 → 每帧驱动 → 出帧 + 报告
// 与浏览器（src/pages/*）共用 AppCore：聊天文本 → 两跳决策 + 确定性应答 → JSONL 流式驱动 → 场景渲染。
//
// 用法：
//   npm start              # 默认 Haru 角色，确定性 mock 第二跳（离线可跑）
//   CHAR=demo npm start    # 指定角色（haru / demo / costume / all）
//   CHAR=all npm start     # 三个角色各跑一段脚本化聊天，各出一帧 + 报告
//   FROM_IMAGE=path.png npm start   # 用磁盘上的真实 PNG 跑「上传图像→构建」（缺省用内置示例）
//   LLM_API_KEY=… npm start  # 第二跳走真实 OpenAI 兼容端点（LLM_BASE_URL/LLM_MODEL 可选）
//
// 产物（out/）：{char}-{n}-{msg}.png 帧 + report.txt（合成 sha256、hop、台词、生效统计）。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { loadL2dm, SoftwareRenderer, L2dmPlayer } from "@l2dp/engine";
import { decodePng, encodePng } from "@l2dp/cutout";
import { OpenAIProvider } from "@l2dp/driver";
import { AppCore } from "../src/core.ts";
import { APP_CHARACTERS, CHARACTER_LIST } from "../src/chars.ts";
import { buildFromImage, sampleImage, sampleLabeler } from "../src/creator.ts";
import { decodeModelAtlas } from "../src/texture.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, "..", "public");
const OUT = join(here, "..", "out");
await mkdir(OUT, { recursive: true });

const report = [];
const log = (s) => report.push(String(s));
const STAGE_W = 560;
const STAGE_H = 720;

/** 确定性 mock / 真实 LLM 的第二跳 → 见 core 默认 AppProvider；这里仅当设置了 key 才注入真实 Provider。 */
function buildProvider() {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return undefined;
  log(`[Provider] OpenAIProvider（真实 ${process.env.LLM_MODEL ?? "gpt-4o-mini"}，LLM_BASE_URL=${process.env.LLM_BASE_URL ?? "https://api.openai.com/v1"}）`);
  return new OpenAIProvider({
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
  });
}

async function loadCharacter(charId) {
  const char = APP_CHARACTERS[charId];
  const text = await readFile(join(PUBLIC, char.file), "utf8");
  const loaded = loadL2dm(text);
  if (!loaded.ok || !loaded.model) throw new Error(`${charId} 加载失败: ${loaded.error}`);
  const atlas = decodeModelAtlas(loaded.model.atlas);
  return { char, text, atlas };
}

async function runCharacter(charId, seq) {
  const { char, text, atlas } = await loadCharacter(charId);
  const sink = new SoftwareRenderer({ filter: "linear" });
  // 同伴 = 小骨架（demo 骨架）；demo 角色自己就是骨架，不再给自己套同伴
  const buddy = charId === "demo" ? null : await loadCharacter("demo").catch(() => null);
  const core = new AppCore({
    modelJson: text,
    atlas,
    sink,
    character: char,
    seed: 42,
    stage: { width: STAGE_W, height: STAGE_H },
    background: [14, 20, 46, 255],
    provider: buildProvider(),
    companionModelJson: buddy ? buddy.text : undefined,
    companionAtlas: buddy ? buddy.atlas : undefined,
    onSpeak: (o) => log(`    [说话] ${o.text}（${o.speechMs}ms${o.sound ? " · " + o.sound : ""}）`),
  });

  log(`\n◆ 角色「${char.label}」 参数 ${core.model.parameters.length} · 部件 ${core.model.parts.length} · 同伴 ${core.hasCompanion ? "开" : "关"}`);
  for (let i = 0; i < seq.length; i++) {
    const msg = seq[i];
    const beforeApplied = core.ing.applied;
    const beforeSkipped = core.ing.skipped;
    const r = await core.handleUserText(msg);
    const applied = core.ing.applied - beforeApplied;
    const skipped = core.ing.skipped - beforeSkipped;
    log(`  [消息 ${i + 1}] 「${msg}」 → hop=${r.hop}${r.behaviorId ? " behavior=" + r.behaviorId : ""} 台词=「${r.replyText}」 指令 ${r.lines.length} 行 生效 ${applied} 行 隔离 ${skipped} 行`);

    // 推进到说话中段 + 说话口型张开的帧再各出一帧
    for (let f = 0; f < 60; f++) core.onFrame(16); // ~1s 内推进（播放动作/环境层/说话）
    const px = sink.readPixels();
    const name = `${charId}-${String(i + 1).padStart(2, "0")}-hop${r.hop}.png`;
    await writeFile(join(OUT, name), Buffer.from(encodePng(STAGE_W, STAGE_H, px)));
    const sha = createHash("sha256").update(px).digest("hex").slice(0, 12);
    log(`    帧 out/${name} sha=${sha} 说话中=${core.isSpeaking()} 口型余 ${core.speechRemainMs()}ms`);
  }

  // 换装演示（仅 rig 角色）：outfit op → outfitLines → 逐行生效 → 出帧
  if (core.character.costumes) {
    const l2 = core.setOutfit(2);
    for (let f = 0; f < 12; f++) core.onFrame(16);
    const p2 = core.params();
    const px2 = sink.readPixels();
    await writeFile(join(OUT, `${charId}-outfit-group2.png`), Buffer.from(encodePng(STAGE_W, STAGE_H, px2)));
    log(`  换装 → 服装组2：${l2.length} 行 set（衣装组1=${p2["衣装组1"]} 衣装组2=${p2["衣装组2"]}）→ out/${charId}-outfit-group2.png`);
  }

  return core;
}

// ---------------- 主流程 ----------------
const SCRIPT = ["你好呀！", "你好可爱～", "摇摇尾巴", "我有点害羞", "帮我想个主意", "再见啦"];

log(`demo-app 无头对话（脚本 ${SCRIPT.length} 条 · 二跳=${process.env.LLM_API_KEY ? "真实 LLM" : "确定性 mock(离线)"}）`);

const target = process.env.CHAR ?? "haru";
if (target === "all") {
  for (const c of CHARACTER_LIST) await runCharacter(c.id, SCRIPT.slice(0, 4));
} else {
  if (!APP_CHARACTERS[target]) throw new Error(`未知角色：${target}（可选 haru/demo/costume/all）`);
  await runCharacter(target, SCRIPT);
}

// —— 上传图像 → 构建 Live2D（无头版：FROM_IMAGE 走磁盘真实图，缺省内置示例 → 全链 → 出预览帧）——
{
  let srcImage = sampleImage();
  let srcLabeler = sampleLabeler();
  if (process.env.FROM_IMAGE) {
    log(`\n◆ 使用磁盘真实图 ${process.env.FROM_IMAGE}`);
    const buf = await readFile(process.env.FROM_IMAGE);
    srcImage = decodePng(new Uint8Array(buf));
    srcLabeler = undefined;
  }
  const outcome = await buildFromImage(srcImage, { tol: 6, minArea: 60, character: "headless-created", labeler: srcLabeler });
  log("\n◆ 上传图像 → 构建 Live2D（headless · 纯确定性）");
  log(`  ok=${outcome.ok} · 自修复 ${outcome.rounds}/3 轮 · 切图 ${outcome.cutout.parts.length} 件 · 覆盖率 ${outcome.cutout.coveragePct}%`);
  if (outcome.ok && outcome.result) {
    const { model, motions } = outcome.result;
    const atlas = decodeModelAtlas(model.atlas);
    log(`  → 模型 ${model.parts.length} 部件 / ${model.parameters.length} 参数 · 动作 ${motions.map((m) => m.name).join("/")} · 内嵌纹理 ${Object.keys(model.atlas ?? {}).length} 张`);
    const sw = new SoftwareRenderer();
    const player = new L2dmPlayer(model, atlas);
    const idle = motions.find((m) => m.name === "idle");
    if (idle) player.play(idle.motion);
    for (let f = 0; f < 30; f++) player.tick(16);
    player.render(sw);
    const px = sw.readPixels();
    if (px) {
      await writeFile(join(OUT, "created-preview.png"), Buffer.from(encodePng(model.canvas.width, model.canvas.height, px)));
      log("  → 预览 out/created-preview.png ✅");
    }
  } else {
    log("  " + outcome.log.slice(0, 6).join(" | "));
  }
}

log("\n[demo-app] 无头演示完成 ✅ 产物见 out/");
await writeFile(join(OUT, "report.txt"), report.join("\n") + "\n", "utf8");
console.log(report.join("\n"));

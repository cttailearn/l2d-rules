// app.test.ts —— demo-app 同核无头测试（Node ≥23.6 直跑 TS）
// 浏览器与无头共用 AppCore：本文件只验核心（决策/口型/换装/确定性/场景/上传构建），不依赖 DOM/audio。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { SoftwareRenderer, loadL2dm } from "@l2dp/engine";
import { AppCore, type AppCoreOptions } from "../src/core.ts";
import { APP_CHARACTERS } from "../src/chars.ts";
import { decodeModelAtlas } from "../src/texture.ts";
import { buildFromImage, makeCreatedCharacter, sampleImage, sampleLabeler } from "../src/creator.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, "..", "public");

async function boot(charId: string, opts: Partial<AppCoreOptions> = {}) {
  const char = APP_CHARACTERS[charId];
  const modelJson = await readFile(join(PUBLIC, char.file), "utf8");
  const loaded = loadL2dm(modelJson);
  if (!loaded.ok) throw new Error(`模型加载失败: ${loaded.error}`);
  if (!loaded.model) throw new Error("模型加载失败：模型为空");
  const atlas = decodeModelAtlas(loaded.model.atlas);
  const sink = new SoftwareRenderer({ filter: "linear" });
  const core = new AppCore({
    modelJson,
    atlas,
    sink,
    character: char,
    seed: 42,
    stage: { width: 560, height: 720 },
    background: [14, 20, 46, 255],
    ...opts,
  });
  return { core, sink, char };
}

function frameSha(sink: SoftwareRenderer): string {
  const px = sink.readPixels();
  if (!px) return "";
  return createHash("sha256").update(px).digest("hex").slice(0, 16);
}

test("核心启动 + 问候 + 确定性渲染（Haru）", async () => {
  const { core, sink, char } = await boot("haru");
  assert.equal(char.id, "haru");
  assert.ok(core.model.parameters.length > 0, "有参数面");

  const r = await core.handleUserText("你好呀！");
  assert.equal(r.hop, 1, "问候命中第一跳本地规则");
  assert.equal(r.behaviorId, "greet");
  assert.ok(r.replyText.length > 0, "有台词");
  assert.ok(r.lines.length > 0, "有 JSONL 指令");
  assert.ok(r.usedSound !== undefined, "Haru 有语音，应选中一个");

  for (let f = 0; f < 60; f++) core.onFrame(16); // ~1s
  const px = sink.readPixels();
  assert.ok(px && px.length === 560 * 720 * 4, "软件渲染产出像素");
  assert.ok(sink.countNonTransparent() > 100, "背景 + 角色非透明内容");

  // 确定性：同 seed 同输入 → 同帧哈希
  const sha1 = frameSha(sink);
  const modelJson = await readFile(join(PUBLIC, "haru-full.l2dm"), "utf8");
  const loaded = loadL2dm(modelJson);
  if (!loaded.ok || !loaded.model) throw new Error("加载失败");
  const atlas2 = decodeModelAtlas(loaded.model.atlas);
  const sink2 = new SoftwareRenderer({ filter: "linear" });
  const core2 = new AppCore({
    modelJson,
    atlas: atlas2,
    sink: sink2,
    character: char,
    seed: 42,
    stage: { width: 560, height: 720 },
    background: [14, 20, 46, 255],
  });
  await core2.handleUserText("你好呀！");
  for (let f = 0; f < 60; f++) core2.onFrame(16);
  assert.equal(frameSha(sink2), sha1, "同输入同输出（种子化确定性）");
});

test("两跳决策：未命中第一跳 → 第二跳 Provider（确定性 mock）", async () => {
  const { core } = await boot("demo");
  const before = (core.provider as unknown as { calls?: number }).calls ?? 0;
  const r1 = await core.handleUserText("今天天气不错呀");
  assert.equal(r1.hop, 2, "无关键词 → 走第二跳");
  const after = (core.provider as unknown as { calls?: number }).calls ?? 0;
  assert.equal(after, before + 1, "第二跳计入 Provider 调用");
  const r2 = await core.handleUserText("今天天气不错呀");
  assert.equal(r2.replyText, r1.replyText, "同输入同台词（确定性）");
});

test("语义角色：play/face 动作真实驱动骨骼（帧像素变化）", async () => {
  const { core, sink } = await boot("demo");
  assert.ok(core.character.motions && core.character.motions["微笑点头"], "有语义动作资产");

  const rest = frameSha(sink);
  const r = await core.handleUserText("摇摇尾巴");
  assert.ok(r.lines.some((l) => l.includes("尾巴摇")), "尾巴摇 play 指令");
  for (let f = 0; f < 40; f++) core.onFrame(16);
  const moved = frameSha(sink);
  assert.notEqual(rest, moved, "动作驱动后像素变化");

  const beforeFace = frameSha(sink);
  core.feedLines(['{"op":"face","expression":"开心","weight":0.6}']);
  for (let f = 0; f < 30; f++) core.onFrame(16);
  assert.notEqual(frameSha(sink), beforeFace, "表情叠加改变渲染");
});

test("rig 角色：outfit 换装 → 服装组参数 + 像素变化（outfitLines 契约）", async () => {
  const { core, sink } = await boot("costume");
  for (let f = 0; f < 12; f++) core.onFrame(16);
  const g1 = frameSha(sink);
  const lines2 = core.setOutfit(2);
  assert.ok(lines2.length > 0, "outfitLines 生成 set 行");
  for (let f = 0; f < 12; f++) core.onFrame(16); // 求值帧把 override 写回参数面
  const p2 = core.params();
  assert.equal(p2["衣装组1"], 0, "组1 关闭");
  assert.equal(p2["衣装组2"], 1, "组2 打开");
  const g2 = frameSha(sink);
  assert.notEqual(g1, g2, "换装后像素变化");
});

test("说话口型：台词驱动 ParamMouthOpenY，说完自动闭合", async () => {
  const { core } = await boot("haru");
  await core.handleUserText("你好呀！");
  assert.ok(core.isSpeaking(), "开始说话");
  let sawOpen = false;
  for (let f = 0; f < 200; f++) {
    core.onFrame(16);
    const v = core.params()["ParamMouthOpenY"] ?? 0;
    if (v > 0.05) sawOpen = true;
  }
  assert.ok(sawOpen, "说话期间口型张开（视素驱动）");
  assert.ok(core.speechRemainMs() <= 0 || !core.isSpeaking(), "说完口型闭合");
});

test("场景舞台：多角色（同伴）+ 背景 + 相机", async () => {
  const demoText = await readFile(join(PUBLIC, "demo.l2dm"), "utf8");
  const { core } = await boot("haru", {
    companionModelJson: demoText,
    companionAtlas: new Map(),
  });
  assert.ok(core.hasCompanion, "同伴在场");
  assert.deepEqual([...core.stage.childIds()].sort(), ["companion", "hero"]);
  core.setBackground([10, 10, 30, 255]);
  assert.deepEqual(core.stage.background, [10, 10, 30, 255]);
  core.zoomTo(1.25, 0);
  assert.equal(core.stage.currentCamera().zoom, 1.25, "相机缩放立即落位");
});

test("上传图像 → 构建 Live2D：切图→绑定→内嵌纹理→可驱动（确定性全链）", async () => {
  // 1) 构建：内置示例（色板标注）→ ColorKey 切图 → 语义标注 → 校验/自修复 → rig 绑定 + 动作生成
  const outcome = await buildFromImage(sampleImage(), { tol: 6, minArea: 60, character: "test-chan", maxRounds: 3, labeler: sampleLabeler() });
  assert.ok(outcome.ok, "构建通过：" + outcome.log.slice(0, 4).join(" | "));
  assert.ok(outcome.result, "有创作结果");
  const { model, motions, rig } = outcome.result;
  assert.ok(model.parts.length >= 10, "绑出多部件（实际 " + model.parts.length + "）；色板标注应含发/脸/五官/躯干");
  assert.ok(model.parameters.length > 0, "有参数面");
  assert.ok(rig.report.ok, "rig 校验通过");
  const partSems = outcome.cutout.parts.map((p) => p.semantic);
  for (const s of ["face", "mouth", "eye", "brow"]) assert.ok(partSems.includes(s), "标注含语义 " + s);

  // 2) 动作资产：idle/blink/talk 等基础动作
  const names = motions.map((m) => m.name);
  for (const n of ["idle", "blink", "talk"]) assert.ok(names.includes(n), "基础动作含 " + n);

  // 3) 创作模型自包含：部件纹理内嵌 atlas
  const atlas = decodeModelAtlas(model.atlas);
  assert.ok(atlas.size > 0, "创作模型内嵌部件纹理（" + atlas.size + " 张）");

  // 4) 装配成 demo-app 角色并驱动（两跳 + 渲染）
  const made = makeCreatedCharacter("created-test", outcome);
  assert.ok(made, "可装配为角色");
  const sink = new SoftwareRenderer();
  const core = new AppCore({
    modelJson: JSON.stringify(model),
    atlas,
    sink,
    character: made.char,
    seed: 42,
    stage: { width: 400, height: 520 },
    reactionLines: made.reactionLines,
  });
  const r = await core.handleUserText("你好呀！");
  assert.equal(r.hop, 1, "问候命中第一跳");
  assert.ok(r.replyText.length > 0);
  for (let f = 0; f < 40; f++) core.onFrame(16);
  const px = sink.readPixels();
  assert.ok(px && px.length === 400 * 520 * 4, "创作角色渲染出像素");
  assert.ok(core.character.mouthParam === "嘴开" || core.character.mouthParam === null, "口型参数按模型装配");

  // 5) 确定性：重复构建同输入 → 同模型（部件数一致）
  const again = await buildFromImage(sampleImage(), { tol: 6, minArea: 60, character: "test-chan", maxRounds: 3, labeler: sampleLabeler() });
  assert.ok(again.result, "再次构建通过");
  assert.equal(again.result!.model.parts.length, model.parts.length, "同输入同构建结果（确定性）");
});

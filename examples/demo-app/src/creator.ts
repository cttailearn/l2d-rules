// creator.ts —— 「上传图像 → 构建 Live2D」纯函数面（浏览器 / 无头 / 测试共用，无 DOM）
// 链路：RgbaImage → @l2dp/cutout（ColorKeySegmenter 候选选区 + PositionLabeler 模板槽标注）
//      → @l2dp/create（createWithSelfRepair：校验/自修复 → @l2dp/rig 半自动绑定 + 基础动作生成）
//      → 自包含可驱动 .l2dm（部件纹理已内嵌 atlas）+ 动作资产。
// 说明：内置 ColorKeySegmenter 面向「平坦色画风」立绘（Live2D 常见源图）；任意照片/复杂图可注入
// 真实 Segmenter/Labeler（@l2dp/host：HttpSegmenter/ComfyUI、LlmLabeler/Designer）——接口即注入点。
import {
  ColorKeySegmenter,
  ColorMapLabeler,
  type Labeler,
  type RgbaImage,
} from "@l2dp/cutout";
import {
  createWithSelfRepair,
  RuleReviewer,
  type CreateOutcome,
} from "@l2dp/create";
import type { MotionLike } from "@l2dp/driver";
import type { AppCharacter, Emotion } from "./chars.ts";

/** 内置示例立绘（半身、透明底、平坦色 —— 模拟已抠图上传的扁平画风 PNG，演示确定性全链）。 */
export function sampleImage(): RgbaImage {
  const W = 480;
  const H = 640;
  const data = new Uint8Array(W * H * 4);
  const SHAPES: [string, "left" | "right", number, number, number, number, [number, number, number]][] = [
    ["hair_back", "left", 120, 60, 240, 320, [70, 60, 105]],
    ["neck", "left", 220, 320, 40, 52, [245, 205, 180]],
    ["body_upper", "left", 170, 360, 148, 184, [120, 150, 205]],
    ["hair_side", "left", 136, 140, 44, 180, [110, 95, 150]],
    ["hair_side", "right", 300, 140, 44, 180, [150, 125, 185]],
    ["face", "left", 184, 150, 112, 168, [250, 215, 190]],
    ["nose", "left", 236, 232, 10, 14, [235, 195, 170]],
    ["mouth", "left", 222, 252, 38, 22, [200, 70, 80]],
    ["eyeball", "left", 210, 198, 22, 18, [255, 255, 255]],
    ["eyeball", "right", 248, 198, 22, 18, [230, 230, 255]],
    ["eye", "left", 204, 194, 34, 22, [246, 206, 186]],
    ["eye", "right", 244, 194, 34, 22, [236, 196, 206]],
    ["brow", "left", 204, 180, 36, 10, [85, 75, 110]],
    ["brow", "right", 244, 180, 36, 10, [105, 90, 130]],
    ["hair_front", "left", 184, 120, 112, 46, [120, 105, 165]],
  ];
  for (const [, , x, y, w, h, c] of SHAPES) {
    for (let yy = y; yy < Math.min(y + h, H); yy++) {
      for (let xx = x; xx < Math.min(x + w, W); xx++) {
        const o = (yy * W + xx) * 4;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    }
  }
  return { width: W, height: H, data };
}

export interface BuildOptions {
  tol?: number;
  minArea?: number;
  maxRounds?: number;
  character?: string;
  /** 标注器：内置示例用 ColorMapLabeler(SAMPLE_MAPPING)（色板已知 → 语义精确）；
   *  任意上传缺省 → create 内置 PositionLabeler(defaultSlots)（位置槽，粗略但可运行）。 */
  labeler?: Labeler;
}

/** 上传图 → 构建可驱动模型（确定性全链）。 */
export async function buildFromImage(image: RgbaImage, opts: BuildOptions = {}): Promise<CreateOutcome> {
  return createWithSelfRepair({
    character: opts.character ?? "created-app",
    image,
    canvas: { width: image.width, height: image.height },
    segmenter: new ColorKeySegmenter({ tol: opts.tol ?? 12, minArea: opts.minArea ?? 60 }),
    labeler: opts.labeler,
    reviewer: new RuleReviewer(),
    maxRounds: opts.maxRounds ?? 3,
  });
}

/** 内置示例立绘的色板 → 语义映射（与 sampleImage() 的 SHAPES 一一对应；demo-p4b 同法）。 */
export const SAMPLE_MAPPING: { color: [number, number, number]; semantic: string; side?: "left" | "right" }[] = [
  { color: [70, 60, 105], semantic: "hair_back" },
  { color: [245, 205, 180], semantic: "neck" },
  { color: [120, 150, 205], semantic: "body_upper" },
  { color: [110, 95, 150], semantic: "hair_side", side: "left" },
  { color: [150, 125, 185], semantic: "hair_side", side: "right" },
  { color: [250, 215, 190], semantic: "face" },
  { color: [235, 195, 170], semantic: "nose" },
  { color: [200, 70, 80], semantic: "mouth" },
  { color: [255, 255, 255], semantic: "eyeball", side: "left" },
  { color: [230, 230, 255], semantic: "eyeball", side: "right" },
  { color: [246, 206, 186], semantic: "eye", side: "left" },
  { color: [236, 196, 206], semantic: "eye", side: "right" },
  { color: [85, 75, 110], semantic: "brow", side: "left" },
  { color: [105, 90, 130], semantic: "brow", side: "right" },
  { color: [120, 105, 165], semantic: "hair_front" },
];

/** 内置示例的色板标注器实例（可直接复用）。 */
export function sampleLabeler(): Labeler {
  return new ColorMapLabeler(SAMPLE_MAPPING);
}

/** 依据「参数面 + 生成的动作」为创作角色生成每种情绪的动作行（只引用存在的资产）。 */
export function buildCreatedReactions(
  params: readonly string[],
  motionNames: readonly string[],
): Record<Emotion, string[]> {
  const p = (id: string): boolean => params.includes(id);
  const m = (name: string): boolean => motionNames.includes(name);
  const play = (name: string): string => JSON.stringify({ op: "play", asset: name });
  const setp = (sem: string, value: number): string => JSON.stringify({ op: "set", sem, value });
  const fallback = (): string[] => (m("talk") ? [play("talk")] : m("idle") ? [play("idle")] : []);
  return {
    greet: m("idle") ? [play("idle")] : p("头转向") ? [setp("头转向", 6)] : fallback(),
    happy: m("surprise") ? [play("surprise")] : m("talk") ? [play("talk")] : fallback(),
    wag: p("身摆") ? [setp("身摆", 0.6)] : m("talk") ? [play("talk")] : fallback(),
    shy: p("头转向") ? [setp("头转向", -8), setp("头点头", -8)] : fallback(),
    think: p("头转向") ? [setp("头转向", 10)] : fallback(),
    goodbye: p("头转向") ? [setp("头转向", -10)] : fallback(),
    curious: p("头点头") ? [setp("头点头", 12)] : fallback(),
    neutral: fallback(),
  };
}

/**
 * 创作结果 → 可在 demo-app 中使用的角色（动态注册 / 直接驱动）。
 * @param id      角色 id（如 "created"）
 * @param outcome  buildFromImage 的产出
 */
export function makeCreatedCharacter(
  id: string,
  outcome: CreateOutcome,
): { char: AppCharacter; reactionLines: Record<Emotion, string[]> } | null {
  if (!outcome.ok || !outcome.result) return null;
  const { model, motions } = outcome.result;
  const motionNames = motions.map((x) => x.name);
  const params = model.parameters.map((x) => x.id);
  const motionAssets: Record<string, MotionLike> = {};
  for (const x of motions) {
    motionAssets[x.name] = {
      durationMs: x.motion.durationMs,
      loop: x.motion.loop,
      curves: x.motion.curves.map((c) => ({ id: c.id, segments: [...c.segments] })),
    };
  }
  const presets: { label: string; lines: string[] }[] = [];
  for (const name of ["idle", "blink", "talk", "surprise"]) {
    if (motionNames.includes(name)) {
      presets.push({ label: `▶ ${name}`, lines: [JSON.stringify({ op: "play", asset: name })] });
    }
  }
  presets.push({ label: "⟲ 重置", lines: [] });

  const char: AppCharacter = {
    id,
    label: "我的创作（上传构建）",
    file: "",
    kind: "semantic",
    desc:
      `浏览器内从上传图像构建的角色：切图 ${outcome.cutout.parts.length} 件 → 绑定 ${model.parts.length} 部件 / ${params.length} 参数，` +
      `自修复 ${outcome.rounds} 轮；动作 ${motionNames.join("/")}。`,
    mouthParam: params.includes("嘴开") ? "嘴开" : null,
    mouthScale: 0.9,
    envOverrides: {},
    motions: motionAssets,
    expressions: {},
    presets,
  };
  return { char, reactionLines: buildCreatedReactions(params, motionNames) };
}

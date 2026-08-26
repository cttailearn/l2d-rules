// chars.ts —— 角色规格：模型文件、驱动形态、环境层映射、反应动作、应答文本
// 演示核心理念「模型无关」：同一套聊天规则 + 两跳决策，驱动三种形态各异的模型——
//   official：官方 Haru 真实模型（Param* 官方参数 + 真实纹理 + 声音）
//   semantic：语义骨架（play/face 语义动作 + warp 形变）
//   rig：     半自动绑定角色（自定义参数 + 服装组换装）
import type { ChatRequest, ChatResult, MotionLike, RuntimeProvider } from "@l2dp/driver";

export type CharKind = "official" | "semantic" | "rig";

/** 角色情绪（第一跳规则命中结果；neutral = 第二跳/兜底） */
export type Emotion =
  | "greet"
  | "happy"
  | "wag"
  | "shy"
  | "think"
  | "goodbye"
  | "curious"
  | "neutral";

export interface AppCharacter {
  id: string;
  label: string;
  file: string;
  kind: CharKind;
  desc: string;
  /** 说话时驱动的口型参数；null = 无口型（用点头抖动代替） */
  mouthParam: string | null;
  /** 说话时口型幅度上限（0..1） */
  mouthScale?: number;
  /** 环境层组覆盖：paramId → group（把官方参数映射到呼吸/眨眼/视线/重心） */
  envOverrides?: Record<string, string>;
  /** 可播放声音（public/sounds 下文件名） */
  sounds?: string[];
  /** 语义动作资产（play 用；official/rig 走 set 脚本，无此表） */
  motions?: Record<string, MotionLike>;
  /** 语义表情资产（face 用） */
  expressions?: Record<string, { parameters: { id: string; value: number; blend: "Add" | "Multiply" | "Overwrite" }[] }>;
  /** 服装组（outfit 换装用，仅 rig 有） */
  costumes?: { group: number; param: string; partIds: string[] }[];
  /** 控制条动作预置 */
  presets: { label: string; lines: string[] }[];
}

// ---------------------------------------------------------------- 反应动作
// 每一种情绪在三种形态下各自翻译成 JSONL 指令行（第一跳输出 / 第二跳兜底）。
// official/rig 无内置动作资产 → 用 set+wait 小脚本（表意动作）；
// semantic 有 play/face 语义动作资产 → 直接 play/face。
export const REACTION_LINES: Record<CharKind, Record<Emotion, string[]>> = {
  official: {
    greet: [
      '{"op":"set","sem":"ParamAngleX","value":8}',
      '{"op":"wait","ms":650}',
      '{"op":"set","sem":"ParamAngleX","value":0}',
    ],
    happy: [
      '{"op":"set","sem":"ParamMouthForm","value":1}',
      '{"op":"set","sem":"ParamEyeLSmile","value":1}',
      '{"op":"set","sem":"ParamEyeRSmile","value":1}',
    ],
    wag: [
      '{"op":"set","sem":"ParamBodyAngleX","value":6}',
      '{"op":"wait","ms":700}',
      '{"op":"set","sem":"ParamBodyAngleX","value":0}',
    ],
    shy: [
      '{"op":"set","sem":"ParamBrowLForm","value":1}',
      '{"op":"set","sem":"ParamBrowRForm","value":1}',
      '{"op":"set","sem":"ParamAngleX","value":-5}',
    ],
    think: [
      '{"op":"set","sem":"ParamAngleY","value":-8}',
      '{"op":"wait","ms":800}',
      '{"op":"set","sem":"ParamAngleY","value":0}',
    ],
    goodbye: [
      '{"op":"set","sem":"ParamAngleX","value":-10}',
      '{"op":"set","sem":"ParamMouthForm","value":1}',
      '{"op":"wait","ms":700}',
      '{"op":"set","sem":"ParamAngleX","value":0}',
    ],
    curious: ['{"op":"set","sem":"ParamAngleX","value":10}'],
    neutral: [
      '{"op":"set","sem":"ParamAngleY","value":-4}',
      '{"op":"wait","ms":450}',
      '{"op":"set","sem":"ParamAngleY","value":0}',
    ],
  },
  semantic: {
    greet: ['{"op":"play","asset":"微笑点头"}'],
    happy: ['{"op":"face","expression":"开心","weight":0.6}'],
    wag: ['{"op":"play","asset":"尾巴摇"}'],
    shy: ['{"op":"play","asset":"害羞低头"}'],
    think: ['{"op":"play","asset":"害羞低头"}'],
    goodbye: [
      '{"op":"play","asset":"微笑点头"}',
      '{"op":"wait","ms":900}',
      '{"op":"set","sem":"头转向","value":-14}',
    ],
    curious: ['{"op":"set","sem":"头转向","value":12}'],
    neutral: ['{"op":"play","asset":"微笑点头"}', '{"op":"play","asset":"尾巴摇"}'],
  },
  rig: {
    greet: ['{"op":"set","sem":"头点头","value":12}', '{"op":"wait","ms":600}', '{"op":"set","sem":"头点头","value":0}'],
    happy: ['{"op":"set","sem":"头点头","value":16}', '{"op":"wait","ms":700}', '{"op":"set","sem":"头点头","value":0}'],
    wag: ['{"op":"set","sem":"身摆","value":0.6}', '{"op":"wait","ms":600}', '{"op":"set","sem":"身摆","value":0}'],
    shy: ['{"op":"set","sem":"头转向","value":-14}', '{"op":"wait","ms":800}', '{"op":"set","sem":"头转向","value":0}'],
    think: ['{"op":"set","sem":"头转向","value":12}'],
    goodbye: ['{"op":"set","sem":"头转向","value":-16}', '{"op":"wait","ms":700}', '{"op":"set","sem":"头转向","value":0}'],
    curious: ['{"op":"set","sem":"身转","value":6}'],
    neutral: ['{"op":"set","sem":"身转","value":4}', '{"op":"wait","ms":500}', '{"op":"set","sem":"身转","value":0}'],
  },
};

// ---------------------------------------------------------------- 应答文本
// 角色的「台词」由确定性应答器产出（离线可用、可复现）；行为（动作指令）由两跳决策产出。
const RESPONSES: Record<Exclude<Emotion, "neutral">, string[]> = {
  greet: ["你好呀～很高兴见到你！", "嗨，今天也元气满满哦！", "哈喽！我一直在等你呢。"],
  happy: ["哈哈，我也超开心的！", "能让你开心，我也好高兴～", "太棒啦！我们一起庆祝吧！"],
  wag: ["好呀，摇尾巴给你看～", "摇～摇～尾巴很有精神吧？"],
  shy: ["诶…被你发现了（脸红）", "别、别一直盯着我看啦…"],
  think: ["嗯…让我好好想一想。", "这个问题有点意思，我琢磨一下。", "唔…大概是这样吧？"],
  goodbye: ["拜拜，下次再来玩！", "别走嘛…好啦，等你回来～"],
  curious: ["哦？快让我看看！", "好奇好奇，说说看嘛～"],
};

const NEUTRAL_RESPONSES = [
  "嗯，我在认真听你说哦。",
  "然后呢？继续讲讲～",
  "这个嘛…我觉得挺不错的！",
  "你说得对，我也这么觉得。",
];

/** 确定性散列（同文本 → 同候选），用于选台词/声音。 */
export function hashOf(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 按文本确定性选一条台词。 */
export function pickResponse(text: string, emotion: Emotion): string {
  const pool = emotion === "neutral" ? NEUTRAL_RESPONSES : RESPONSES[emotion];
  return pool[hashOf(text) % pool.length]!;
}

/** 按文本确定性选一个声音文件。 */
export function pickSound(text: string, sounds: string[]): string {
  return sounds[hashOf(text) % sounds.length]!;
}

// ---------------------------------------------------------------- 第一跳匹配
// 依次判定一个最具体情绪（多关键词命中时取先命中者，保证单一行为）。
export function matchEmotion(text: string): Emotion | null {
  const t = text.trim().toLowerCase();
  if (/再见|拜拜|走了|晚安|下班|goodbye|see you/.test(t)) return "goodbye";
  if (/尾巴|摇一摇|摇摇|摇一下/.test(t)) return "wag";
  if (/害羞|脸红|不好意思|被发现了/.test(t)) return "shy";
  if (/哈哈|开心|好棒|喜欢|厉害|真棒|可爱|wow|super/.test(t)) return "happy";
  if (/你好|您好|嗨|哈喽|hello|^hi|在吗|早上好|晚上好|很高兴/.test(t)) return "greet";
  if (/想想|思考|怎么|为什么|好奇|看看|\?$|？$|吗$|吗？$/.test(t)) return "think";
  if (/嗯|哦|好$|当然|对呀/.test(t)) return "curious";
  return null;
}

// ---------------------------------------------------------------- 确定性 Provider（第二跳兜底）
// 未命中第一跳规则 → 走 Provider（模拟 LLM 决策）。offline 用确定性实现：返回对应 neutral 动作。
// 构造入参：动作行表（创作角色用自身动作）或 CharKind（内置角色用 REACTION_LINES[kind].neutral）。
export class AppProvider implements RuntimeProvider {
  calls = 0;
  private readonly lines: string[];
  constructor(linesOrKind: string[] | CharKind) {
    this.lines = Array.isArray(linesOrKind) ? linesOrKind : REACTION_LINES[linesOrKind].neutral;
  }
  capabilities(): { structured: "text" } {
    return { structured: "text" };
  }
  async createCompletion(_req: ChatRequest): Promise<ChatResult> {
    this.calls += 1;
    return { text: this.lines.join("\n"), finishReason: "stop" };
  }
}

// ---------------------------------------------------------------- 角色定义
export const APP_CHARACTERS: Record<string, AppCharacter> = {
  haru: {
    id: "haru",
    label: "Haru（官方真实模型）",
    file: "haru-full.l2dm",
    kind: "official",
    desc: "官方 Haru：.moc3 真实几何 + 内嵌纹理 + 4 句语音。说话驱动 ParamMouthOpenY，环境层映射到呼吸/眨眼/视线。注意：当前 .l2dm 为官方基准姿态烘焙（warp 形变管线下一个里程碑），参数只记录不作几何形变；要看「动作会动」请切小骨架/衣装酱。",
    mouthParam: "ParamMouthOpenY",
    mouthScale: 0.85,
    envOverrides: {
      ParamBreath: "Ambient",
      ParamEyeLOpen: "EyeBlink",
      ParamEyeROpen: "EyeBlink",
      ParamAngleX: "Head",
      ParamAngleY: "Head",
      ParamBodyAngleX: "Body",
      ParamBodyAngleY: "Body",
      ParamBodyAngleZ: "Body",
    },
    sounds: ["haru_Info_04.wav", "haru_Info_14.wav", "haru_normal_6.wav", "haru_talk_13.wav"],
    presets: [
      { label: "😊 微笑嘴", lines: ['{"op":"set","sem":"ParamMouthForm","value":1}'] },
      { label: "😮 张嘴", lines: ['{"op":"set","sem":"ParamMouthOpenY","value":1}'] },
      { label: "👁 闭眼", lines: ['{"op":"set","sem":"ParamEyeLOpen","value":0.2}', '{"op":"set","sem":"ParamEyeROpen","value":0.2}'] },
      { label: "👀 睁眼", lines: ['{"op":"set","sem":"ParamEyeLOpen","value":1.6}', '{"op":"set","sem":"ParamEyeROpen","value":1.6}'] },
      { label: "↔ 转头", lines: ['{"op":"set","sem":"ParamAngleX","value":16}'] },
      { label: "↕ 点头", lines: ['{"op":"set","sem":"ParamAngleY","value":12}'] },
      { label: "⟲ 重置", lines: [] },
    ],
  },
  demo: {
    id: "demo",
    label: "小骨架（语义 + warp）",
    file: "demo.l2dm",
    kind: "semantic",
    desc: "自研引擎语义骨架：play 微笑点头/尾巴摇/害羞低头 + face 开心表情 —— warp 网格真实形变。",
    mouthParam: "微笑",
    mouthScale: 0.5,
    envOverrides: { 头转向: "Head" },
    motions: {
      微笑点头: {
        durationMs: 1000,
        loop: true,
        curves: [{ id: "微笑", segments: [0, 0, 0, 0.5, 1, 0, 1, 0] }],
      },
      尾巴摇: {
        durationMs: 1000,
        loop: true,
        curves: [{ id: "尾巴摆", segments: [0, 0, 0, 0.5, 1, 0, 1, 0] }],
      },
      害羞低头: {
        durationMs: 800,
        loop: false,
        curves: [{ id: "头转向", segments: [0, 0, 0, 1, -20] }],
      },
    },
    expressions: {
      开心: { parameters: [{ id: "微笑", value: 0.3, blend: "Add" }] },
    },
    presets: [
      { label: "😊 微笑点头", lines: ['{"op":"play","asset":"微笑点头"}'] },
      { label: "🦊 尾巴摇", lines: ['{"op":"play","asset":"尾巴摇"}'] },
      { label: "🙈 害羞低头", lines: ['{"op":"play","asset":"害羞低头"}'] },
      { label: "😀 开心", lines: ['{"op":"face","expression":"开心","weight":0.5}'] },
      { label: "⟲ 重置", lines: [] },
    ],
  },
  costume: {
    id: "costume",
    label: "衣装酱（rig 换装）",
    file: "costume.l2dm",
    kind: "rig",
    desc: "半自动绑定角色（10 部件 / 8 参数）：说话点头抖动 + 环境层呼吸/重心，支持两种服装组即时换装。",
    mouthParam: "头点头",
    mouthScale: 0.5,
    envOverrides: {},
    costumes: [
      { group: 1, param: "衣装组1", partIds: ["dress-1", "shoes-1"] },
      { group: 2, param: "衣装组2", partIds: ["top-2", "bottom-2", "shoes-2", "hat-2"] },
    ],
    presets: [
      { label: "🙆 点头", lines: ['{"op":"set","sem":"头点头","value":14}', '{"op":"wait","ms":500}', '{"op":"set","sem":"头点头","value":0}'] },
      { label: "🤭 害羞", lines: ['{"op":"set","sem":"头转向","value":-14}', '{"op":"wait","ms":700}', '{"op":"set","sem":"头转向","value":0}'] },
      { label: "💃 摇身", lines: ['{"op":"set","sem":"身摆","value":0.5}', '{"op":"wait","ms":600}', '{"op":"set","sem":"身摆","value":0}'] },
      { label: "⟲ 重置", lines: [] },
    ],
  },
};

export const CHARACTER_LIST = Object.values(APP_CHARACTERS);

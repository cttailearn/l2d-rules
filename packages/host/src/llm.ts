// llm.ts —— LLM 桥的提示词与响应 Schema（P4 few-shot + 自修复 + 多模态回看）

export function labelResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["assignments"],
    properties: {
      assignments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["candidateId", "semantic"],
          properties: {
            candidateId: { type: "string" },
            semantic: { type: "string", description: "部件命名单一来源中的语义名" },
            side: { enum: ["left", "right"] },
            confidence: { type: "number" },
          },
        },
      },
    },
  };
}

/** 候选区 → LLM 提示词（含 few-shot 示例与词表；可附整图 data URI 供多模态模型）。 */
export function buildLabelPrompt(
  candidates: readonly { id?: string; bbox: { x: number; y: number; width: number; height: number }; color?: [number, number, number]; pixels?: number }[],
  opts: { imageDataUri?: string; vocabHint?: string[] } = {},
): string {
  const vocab = opts.vocabHint && opts.vocabHint.length > 0
    ? opts.vocabHint.join(",")
    : "hair_back,hair_side,hair_front,face,eye,eyeball,brow,mouth,nose,neck,body_upper";
  const lines = [
    "你是 Live2D 部件标注器。下面每个候选区（bbox/主色/像素数）代表角色立绘的一个部件。",
    "请把每个候选区归入一个语义部件名，词表: " + vocab + "。",
    "左右对称部件（眼/眉）用 side=left|right 区分。规则：位置靠上+宽=前发/发丝，中上部=脸/眼，中下部=口/鼻。",
    "输出 JSON {assignments:[{candidateId,semantic,side?,confidence}]}。示例：",
    '{ "assignments": [ { "candidateId": "r1", "semantic": "face" }, { "candidateId": "r2", "semantic": "eye", "side": "left" } ] }',
    "候选区：",
  ];
  for (const c of candidates) {
    const id = c.id ?? "?";
    const col = c.color ? " " + c.color.join(",") : "";
    const px = c.pixels !== undefined ? " px=" + c.pixels : "";
    lines.push("[" + id + "] bbox=" + JSON.stringify(c.bbox) + col + px);
  }
  if (opts.imageDataUri) lines.push("原始立绘(data URI, 若你的端点支持多模态请直接看图): " + opts.imageDataUri.slice(0, 120) + "...");
  return lines.join("\n");
}

export function reviewResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ok", "confidence"],
    properties: {
      ok: { type: "boolean" },
      confidence: { type: "number" },
      issues: { type: "array", items: { type: "string" } },
      suggestions: { type: "array", items: { type: "string" } },
    },
  };
}

/** 渲染帧（data URI 列表）→ 多模态审核提示词。 */
export function buildReviewPrompt(frameUris: string[], characterId: string): string {
  const head = frameUris.length > 0
    ? "下面是" + characterId + "的渲染帧（data URI）。请用视觉判断 rig 质量：部件是否错位/破面/重叠异常。"
    : "下面是" + characterId + "的渲染描述（无帧）。请基于给出信息判断 rig 质量。";
  return head + "\n输出 JSON {ok,confidence,issues[],suggestions[]}。可接受范围：部件可辨、无大面积撕裂。\n" + frameUris.map((u, i) => "[frame" + i + "] " + u.slice(0, 120) + "...").join("\n");
}

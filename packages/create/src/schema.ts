// schema.ts —— 创作 IR 同源 JSON Schema（LLM function-calling / MCP 结构化输出；与 validate 规则同源精神）
export function creationDirectiveSchema(): Record<string, unknown> {
  const partSchema = {
    type: "object",
    required: ["id", "semantic", "bbox"],
    properties: {
      id: { type: "string", minLength: 1 },
      semantic: { type: "string", description: "specs/parts-naming 语义部件名（hair_front/eye/brow/mouth/face/...）" },
      side: { enum: ["left", "right"] },
      color: { type: "array", prefixItems: [{ type: "number" }, { type: "number" }, { type: "number" }, { type: "number" }], maxItems: 4 },
      bbox: {
        type: "object",
        required: ["x", "y", "width", "height"],
        properties: {
          x: { type: "number" }, y: { type: "number" },
          width: { type: "number", exclusiveMinimum: 0 },
          height: { type: "number", exclusiveMinimum: 0 },
        },
      },
      image: { type: "object", properties: { dataUri: { type: "string" } } },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["v", "character", "parts"],
    properties: {
      v: { const: 1 },
      character: { type: "string", minLength: 1 },
      canvas: {
        type: "object",
        required: ["width", "height"],
        properties: { width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 } },
      },
      parts: { type: "array", minItems: 1, items: partSchema },
      hinge: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
      physics: { type: "boolean" },
      breathing: { type: "boolean" },
      motions: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "kind", "durationMs", "curves"],
          properties: {
            name: { type: "string" },
            kind: { enum: ["idle", "blink", "talk", "surprise"] },
            loop: { type: "boolean" },
            durationMs: { type: "number", exclusiveMinimum: 0 },
            curves: {
              type: "array",
              items: {
                type: "object",
                required: ["param", "keys"],
                properties: {
                  param: { type: "string" },
                  keys: { type: "array", items: { type: "array", prefixItems: [{ type: "number" }, { type: "number" }], maxItems: 2, minItems: 2 } },
                },
              },
            },
          },
        },
      },
    },
  };
}

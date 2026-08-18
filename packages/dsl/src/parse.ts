// 语言 A 解析器（v0.1 语法：character / motion / expression；scene 属 P6），对应规范 5.6 BNF。
// 递归下降 + 令牌内省；fail-fast：首个错误抛 DslError（带行列号），parseDsl 捕获为 ParseResult。
// 返回 discriminated union 便于 LLM 自修复回传（P4）。

import { DSL_SYNTAX_VERSION } from "./version.ts";
import { DslError, type DslErrorCode } from "./errors.ts";
import { tokenize } from "./lexer.ts";
import type { Token } from "./lexer.ts";
import {
  CURVE_KINDS,
  EASINGS,
  EXPR_BLENDS,
  UNITS,
  type Block,
  type BoneDef,
  type CastDef,
  type CharacterBlock,
  type CurveKind,
  type CurveOpts,
  type Doc,
  type Easing,
  type ExprBlend,
  type ExpressionBlock,
  type Frame,
  type LayerDef,
  type MotionBlock,
  type OutfitDef,
  type ScalarValue,
  type SceneBlock,
  type SemDef,
  type SetLine,
  type SourcePos,
  type Track,
  type Unit,
} from "./ast.ts";

export type ParseResult = { ok: true; doc: Doc } | { ok: false; error: DslError };

export function parseDsl(source: string, sourceId = "<input>", syntaxVersion = DSL_SYNTAX_VERSION): ParseResult {
  try {
    const toks = tokenize(source);
    const p = new Parser(toks);
    const blocks = p.parseDoc();
    return { ok: true, doc: { version: syntaxVersion, sourceId, blocks } };
  } catch (e) {
    if (e instanceof DslError) return { ok: false, error: e };
    throw e;
  }
}

class Parser {
  private i = 0;
  private readonly toks: Token[];

  constructor(toks: Token[]) {
    this.toks = toks;
  }

  private peek(o = 0): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== "eof") this.i += 1;
    return t;
  }

  private err(t: Token, code: DslErrorCode, message: string): never {
    throw new DslError(t.line, t.col, code, message);
  }

  private describe(t: Token): string {
    return t.kind === "eof" ? `文件末尾（${t.line}:${t.col}）` : `'${t.text}'（${t.line}:${t.col}）`;
  }

  private expectPunct(text: string, what: string): Token {
    const t = this.next();
    if (t.kind !== "punct" || t.text !== text) this.err(t, "SYNTAX", `期望 '${text}'${what ? `（${what}）` : ""}，实际 ${this.describe(t)}`);
    return t;
  }

  private skipSemicolons(): void {
    while (this.peek().kind === "punct" && this.peek().text === ";") this.i += 1;
  }

  private checkUnit(t: Token): Unit | undefined {
    if (t.unit === undefined) return undefined;
    if ((UNITS as readonly string[]).includes(t.unit)) return t.unit as Unit;
    this.err(t, "BAD_UNIT", `未知单位 '${t.unit}'（可选：${UNITS.join("/")}）`);
  }

  private msValue(t: Token, what: string): number {
    const unit = t.unit ?? "ms";
    if (unit === "ms") return t.num!;
    if (unit === "s") return t.num! * 1000;
    this.err(t, "BAD_UNIT", `${what} 单位须为 ms 或 s，实际 '${unit}'`);
  }

  private expectIdentName(what: string): { text: string; t: Token } {
    const t = this.next();
    if (t.kind !== "ident") this.err(t, "SYNTAX", `期望${what}，实际 ${this.describe(t)}`);
    return { text: t.text, t };
  }

  parseDoc(): Block[] {
    const blocks: Block[] = [];
    this.skipSemicolons();
    while (this.peek().kind !== "eof") {
      blocks.push(this.parseBlock());
      this.skipSemicolons();
    }
    return blocks;
  }

  private parseBlock(): Block {
    const kw = this.next();
    if (kw.kind !== "ident") this.err(kw, "SYNTAX", `期望块关键字（character / motion / expression），实际 ${this.describe(kw)}`);
    const { text: blockName, t: nameTok } = this.expectIdentName("块名");
    this.expectPunct("{", `进入 ${kw.text} 块 '${blockName}'`);
    switch (kw.text) {
      case "character":
        return this.parseCharacter(blockName, nameTok);
      case "motion":
        return this.parseMotion(blockName, nameTok);
      case "expression":
        return this.parseExpression(blockName, nameTok);
      case "scene":
        return this.parseScene(blockName, nameTok);
      default:
        this.err(kw, "SYNTAX", `未知块类型 '${kw.text}'（期望 character / motion / expression / scene）`);
    }
  }

  // ------------------------------------------------------------------ character

  private parseCharacter(name: string, nameTok: Token): CharacterBlock {
    let source: string | undefined;
    let slot: string | undefined;
    const layers: LayerDef[] = [];
    const bones: BoneDef[] = [];
    const outfits: OutfitDef[] = [];
    const sems: SemDef[] = [];
    let closeTok: Token = this.peek();

    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { closeTok = t; this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", `character '${name}' 块未闭合（缺少 '}'）`);
      if (t.kind !== "ident") this.err(t, "SYNTAX", `character 块内期望属性，实际 ${this.describe(t)}`);
      switch (t.text) {
        case "source": {
          this.i += 1;
          this.expectPunct(":", "source 值");
          const v = this.next();
          if (v.kind !== "string") this.err(v, "SYNTAX", `source 须为字符串路径，实际 ${this.describe(v)}`);
          source = v.text;
          continue;
        }
        case "slot": {
          this.i += 1;
          this.expectPunct(":", "slot 值");
          const v = this.next();
          if (v.kind !== "ident") this.err(v, "SYNTAX", `slot 须为标识符，实际 ${this.describe(v)}`);
          slot = v.text;
          continue;
        }
        case "layer":
          layers.push(this.parseLayer());
          continue;
        case "bone":
          bones.push(this.parseBone());
          continue;
        case "outfit":
          outfits.push(this.parseOutfit());
          continue;
        case "sem":
          sems.push(this.parseSem());
          continue;
        default:
          this.err(t, "UNKNOWN_KEY", `character 块内未知属性 '${t.text}'（支持：source/slot/layer/bone/outfit/sem）`);
      }
    }

    this.checkUnique(layers.map(l => l.name), "layer", layers.map(l => l.pos));
    this.checkUnique(bones.map(b => b.name), "bone", bones.map(b => b.pos));
    this.checkUnique(outfits.map(o => o.name), "outfit", outfits.map(o => o.pos));
    this.checkUnique(sems.map(s => s.name), "sem", sems.map(s => s.pos));

    if (layers.length === 0 && sems.length === 0 && outfits.length === 0 && bones.length === 0) {
      throw new DslError(closeTok.line, closeTok.col, "CONSTRAINT", `character '${name}' 为空（至少需 layer/outfit/sem/bone 之一）`);
    }
    return {
      kind: "character",
      name,
      pos: { line: nameTok.line, col: nameTok.col },
      source,
      slot,
      layers,
      bones,
      outfits,
      sems,
    };
  }

  private checkUnique(names: string[], what: string, pos: SourcePos[]): void {
    const seen = new Map<string, number>();
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      if (seen.has(n)) {
        const p = pos[seen.get(n)!];
        throw new DslError(p.line, p.col, "CONSTRAINT", `${what} 名称 '${n}' 重复`);
      }
      seen.set(n, i);
    }
  }

  private parseLayer(): LayerDef {
    this.next(); // 'layer'
    const { text: name, t: nameTok } = this.expectIdentName("layer 名称");
    this.expectPunct("{", `layer '${name}' 块`);
    let parts: string[] | undefined;
    let z: number | undefined;
    let physics: string | undefined;

    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", `layer '${name}' 块未闭合`);
      if (t.kind !== "ident") this.err(t, "SYNTAX", `layer 块内期望属性，实际 ${this.describe(t)}`);
      if (t.text === "parts") {
        this.i += 1;
        this.expectPunct(":", "parts 值");
        parts = this.parseParts(name);
        continue;
      }
      if (t.text === "z") {
        this.i += 1;
        this.expectPunct(":", "z 值");
        const v = this.next();
        if (v.kind !== "number") this.err(v, "SYNTAX", `z 须为数值，实际 ${this.describe(v)}`);
        z = v.num!;
        continue;
      }
      if (t.text === "physics") {
        this.i += 1;
        this.expectPunct(":", "physics 值");
        const v = this.next();
        if (v.kind !== "ident") this.err(v, "SYNTAX", `physics 须为标识符，实际 ${this.describe(v)}`);
        physics = v.text;
        continue;
      }
      this.err(t, "UNKNOWN_KEY", `layer 块内未知属性 '${t.text}'（支持：parts/z/physics）`);
    }

    if (parts === undefined || parts.length === 0) {
      throw new DslError(nameTok.line, nameTok.col, "CONSTRAINT", `layer '${name}' 缺少必填 parts`);
    }
    return { name, pos: { line: nameTok.line, col: nameTok.col }, parts, z, physics };
  }

  private parseParts(layerName: string): string[] {
    const t = this.peek();
    const out: string[] = [];
    if (t.kind === "punct" && t.text === "[") {
      this.i += 1;
      for (;;) {
        this.skipSemicolons();
        const p = this.peek();
        if (p.kind === "punct" && p.text === "]") { this.i += 1; break; }
        if (p.kind === "eof") this.err(p, "SYNTAX", `layer '${layerName}' parts 数组未闭合`);
        if (p.kind !== "ident") this.err(p, "SYNTAX", `parts 元素须为部件名，实际 ${this.describe(p)}`);
        out.push(p.text);
        this.i += 1;
      }
      if (out.length === 0) this.err(t, "CONSTRAINT", `layer '${layerName}' parts 数组不能为空`);
      return out;
    }
    if (t.kind === "ident") {
      this.i += 1;
      return [t.text];
    }
    this.err(t, "SYNTAX", `parts 须为 '[' 部件名... ']' 或单个部件名，实际 ${this.describe(t)}`);
  }

  private parseBone(): BoneDef {
    this.next(); // 'bone'
    const { text: name, t: nameTok } = this.expectIdentName("bone 名称");
    this.expectPunct("{", `bone '${name}' 块`);
    let layer: string | undefined;
    let pivot: { x: number; y: number } | undefined;
    let limit: BoneDef["limit"];

    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", `bone '${name}' 块未闭合`);
      if (t.kind !== "ident") this.err(t, "SYNTAX", `bone 块内期望属性，实际 ${this.describe(t)}`);
      if (t.text === "layer") {
        this.i += 1;
        this.expectPunct(":", "layer 引用");
        const v = this.next();
        if (v.kind !== "ident") this.err(v, "SYNTAX", `bone.layer 须引用 layer 名，实际 ${this.describe(v)}`);
        layer = v.text;
        continue;
      }
      if (t.text === "pivot") {
        this.i += 1;
        this.expectPunct(":", "pivot 值");
        this.expectPunct("[", "pivot 数组");
        const a = this.next();
        const b = this.next();
        if (a.kind !== "number" || b.kind !== "number") this.err(a, "SYNTAX", "pivot 须为 [x y] 两个数值");
        const close = this.next();
        if (close.kind !== "punct" || close.text !== "]") this.err(close, "SYNTAX", "pivot 数组须以 ']' 结束");
        pivot = { x: a.num!, y: b.num! };
        continue;
      }
      if (t.text === "limit") {
        this.i += 1;
        this.expectPunct(":", "limit 值");
        limit = this.parseLimit();
        continue;
      }
      this.err(t, "UNKNOWN_KEY", `bone 块内未知属性 '${t.text}'（支持：layer/pivot/limit）`);
    }

    if (layer === undefined) {
      throw new DslError(nameTok.line, nameTok.col, "CONSTRAINT", `bone '${name}' 缺少必填 layer 引用`);
    }
    return { name, pos: { line: nameTok.line, col: nameTok.col }, layer, pivot, limit };
  }

  private parseLimit(): BoneDef["limit"] {
    let t = this.next();
    let axis: string | undefined;
    let sign: string | undefined;
    if (t.kind === "ident") { axis = t.text; t = this.next(); }
    if (t.kind === "punct" && (t.text === "±" || t.text === "-" || t.text === "+")) { sign = t.text; t = this.next(); }
    if (t.kind !== "number") this.err(t, "SYNTAX", `limit 须为数值（可带轴名/±），实际 ${this.describe(t)}`);
    const unit = this.checkUnit(t);
    return { axis, sign, value: t.num!, unit };
  }

  private parseOutfit(): OutfitDef {
    this.next(); // 'outfit'
    const { text: name, t: nameTok } = this.expectIdentName("outfit 名称");
    this.expectPunct("{", `outfit '${name}' 块`);
    let group: number | undefined;
    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", `outfit '${name}' 块未闭合`);
      if (t.text !== "group") this.err(t, "UNKNOWN_KEY", `outfit 块内未知属性 '${t.text}'（支持：group）`);
      this.i += 1;
      this.expectPunct(":", "group 值");
      const v = this.next();
      if (v.kind !== "number") this.err(v, "SYNTAX", `group 须为整数组号，实际 ${this.describe(v)}`);
      if (!Number.isInteger(v.num!)) this.err(v, "SYNTAX", `group 须为整数组号，实际 ${v.num}`);
      group = v.num!;
    }
    if (group === undefined) {
      throw new DslError(nameTok.line, nameTok.col, "CONSTRAINT", `outfit '${name}' 缺少必填 group`);
    }
    return { name, pos: { line: nameTok.line, col: nameTok.col }, group };
  }

  private parseSem(): SemDef {
    this.next(); // 'sem'
    const { text: name, t: nameTok } = this.expectIdentName("sem 语义参数名");
    const open = this.next();
    if (open.kind !== "punct" || open.text !== "[") this.err(open, "SYNTAX", `sem '${name}' 须声明范围 [min max]`);
    const minT = this.next();
    const maxT = this.next();
    if (minT.kind !== "number" || maxT.kind !== "number") this.err(minT, "SYNTAX", `sem '${name}' 范围须为 [数值 数值]`);
    const close = this.next();
    if (close.kind !== "punct" || close.text !== "]") this.err(close, "SYNTAX", `sem '${name}' 范围须以 ']' 结束`);
    // 单位：min 与 max 的 unit 须一致；无单位缺省
    const unitMin = this.checkUnit(minT);
    const unitMax = this.checkUnit(maxT);
    if (unitMin !== unitMax) this.err(minT, "BAD_UNIT", `sem '${name}' 范围单位不一致（${String(unitMin)} vs ${String(unitMax)}）`);
    if (minT.num! >= maxT.num!) this.err(open, "CONSTRAINT", `sem '${name}' 范围无效（min 须 < max）`);
    const arrow = this.next();
    if (arrow.kind !== "punct" || arrow.text !== "->") this.err(arrow, "SYNTAX", `sem '${name}' 须以 '-> { PARAM_ID ... }' 声明映射`);
    this.expectPunct("{", "sem 映射区");
    const params: string[] = [];
    for (;;) {
      this.skipSemicolons();
      const p = this.peek();
      if (p.kind === "punct" && p.text === "}") { this.i += 1; break; }
      if (p.kind === "eof") this.err(p, "SYNTAX", `sem '${name}' 映射区未闭合`);
      if (p.kind !== "ident") this.err(p, "SYNTAX", `sem 映射区须为官方参数 ID 列表，实际 ${this.describe(p)}`);
      params.push(p.text);
      this.i += 1;
    }
    if (params.length === 0) {
      throw new DslError(nameTok.line, nameTok.col, "CONSTRAINT", `sem '${name}' 至少需要一个映射官方参数`);
    }
    return { name, pos: { line: nameTok.line, col: nameTok.col }, min: minT.num!, max: maxT.num!, unit: unitMin, params };
  }

  // ------------------------------------------------------------------ scene

  private parseScene(name: string, nameTok: Token): SceneBlock {
    let camera: SceneBlock["camera"];
    let bg: string | undefined;
    let physics: boolean | undefined;
    const casts: CastDef[] = [];

    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", `scene '${name}' 块未闭合`);
      if (t.kind !== "ident") this.err(t, "SYNTAX", `scene 块内期望属性，实际 ${this.describe(t)}`);
      switch (t.text) {
        case "camera":
          camera = this.parseCamera();
          continue;
        case "cast":
          casts.push(this.parseCast());
          continue;
        case "bg": {
          this.i += 1;
          this.expectPunct(":", "bg 值");
          const v = this.next();
          if (v.kind !== "string") this.err(v, "SYNTAX", `bg 须为字符串路径，实际 ${this.describe(v)}`);
          bg = v.text;
          continue;
        }
        case "physics": {
          this.i += 1;
          this.expectPunct(":", "physics 值");
          const v = this.next();
          if (v.kind === "ident" && (v.text === "on" || v.text === "true")) { physics = true; continue; }
          if (v.kind === "ident" && (v.text === "off" || v.text === "false")) { physics = false; continue; }
          this.err(v, "SYNTAX", `physics 值须为 on/off，实际 ${this.describe(v)}`);
        }
        default:
          this.err(t, "UNKNOWN_KEY", `scene 块内未知属性 '${t.text}'（支持：camera / cast / bg / physics）`);
      }
    }

    return { kind: "scene", name, pos: { line: nameTok.line, col: nameTok.col }, camera, casts, bg, physics };
  }

  private parseCamera(): NonNullable<SceneBlock["camera"]> {
    this.next(); // 'camera'
    this.expectPunct("{", "camera 块");
    const cam: NonNullable<SceneBlock["camera"]> = {};
    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", "camera 块未闭合");
      if (t.kind !== "ident") this.err(t, "SYNTAX", `camera 块内期望属性，实际 ${this.describe(t)}`);
      if (t.text === "zoom") {
        this.i += 1;
        this.expectPunct(":", "zoom 值");
        const v = this.next();
        if (v.kind !== "number") this.err(v, "SYNTAX", `zoom 须为数值，实际 ${this.describe(v)}`);
        cam.zoom = v.num!;
        continue;
      }
      if (t.text === "anchor") {
        this.i += 1;
        this.expectPunct(":", "anchor 值");
        const a = this.parseNumPair("anchor");
        cam.anchor = { x: a[0], y: a[1] };
        continue;
      }
      this.err(t, "UNKNOWN_KEY", `camera 块内未知属性 '${t.text}'（支持：zoom / anchor）`);
    }
    return cam;
  }

  private parseCast(): CastDef {
    this.next(); // 'cast'
    const { text: name, t: nameTok } = this.expectIdentName("cast 角色名");
    this.expectPunct("{", `cast '${name}' 块`);
    let source: string | undefined;
    let anchor: { x: number; y: number } | undefined;
    let scale: number | undefined;

    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", `cast '${name}' 块未闭合`);
      if (t.kind !== "ident") this.err(t, "SYNTAX", `cast 块内期望属性，实际 ${this.describe(t)}`);
      if (t.text === "source") {
        this.i += 1;
        this.expectPunct(":", "source 值");
        const v = this.next();
        if (v.kind !== "string") this.err(v, "SYNTAX", `cast.source 须为字符串路径，实际 ${this.describe(v)}`);
        source = v.text;
        continue;
      }
      if (t.text === "anchor") {
        this.i += 1;
        this.expectPunct(":", "anchor 值");
        const a = this.parseNumPair("cast anchor");
        anchor = { x: a[0], y: a[1] };
        continue;
      }
      if (t.text === "scale") {
        this.i += 1;
        this.expectPunct(":", "scale 值");
        const v = this.next();
        if (v.kind !== "number") this.err(v, "SYNTAX", `scale 须为数值，实际 ${this.describe(v)}`);
        scale = v.num!;
        continue;
      }
      this.err(t, "UNKNOWN_KEY", `cast 块内未知属性 '${t.text}'（支持：source / anchor / scale）`);
    }

    if (source === undefined || anchor === undefined) {
      throw new DslError(nameTok.line, nameTok.col, "CONSTRAINT", `cast '${name}' 缺少必填 source / anchor`);
    }
    return { name, pos: { line: nameTok.line, col: nameTok.col }, source, anchor, scale };
  }

  private parseNumPair(what: string): [number, number] {
    this.expectPunct("[", `${what} 数组`);
    const a = this.next();
    const b = this.next();
    const close = this.next();
    if (a.kind !== "number" || b.kind !== "number") this.err(a, "SYNTAX", `${what} 须为 [x y] 两个数值`);
    if (close.kind !== "punct" || close.text !== "]") this.err(close, "SYNTAX", `${what} 数组须以 ']' 结束`);
    return [a.num!, b.num!];
  }

  // ------------------------------------------------------------------ motion

  private parseMotion(name: string, nameTok: Token): MotionBlock {
    let group: string | undefined;
    let durationMs: number | undefined;
    let loop = false;
    const tracks: Track[] = [];
    let closeTok: Token = this.peek();

    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { closeTok = t; this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", `motion '${name}' 块未闭合（缺少 '}'）`);
      if (t.kind !== "ident") this.err(t, "SYNTAX", `motion 块内期望属性或 track，实际 ${this.describe(t)}`);
      switch (t.text) {
        case "group": {
          this.i += 1;
          this.expectPunct(":", "group 值");
          const v = this.next();
          if (v.kind === "ident" || v.kind === "string") { group = v.text; continue; }
          this.err(v, "SYNTAX", `group 值须为标识符或字符串，实际 ${this.describe(v)}`);
        }
        case "duration": {
          this.i += 1;
          this.expectPunct(":", "duration 值");
          const v = this.next();
          if (v.kind !== "number") this.err(v, "SYNTAX", `duration 须为数值（ms/s），实际 ${this.describe(v)}`);
          durationMs = this.msValue(v, "duration");
          continue;
        }
        case "loop": {
          this.i += 1;
          this.expectPunct(":", "loop 值");
          const v = this.next();
          if (v.kind === "ident" && v.text === "true") { loop = true; continue; }
          if (v.kind === "ident" && v.text === "false") { loop = false; continue; }
          this.err(v, "SYNTAX", `loop 值须为 true/false，实际 ${this.describe(v)}`);
        }
        case "track":
          tracks.push(this.parseTrack());
          continue;
        default:
          this.err(t, "UNKNOWN_KEY", `motion 块内未知属性 '${t.text}'（支持：group / duration / loop / track）`);
      }
    }

    if (tracks.length === 0) {
      throw new DslError(closeTok.line, closeTok.col, "CONSTRAINT", `motion '${name}' 至少需要一条 track`);
    }
    return { kind: "motion", name, pos: { line: nameTok.line, col: nameTok.col }, group, durationMs, loop, tracks };
  }

  private parseTrack(): Track {
    const kw = this.next(); // 'track'
    const sem = this.next();
    if (sem.kind !== "ident") this.err(sem, "SYNTAX", `track 须带语义参数名，实际 ${this.describe(sem)}`);
    this.expectPunct("{", `track '${sem.text}' 块`);

    const frames: Frame[] = [];
    let easing: Easing | undefined;
    let curve: CurveKind | undefined;
    let curveOpts: CurveOpts | undefined;
    let closeTok: Token = this.peek();

    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { closeTok = t; this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", `track '${sem.text}' 块未闭合（缺少 '}'）`);

      if (t.kind === "number") {
        if (curve !== undefined) this.err(t, "CONSTRAINT", `track '${sem.text}' 内 'curve:' 与关键帧互斥`);
        if (easing !== undefined) this.err(t, "CONSTRAINT", `track '${sem.text}' 内 'easing' 须位于关键帧段之后`);
        this.i += 1;
        const timeTok = t;
        const timeMs = this.msValue(timeTok, `关键帧时间（第 ${frames.length + 1} 个）`);
        this.expectPunct(":", `第 ${frames.length + 1} 个关键帧值`);
        const vt = this.next();
        if (vt.kind !== "number") this.err(vt, "SYNTAX", `关键帧值须为数值，实际 ${this.describe(vt)}`);
        const unit = this.checkUnit(vt);
        if (frames.length > 0 && timeMs <= frames[frames.length - 1].timeMs) {
          this.err(timeTok, "CONSTRAINT", `关键帧时间须严格递增（${String(frames[frames.length - 1].timeMs)} → ${String(timeMs)}）`);
        }
        frames.push({
          timeMs,
          value: { num: vt.num!, unit, pos: { line: vt.line, col: vt.col } },
          pos: { line: kw.line, col: kw.col },
        });
        continue;
      }

      if (t.kind === "ident") {
        if (t.text === "easing") {
          this.i += 1;
          this.expectPunct(":", "easing 值");
          const ev = this.next();
          if (ev.kind !== "ident" || !(EASINGS as readonly string[]).includes(ev.text)) {
            this.err(ev, "SYNTAX", `未知 easing '${ev.text}'（可选：${EASINGS.join("/")}）`);
          }
          if (easing !== undefined) this.err(ev, "CONSTRAINT", "easing 重复");
          easing = ev.text as Easing;
          continue;
        }
        if (t.text === "curve") {
          this.i += 1;
          this.expectPunct(":", "curve 值");
          const cv = this.next();
          if (cv.kind !== "ident" || !(CURVE_KINDS as readonly string[]).includes(cv.text)) {
            this.err(cv, "SYNTAX", `未知曲线函数 '${cv.text}'（可选：${CURVE_KINDS.join("/")}）`);
          }
          if (curve !== undefined) this.err(cv, "CONSTRAINT", "curve 重复");
          if (frames.length > 0) this.err(cv, "CONSTRAINT", `track '${sem.text}' 内 'curve:' 与关键帧互斥`);
          const kind = cv.text as CurveKind;
          let opts: CurveOpts | undefined;
          if (this.peek().kind === "punct" && this.peek().text === "{") {
            opts = this.parseCurveOpts(kind);
          }
          curve = kind;
          curveOpts = opts;
          continue;
        }
        this.err(t, "UNKNOWN_KEY", `track 内未知条目 '${t.text}'（支持：关键帧 时间:值、easing、curve）`);
      }

      this.err(t, "SYNTAX", `track 内期望关键帧/easing/curve 或 '}'，实际 ${this.describe(t)}`);
    }

    if (frames.length === 0 && curve === undefined) {
      throw new DslError(closeTok.line, closeTok.col, "CONSTRAINT", `track '${sem.text}' 至少需要一条关键帧或 'curve:'`);
    }
    return { sem: sem.text, pos: { line: kw.line, col: kw.col }, frames, easing, curve, curveOpts };
  }

  private parseCurveOpts(kind: CurveKind): CurveOpts {
    this.expectPunct("{", `curve:${kind} 参数块`);
    const opts: CurveOpts = {};
    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", `curve:${kind} 参数块未闭合`);
      if (t.kind !== "ident") this.err(t, "SYNTAX", `curve 参数块内期望键值，实际 ${this.describe(t)}`);
      if (t.text === "amplitude" || t.text === "bias") {
        this.i += 1;
        this.expectPunct(":", `${t.text} 值`);
        const v = this.next();
        if (v.kind !== "number") this.err(v, "SYNTAX", `${t.text} 须为无单位数值，实际 ${this.describe(v)}`);
        if (t.text === "amplitude") opts.amplitude = v.num!;
        else opts.bias = v.num!;
        continue;
      }
      if (t.text === "period") {
        this.i += 1;
        this.expectPunct(":", "period 值");
        const v = this.next();
        if (v.kind !== "number") this.err(v, "SYNTAX", `period 须为时长数值（ms/s），实际 ${this.describe(v)}`);
        opts.periodMs = this.msValue(v, "period");
        continue;
      }
      this.err(t, "UNKNOWN_KEY", `curve 参数块内未知键 '${t.text}'（支持：amplitude / period / bias）`);
    }
    return opts;
  }

  // ------------------------------------------------------------------ expression

  private parseExpression(name: string, nameTok: Token): ExpressionBlock {
    let blend: ExprBlend | undefined;
    const sets: SetLine[] = [];
    let closeTok: Token = this.peek();

    for (;;) {
      this.skipSemicolons();
      const t = this.peek();
      if (t.kind === "punct" && t.text === "}") { closeTok = t; this.i += 1; break; }
      if (t.kind === "eof") this.err(t, "SYNTAX", `expression '${name}' 块未闭合（缺少 '}'）`);
      if (t.kind !== "ident") this.err(t, "SYNTAX", `expression 块内期望属性，实际 ${this.describe(t)}`);
      if (t.text === "blend") {
        this.i += 1;
        this.expectPunct(":", "blend 值");
        const b = this.next();
        if (b.kind !== "ident" || !(EXPR_BLENDS as readonly string[]).includes(b.text)) {
          this.err(b, "SYNTAX", `blend 须为 Add/Multiply/Overwrite，实际 ${this.describe(b)}`);
        }
        if (blend !== undefined) this.err(b, "CONSTRAINT", "blend 重复");
        blend = b.text as ExprBlend;
        continue;
      }
      if (t.text === "set") {
        this.i += 1;
        const sem = this.next();
        if (sem.kind !== "ident") this.err(sem, "SYNTAX", `set 须带语义参数名，实际 ${this.describe(sem)}`);
        this.expectPunct("=", `set '${sem.text}' 值`);
        const vt = this.next();
        if (vt.kind !== "number") this.err(vt, "SYNTAX", `set 值须为数值，实际 ${this.describe(vt)}`);
        const unit = this.checkUnit(vt);
        sets.push({
          sem: sem.text,
          value: { num: vt.num!, unit, pos: { line: vt.line, col: vt.col } },
          pos: { line: sem.line, col: sem.col },
        });
        continue;
      }
      this.err(t, "UNKNOWN_KEY", `expression 块内未知属性 '${t.text}'（支持：blend / set）`);
    }

    if (blend === undefined) {
      throw new DslError(closeTok.line, closeTok.col, "CONSTRAINT", `expression '${name}' 缺少必填 blend`);
    }
    if (sets.length === 0) {
      throw new DslError(closeTok.line, closeTok.col, "CONSTRAINT", `expression '${name}' 至少需要一条 set`);
    }
    return { kind: "expression", name, pos: { line: nameTok.line, col: nameTok.col }, blend, sets };
  }
}

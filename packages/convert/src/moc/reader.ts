// moc/reader.ts —— Cubism 2.x `.moc` 二进制安全读原语（自研，绕开官方 runtime）
// 端序：i32/f32 大端（BE）；类型/计数/字符串长度用大端 varint（MSB-first，实证匹配官方
//   live2d.js 的 _\$fP：首字节为高位段）。
// 对象读取 dispatch（对照官方 live2d.js St._\$4b / G._\$9o，2026-08 实证）：
//   0=Null  15=ObjectArray  16/25=I32数组  26=F64数组  27=F32数组
//   33=对象引用（读 int32 → 对象缓存[索引]）
//   50/51/60/134=字符串对象（长度 varint + 字节）
//   65=CurvedSurfaceDeformer  66=PivotManager  67=Pivot  68=RotationDeformer
//   69=Affine  70=Mesh(单网格，extends W 基础)
//   131=Parameter  133=Part
// 每个经对象读写走的字段（id/对象字段）都会 push 到对象缓存 —— 33 引用按索引回取。
// Mesh 读法（官方 $t._\$F0）：base(W): id串/目标串/GS对象/i32/裸i32数组/裸f32数组/[clip 对象 v>=11]
//   → textureNo(i32)/pointCount(i32)/polygonCount(i32)/indices(对象)/points(对象→f32)/uvs(对象→f32)/[flags v>=8]

import { MOC_HEADER_SIZE, MOC_MAGIC, MocTypeId, MocVersion } from "./format.ts";
import type {
  MocAffine, MocCurvedSurfaceDeformer, MocData, MocMesh, MocParameter, MocPart, MocPivot,
  MocResult, MocRotationDeformer,
} from "./format.ts";

export class MocOutOfBoundsError extends Error {}

export class MocReader {
  readonly size: number;
  readonly version: number;
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  private pos: number;

  constructor(buf: Uint8Array, version: number, start: number) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.size = buf.byteLength;
    this.version = version;
    this.pos = start;
  }

  offset(): number { return this.pos; }

  private check(n: number): void {
    if (!Number.isInteger(this.pos) || this.pos < 0 || this.pos + n > this.size) {
      throw new MocOutOfBoundsError(
        `越界读取 @0x${this.pos.toString(16)}+${n}（size=0x${this.size.toString(16)}）`,
      );
    }
  }

  u8(): number { this.check(1); return this.buf[this.pos++]!; }

  /** 大端 i32 */
  i32(): number { this.check(4); const v = this.view.getInt32(this.pos, false); this.pos += 4; return v; }

  /** 大端 f32 */
  f32(): number { this.check(4); const v = this.view.getFloat32(this.pos, false); this.pos += 4; return v; }

  /** 大端 float64（type 26 数组用） */
  f64(): number { this.check(8); const v = this.view.getFloat64(this.pos, false); this.pos += 8; return v; }

  /** 大端 varint（MSB-first） */
  varint(): number {
    let val = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      const cont = (b & 0x80) !== 0;
      val = (val << 7) | (b & 0x7f);
      if (!cont) return val;
    }
    throw new Error(`varint 过长 @0x${this.pos.toString(16)}`);
  }

  advance(n: number): void { this.check(n); this.pos += n; }

  /** 原生串：长度 varint + 字节（对应官方 _\$bT；不经对象缓存） */
  readRawString(): string {
    const len = this.varint();
    this.check(len);
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.buf[this.pos + i]!);
    this.pos += len;
    return s;
  }
}

/** 读「普通数组」（count varint + 元素，不经缓存）—— 对应官方 _\$cS/_\$Tb */
export function readPlainArray(r: MocReader, elem: "i32" | "f32"): number[] {
  const n = r.varint();
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(elem === "i32" ? r.i32() : r.f32());
  return out;
}

export type RawObject =
  | { t: "null" }
  | { t: "str"; v: string }
  | { t: "array"; items: RawObject[] }
  | { t: "i32arr"; items: number[] }
  | { t: "f64arr"; items: number[] }
  | { t: "f32arr"; items: number[] }
  | { t: "pivotMgr"; data: RawObject }
  | { t: "pivot"; id: string; count: number; values: RawObject }
  | { t: "affine"; a: MocAffine }
  | { t: "parameter"; id: string; min: number; max: number; def: number }
  | { t: "part"; id: string; flags: number; deformers: RawObject; components: RawObject }
  | { t: "deformer"; d: MocRotationDeformer | MocCurvedSurfaceDeformer }
  | { t: "texture"; meshes: MocMesh[] }
  | { t: "ref"; v: RawObject };

/** 对象缓存（官方 _\$Ko；每个经 _\$nP 读出的对象/字符串按序入缓存，33 引用取回） */
export const __mocCache: RawObject[] = [];

export function readObject(r: MocReader): RawObject {
  const t = r.varint();
  if (t === MocTypeId.REFERENCE) {
    const idx = r.i32();
    if (idx >= 0 && idx < __mocCache.length) return { t: "ref", v: __mocCache[idx]! };
    throw new Error(`对象引用越界 idx=${idx}（cache len=${__mocCache.length}）`);
  }
  let obj: RawObject;
  switch (t) {
    case MocTypeId.NULL: obj = { t: "null" }; break;
    case MocTypeId.OBJECT_ARRAY: {
      const n = r.varint();
      const items: RawObject[] = [];
      for (let i = 0; i < n; i++) items.push(readObject(r));
      obj = { t: "array", items };
      break;
    }
    case MocTypeId.INT32_ARRAY_16:
    case MocTypeId.INT32_ARRAY_25: {
      const n = r.varint();
      const items: number[] = [];
      for (let i = 0; i < n; i++) items.push(r.i32());
      obj = { t: "i32arr", items };
      break;
    }
    case MocTypeId.FLOAT64_ARRAY_26: {
      const n = r.varint();
      const items: number[] = [];
      for (let i = 0; i < n; i++) items.push(r.f64());
      obj = { t: "f64arr", items };
      break;
    }
    case MocTypeId.FLOAT32_ARRAY_27: {
      const n = r.varint();
      const items: number[] = [];
      for (let i = 0; i < n; i++) items.push(r.f32());
      obj = { t: "f32arr", items };
      break;
    }
    case MocTypeId.STR_DRAW_50:
    case MocTypeId.STR_DATA_51:
    case MocTypeId.STR_NAME_60:
    case MocTypeId.STR_ID_134: {
      obj = { t: "str", v: r.readRawString() };
      break;
    }
    case MocTypeId.CURVED_SURFACE_DEFORMER: {
      const id = readStr(r);
      const target = readStr(r);
      const row = r.i32();
      const col = r.i32();
      const pivots = readObject(r);
      void readObject(r); // extra（evaluable 数据，语义未用）
      const ops = geoVersion(r) ? readPlainArray(r, "f32") : [];
      obj = { t: "deformer", d: { kind: "curved-surface", id, targetId: target, row, col, pivots: pivotsOf(pivots), opacities: ops } };
      break;
    }
    case MocTypeId.PIVOT_MANAGER: obj = { t: "pivotMgr", data: readObject(r) }; break;
    case MocTypeId.PIVOT: {
      const id = readStr(r);
      const count = r.i32();
      const values = readObject(r);
      obj = { t: "pivot", id, count, values };
      break;
    }
    case MocTypeId.ROTATION_DEFORMER: {
      const id = readStr(r);
      const target = readStr(r);
      const pivots = readObject(r);
      const affine = readObject(r);
      const ops = geoVersion(r) ? readPlainArray(r, "f32") : [];
      obj = { t: "deformer", d: { kind: "rotation", id, targetId: target, pivots: pivotsOf(pivots), affine: affinesOf(affine), opacities: ops } };
      break;
    }
    case MocTypeId.AFFINE: {
      const originX = r.f32();
      const originY = r.f32();
      const scaleX = r.f32();
      const scaleY = r.f32();
      const rotation = r.f32();
      let reflectX = false;
      let reflectY = false;
      if (geoVersion(r)) { reflectX = r.u8() !== 0; reflectY = r.u8() !== 0; }
      obj = { t: "affine", a: { originX, originY, scaleX, scaleY, rotation, reflectX, reflectY } };
      break;
    }
    case MocTypeId.MESH_70: {
      obj = { t: "texture", meshes: [readMesh(r)] };
      break;
    }
    case MocTypeId.PARAMETER: {
      // 官方顺序：min, max, default（rust live2d-parser 此处有误——已按官方修正）
      const min = r.f32();
      const max = r.f32();
      const def = r.f32();
      const id = readStr(r);
      obj = { t: "parameter", id, min, max, def };
      break;
    }
    case MocTypeId.PART: {
      const flags = r.u8();
      const id = readStr(r);
      const deformers = readObject(r);
      const components = readObject(r);
      obj = { t: "part", id, flags, deformers, components };
      break;
    }
    default:
      throw new Error(`未知 MocTypeId ${t} @0x${(r.offset() - 1).toString(16)}`);
  }
  if (__mocCache.length < 60000) __mocCache.push(obj);
  return obj;
}

/** 读一个「字符串或引用」字段（对应官方经 _\$nP 读的 id/目标字段） */
export function readStr(r: MocReader): string {
  const o = readObject(r);
  return o.t === "str" ? o.v : "";
}

function geoVersion(r: MocReader): boolean { return r.version >= MocVersion.V1_10_SDK2_0; }
function clipVersion(r: MocReader): boolean { return r.version >= MocVersion.V1_11_SDK2_1; }
function meshFlagsVersion(r: MocReader): boolean { return r.version >= MocVersion.V1_8_TEX_OPTION; }

/** Mesh：官方 $t._\$F0（base W + 几何字段） */
export function readMesh(r: MocReader): MocMesh {
  const id = readStr(r);
  const targetId = readStr(r);
  void readObject(r); // GS（基础形变/透明度对象）
  const qb = r.i32();
  const lb = readPlainArray(r, "i32");
  const ms = readPlainArray(r, "f32");
  const clipIds: string[] = [];
  if (clipVersion(r)) collectClipIds(readObject(r), clipIds);
  const textureId = r.i32();
  const pointCount = r.i32();
  const polygonCount = r.i32();
  const indices = i32Of(readObject(r));
  const points = pointsOf(readObject(r));
  const uv = f32Of(readObject(r));
  let meshFlags = 0;
  let colorCompositionType = 0;
  let colorGroupId = -1;
  if (meshFlagsVersion(r)) {
    meshFlags = r.i32();
    if (meshFlags !== 0) {
      if ((meshFlags & 1) !== 0) colorGroupId = r.i32();
      colorCompositionType = (meshFlags & 30) !== 0 ? (meshFlags & 30) >> 1 : 0;
    }
  }
  return {
    id,
    targetId,
    points,
    indices,
    uv,
    averageDrawOrder: qb,
    drawOrders: lb,
    opacities: ms,
    clipIds,
    textureId,
    pointCount,
    polygonCount,
    meshFlags,
    colorCompositionType,
    colorGroupId,
    culling: (meshFlags & 32) === 0,
  };
}

function collectClipIds(raw: RawObject, out: string[]): void {
  if (raw.t === "array") { for (const it of raw.items) collectClipIds(it, out); return; }
  if (raw.t === "str") out.push(raw.v);
  else if (raw.t === "ref") collectClipIds(raw.v, out);
}

function leafStr(raw: RawObject): string {
  if (raw.t === "str") return raw.v;
  if (raw.t === "ref") return leafStr(raw.v);
  return "";
}
/** 顶点基础坐标：官方存为 ObjectArray（每个元素一个 xy f32 组）或扁平 f32 数组 */
function pointsOf(raw: RawObject): number[] {
  const flat = f32Of(raw);
  if (flat.length > 0) return flat;
  const x = raw.t === "ref" ? raw.v : raw;
  if (x.t !== "array") return [];
  const out: number[] = [];
  for (const it of x.items) out.push(...f32Of(it));
  return out;
}
function f32Of(raw: RawObject): number[] {
  const x = raw.t === "ref" ? raw.v : raw;
  return x.t === "f32arr" ? x.items : x.t === "i32arr" ? x.items.map(Number) : x.t === "f64arr" ? x.items : [];
}
function i32Of(raw: RawObject): number[] {
  const x = raw.t === "ref" ? raw.v : raw;
  if (x.t === "i32arr") return x.items;
  if (x.t === "f64arr") return x.items.map(Math.round);
  if (x.t === "f32arr") return x.items.map(Math.round);
  return [];
}
function pivotsOf(raw: RawObject): MocPivot[] {
  const x = raw.t === "ref" ? raw.v : raw;
  const out: MocPivot[] = [];
  const walk = (q: RawObject): void => {
    if (q.t === "ref") return walk(q.v);
    if (q.t === "array") { for (const it of q.items) walk(it); return; }
    if (q.t === "pivot") { out.push({ id: q.id, count: q.count, values: f32Of(q.values) }); return; }
    if (q.t === "pivotMgr") walk(q.data);
  };
  walk(x);
  return out;
}
function affinesOf(raw: RawObject): MocAffine[] {
  const x = raw.t === "ref" ? raw.v : raw;
  const out: MocAffine[] = [];
  const walk = (q: RawObject): void => {
    if (q.t === "ref") return walk(q.v);
    if (q.t === "array") { for (const it of q.items) walk(it); return; }
    if (q.t === "affine") out.push(q.a);
  };
  walk(x);
  return out;
}

/** 顶层：解析 头部 → parameters(ObjectData) → parts(ObjectData) → canvas */
export function readMoc(bytes: Uint8Array): MocResult {
  try {
    if (bytes.length < MOC_HEADER_SIZE) return { ok: false, error: `文件过小（${bytes.length} 字节）` };
    const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!);
    if (magic !== MOC_MAGIC) return { ok: false, error: `魔字不是 "moc"（得 "${magic}"）` };
    const version = bytes[3]!;
    if (!(version >= 6 && version <= 11)) return { ok: false, error: `不支持的 .moc 版本 ${version}` };
    __mocCache.length = 0;
    const r = new MocReader(bytes, version, MOC_HEADER_SIZE);

    const paramsObj = readObject(r);
    const partsObj = readObject(r);
    const width = r.i32();
    const height = r.i32();

    const parameters: MocParameter[] = [];
    const collectParam = (x: RawObject): void => {
      const v = x.t === "ref" ? x.v : x;
      if (v.t === "array") { for (const it of v.items) collectParam(it); return; }
      if (v.t === "parameter") parameters.push({ id: v.id, min: v.min, max: v.max, def: v.def });
    };
    collectParam(paramsObj);

    const parts: MocPart[] = [];
    const meshes: MocMesh[] = [];
    const collectPart = (x: RawObject, parent: MocPart | null): void => {
      const v = x.t === "ref" ? x.v : x;
      if (v.t === "array") { for (const it of v.items) collectPart(it, parent); return; }
      if (v.t !== "part") return;
      const p: MocPart = {
        id: v.id,
        flags: v.flags,
        deformers: [],
        meshes: [],
        children: [],
        visible: (v.flags & 2) !== 0,
        locked: (v.flags & 1) !== 0,
      };
      collectDefs(v.deformers, p.deformers);
      collectMeshes(v.components, p.meshes, meshes);
      collectPart(v.components, p);
      if (parent) parent.children.push(p);
      else parts.push(p);
    };
    collectPart(partsObj, null);

    return {
      ok: true,
      moc: {
        format: "l2dp-read-moc",
        version,
        versionName: versionNameOf(version),
        canvas: { width, height },
        parameters,
        parts,
        meshes,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function collectDefs(raw: RawObject, out: MocPart["deformers"]): void {
  const v = raw.t === "ref" ? raw.v : raw;
  if (v.t === "array") { for (const it of v.items) collectDefs(it, out); return; }
  if (v.t === "deformer") out.push(v.d);
}
function collectMeshes(raw: RawObject, out: MocMesh[], all: MocMesh[]): void {
  const v = raw.t === "ref" ? raw.v : raw;
  if (v.t === "array") { for (const it of v.items) collectMeshes(it, out, all); return; }
  if (v.t === "texture") { out.push(...v.meshes); all.push(...v.meshes); return; }
}

export function versionNameOf(v: number): string {
  switch (v) {
    case MocVersion.V1_6_INITIAL: return "V1_6_INITIAL";
    case MocVersion.V1_7_OPACITY: return "V1_7_OPACITY";
    case MocVersion.V1_8_TEX_OPTION: return "V1_8_TEX_OPTION";
    case MocVersion.V1_9_AVATAR_PARTS: return "V1_9_AVATAR_PARTS";
    case MocVersion.V1_10_SDK2_0: return "V1_10_SDK2_0";
    case MocVersion.V1_11_SDK2_1: return "V1_11_SDK2_1";
    default: return `V?${v}`;
  }
}
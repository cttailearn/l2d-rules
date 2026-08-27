// compare-upload.ts —— 上传驱动的对比构建（纯浏览器）
// 输入：用户选择/拖入的 Live2D 模型目录文件列表（File[]，含 webkitRelativePath）。
// 产出：
//   左侧：内存 FileLoader → @l2dp/convert(convertLive2dModel + toL2dmArtifact) → .l2dm JSON
//   右侧：把官方文件做成 blob URL 并改写 model3.json 的相对路径为 blob URL → 官方 runtime 加载
// 零服务器：全程浏览器内存 + blob URL。
import {
  convertLive2dModel,
  toL2dmArtifact,
  type ConvertResult,
  type FileLoader,
} from "@l2dp/convert";
import { loadL2dm } from "@l2dp/engine";

export interface UploadedFile {
  rel: string;
  file: File;
}

/** 把 webkitdirectory 选出的文件列表整理为相对路径 map；自动定位 model3.json。 */
export function collectUpload(files: File[]): { byPath: Map<string, File>; model3Rel: string } {
  const byPath = new Map<string, File>();
  const base = commonRoot(files.map((f) => f.webkitRelativePath));
  let model3Rel: string | null = null;

  for (const f of files) {
    const rel = stripBase(f.webkitRelativePath, base);
    byPath.set(rel, f);
    if (rel.toLowerCase().endsWith(".model3.json")) model3Rel = rel;
  }
  if (!model3Rel) {
    for (const rel of byPath.keys()) {
      if (rel.toLowerCase().includes(".model3.json")) { model3Rel = rel; break; }
    }
  }
  if (!model3Rel) throw new Error("未在所选目录中找到 .model3.json（请选择 Live2D 模型目录根）");
  return { byPath, model3Rel };
}

function commonRoot(paths: string[]): string {
  if (paths.length === 0) return "";
  const segs = paths.map((p) => p.split("/").filter((s) => s.length > 0));
  const first = segs[0]!;
  let n = 0;
  outer: for (let i = 0; i < first.length; i++) {
    const cur = first[i]!;
    for (const s of segs) {
      if (s[i] !== cur) break outer;
    }
    n++;
  }
  return first.slice(0, n).join("/");
}

function stripBase(relPath: string, base: string): string {
  if (!base) return relPath;
  if (!relPath.startsWith(base + "/")) return relPath;
  return relPath.slice(base.length + 1);
}

/** 统一路径分隔符（反斜杠→正斜杠），便于与 model3.json 相对引用匹配。 */
function normalizeKey(rel: string): string {
  return rel.replace(/\\/g, "/");
}

/** 读取上传模型的 model3.json 原始文本。 */
export async function readModel3Raw(byPath: Map<string, File>, model3Rel: string): Promise<string> {
  const f = byPath.get(model3Rel);
  if (!f) throw new Error(`缺少 model3.json: ${model3Rel}`);
  return f.text();
}

// ---------------- 左侧：内存 FileLoader → .l2dm ----------------

function memoryLoader(byPath: Map<string, File>): FileLoader {
  return async (rel) => {
    const f = byPath.get(rel) ?? byPath.get(normalizeKey(rel));
    if (!f) return {};
    const buf = new Uint8Array(await f.arrayBuffer());
    const isText = /\.(json|motion3|exp3|physics3|pose3|cdi3|userdata3)$/i.test(f.name);
    return isText ? { text: new TextDecoder().decode(buf) } : { bytes: buf };
  };
}

/**
 * 左侧：浏览器内实时转换上传模型 → 自包含 .l2dm（内嵌纹理 atlas）。
 */
export async function buildLeftL2dm(
  byPath: Map<string, File>,
  model3Rel: string,
  model3RawText: string,
): Promise<{ modelJson: string; warnings: string[] }> {
  const model3Raw = JSON.parse(model3RawText);
  const loader = memoryLoader(byPath);
  const name = model3Rel.split("/").pop()!.replace(/\.model3\.json$/i, "") || "model";
  const r: ConvertResult = await convertLive2dModel(model3Raw, loader, { name });
  if (!r.ok || !r.bundle) throw new Error(`转换失败: ${r.error}`);
  const bundle = r.bundle;

  const textures: { file: string; bytes: Uint8Array }[] = [];
  for (const t of bundle.fileRefs.textures) {
    const f = byPath.get(t.file) ?? byPath.get(normalizeKey(t.file));
    if (f) textures.push({ file: t.file, bytes: new Uint8Array(await f.arrayBuffer()) });
  }

  const l2dm = toL2dmArtifact(bundle, { textures });
  const loaded = loadL2dm(JSON.stringify(l2dm));
  if (!loaded.ok) throw new Error(`生成的 .l2dm 校验失败: ${loaded.error}`);
  return { modelJson: JSON.stringify(l2dm), warnings: r.warnings };
}

// ---------------- 右侧：blob URL + 相对路径改写 ----------------

interface RightModel3 {
  FileReferences: {
    Moc: string;
    Textures: string[];
    Physics?: string;
    Pose?: string;
    DisplayInfo?: string;
    UserData?: string;
    Expressions?: { File: string }[];
    Motions?: Record<string, { File: string }[]>;
  };
}

/**
 * 右侧：把上传的官方模型做成 blob 文件集，改写 model3.json 所有相对引用为绝对 blob URL。
 * 返回重写后的 model3 blob URL + revoke 清理函数。
 */
export function buildRightModelUrl(
  byPath: Map<string, File>,
  model3Rel: string,
  model3RawText: string,
): { model3Url: string; revoke: () => void } {
  const model3 = JSON.parse(model3RawText) as RightModel3;
  const refs = model3.FileReferences;
  const baseDir = model3Rel.split("/").slice(0, -1).join("/");

  const used: string[] = [];
  const urlFor = (rel: string): string => {
    const key = baseDir ? `${baseDir}/${rel}` : rel;
    const f = byPath.get(key) ?? byPath.get(normalizeKey(key)) ?? byPath.get(rel);
    if (!f) throw new Error(`右侧缺少文件: ${key}`);
    used.push(key);
    return URL.createObjectURL(f);
  };

  try {
    refs.Moc = urlFor(refs.Moc);
    refs.Textures = refs.Textures.map((t) => urlFor(t));
    if (refs.Physics) refs.Physics = urlFor(refs.Physics);
    if (refs.Pose) refs.Pose = urlFor(refs.Pose);
    if (refs.DisplayInfo) refs.DisplayInfo = urlFor(refs.DisplayInfo);
    if (refs.UserData) refs.UserData = urlFor(refs.UserData);
    refs.Expressions = (refs.Expressions ?? []).map((e) => ({ ...e, File: urlFor(e.File) }));
    if (refs.Motions) {
      for (const key of Object.keys(refs.Motions)) {
        refs.Motions[key] = refs.Motions[key]!.map((m) => ({ ...m, File: urlFor(m.File) }));
      }
    }
    const model3Blob = new Blob([JSON.stringify(model3)], { type: "application/json" });
    const url = URL.createObjectURL(model3Blob);
    const revoke = (): void => {
      URL.revokeObjectURL(url);
      for (const u of used) URL.revokeObjectURL(u);
    };
    return { model3Url: url, revoke };
  } catch (e) {
    for (const u of used) URL.revokeObjectURL(u);
    throw e;
  }
}

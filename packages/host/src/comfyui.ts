// comfyui.ts —— ComfyUI REST 桥（提交工作流 / 轮询历史 / 取图；fetch 可注入）
// 契约对齐官方 ComfyUI REST：POST /prompt {prompt, client_id} → {prompt_id}；GET /history/{id} → {outputs, status}
// SDK 只做客户端骨架：真实 SAM2/LayerDiffusion 工作流由宿主注入（SPEC §8 workflows/ 目录），本层负责提交/监视/取图。
import type { CandidateRegion, RgbaImage } from "@l2dp/cutout";
import { decodePng } from "@l2dp/cutout";
import { HttpClient, type Fetcher } from "./http.ts";

export interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyHistoryOutput {
  images?: ComfyImageRef[];
  [k: string]: unknown;
}

export interface ComfyHistoryEntry {
  outputs?: Record<string, ComfyHistoryOutput>;
  status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
}

export interface ComfyUIOptions {
  baseUrl: string;
  clientId?: string;
  fetchImpl?: Fetcher;
  timeoutMs?: number;
  /** 轮询间隔 ms（缺省 800） */
  pollMs?: number;
  /** 最大轮询次数（缺省 40） */
  maxAttempts?: number;
}

/** ComfyUI 工作流运行结果（节点 → 图片引用列表） */
export interface ComfyRunResult {
  promptId: string;
  completed: boolean;
  images: ComfyImageRef[];
}

/** ComfyUI REST 客户端骨架（提交/轮询/收集图片/按引用取图解码）。 */
export class ComfyUIBridge {
  readonly baseUrl: string;
  private readonly http: HttpClient;
  private readonly pollMs: number;
  private readonly maxAttempts: number;
  private readonly clientId: string;
  private seq = 0;

  constructor(opts: ComfyUIOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.http = new HttpClient({ baseUrl: this.baseUrl, fetcher: opts.fetchImpl, timeoutMs: opts.timeoutMs });
    this.pollMs = opts.pollMs ?? 800;
    this.maxAttempts = opts.maxAttempts ?? 40;
    this.clientId = opts.clientId ?? "l2dp-" + (Math.random().toString(36).slice(2, 8));
  }

  /** 提交工作流 → 返回 prompt_id */
  async submit(workflow: unknown): Promise<string> {
    const res = await this.http.postJson<{ prompt_id?: string; error?: unknown }>("prompt", { prompt: workflow, client_id: this.clientId });
    const id = res?.prompt_id;
    if (!id) throw new Error("ComfyUI /prompt 未返回 prompt_id");
    return id;
  }

  /** 轮询历史直到 completed（或超时）；汇总全部输出节点图片。 */
  async wait(promptId: string): Promise<ComfyRunResult> {
    for (let i = 0; i < this.maxAttempts; i++) {
      const entry = await this.http.getJson<Record<string, ComfyHistoryEntry>>("history/" + promptId);
      const mine = entry ? entry[promptId] : undefined;
      const outputs = mine?.outputs ?? {};
      const images: ComfyImageRef[] = [];
      for (const node of Object.values(outputs)) {
        for (const img of node.images ?? []) images.push(img);
      }
      const completed = mine?.status?.completed === true || mine?.status?.status_str === "success";
      if (completed || i === this.maxAttempts - 1) {
        return { promptId, completed, images };
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    return { promptId, completed: false, images: [] };
  }

  /** 一步完成：提交 + 轮询收集图片。 */
  async run(workflow: unknown): Promise<ComfyRunResult> {
    const promptId = await this.submit(workflow);
    return this.wait(promptId);
  }

  /** 图片引用 → /view URL */
  imageUrl(ref: ComfyImageRef): string {
    const p = new URLSearchParams({ filename: ref.filename });
    if (ref.subfolder) p.set("subfolder", ref.subfolder);
    if (ref.type) p.set("type", ref.type);
    return this.baseUrl + "/view?" + p.toString() + "&rand=" + (this.seq++);
  }

  /** 拉取图片并解码为 RGBA（mask/预览用）。 */
  async fetchImage(ref: ComfyImageRef): Promise<RgbaImage> {
    const bytes = await this.http.request("GET", this.imageUrl(ref)).then((r) => r.text);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    return decodePng(buf);
  }
}

/** 把 mask RGBA 图 → 候选（alpha≥128 即掩码位 1；内容 bbox；颜色取非透明主色）。 */
export function maskRgbaToCandidate(rgba: RgbaImage, id: string, confidence = 0.8): CandidateRegion {
  const W = rgba.width;
  const H = rgba.height;
  const mask = new Uint8Array(W * H);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  for (let i = 0; i < W * H; i++) {
    if (rgba.data[i * 4 + 3]! >= 128) {
      mask[i] = 1;
      const x = i % W;
      const y = (i - x) / W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      rSum += rgba.data[i * 4]!; gSum += rgba.data[i * 4 + 1]!; bSum += rgba.data[i * 4 + 2]!; n++;
    }
  }
  const empty = !Number.isFinite(minX);
  const bbox = empty
    ? { x: 0, y: 0, width: 0, height: 0 }
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const color: [number, number, number] | undefined =
    empty || n === 0 ? undefined : [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)];
  return {
    id,
    bbox,
    mask,
    confidence,
    ...(color ? { color } : {}),
  };
}

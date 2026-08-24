// http-segmenter.ts —— HTTP 分割服务 Segmenter（宿主托管/云分割端点；SPEC §9.2 模式B）
import { type CandidateRegion, type RgbaImage, type Segmenter, decodePng, dataUriToBytes, encodePng, pngToDataUri } from "@l2dp/cutout";
import { HttpClient, type Fetcher } from "./http.ts";
import { maskRgbaToCandidate } from "./comfyui.ts";

export interface HttpRegionDto {
  id: string;
  bbox: { x: number; y: number; width: number; height: number };
  /** 掩码图 data URI（可选；缺省用 bbox 整块） */
  maskPng?: string;
  color?: [number, number, number];
  confidence?: number;
}

export interface HttpSegmentsDto {
  regions: HttpRegionDto[];
  issues?: string[];
}

export interface HttpSegmenterOptions {
  /** 端点：POST 收 {image: dataUri} → {regions:[...]} */
  url: string;
  baseUrl?: string;
  authToken?: string;
  fetchImpl?: Fetcher;
  timeoutMs?: number;
}

/** 通用宿主分割服务客户端（实现 Segmenter；无掩码时退化为 bbox 全候选）。 */
export class HttpSegmenter implements Segmenter {
  readonly name = "http";
  private readonly http: HttpClient;
  private readonly url: string;
  constructor(opts: HttpSegmenterOptions) {
    this.url = opts.url;
    this.http = new HttpClient({
      baseUrl: opts.baseUrl,
      fetcher: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
      headers: opts.authToken ? { authorization: "Bearer " + opts.authToken } : {},
    });
  }
  async segment(image: RgbaImage): Promise<CandidateRegion[]> {
    const dataUri = pngToDataUri(encodePng(image.width, image.height, image.data));
    const dto = await this.http.postJson<HttpSegmentsDto>(this.url, { image: dataUri });
    const out: CandidateRegion[] = [];
    for (const r of dto.regions ?? []) {
      if (r.maskPng) {
        const dec = decodePng(dataUriToBytes(r.maskPng));
        out.push(maskRgbaToCandidate(dec, r.id, r.confidence ?? 0.8));
        continue;
      }
      const W = image.width;
      const H = image.height;
      const m = new Uint8Array(W * H);
      const b = r.bbox;
      for (let y = 0; y < b.height; y++) {
        for (let x = 0; x < b.width; x++) {
          const sx = b.x + x, sy = b.y + y;
          if (sx >= 0 && sy >= 0 && sx < W && sy < H) m[sy * W + sx] = 1;
        }
      }
      out.push({ id: r.id, bbox: r.bbox, mask: m, color: r.color, confidence: r.confidence ?? 0.5 });
    }
    return out;
  }
}

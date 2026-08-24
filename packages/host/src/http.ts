// http.ts —— 宿主桥接的通用 HTTP 客户端（fetch 可注入，零平台依赖；同 driver provider 哲学）
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super("HTTP " + status + ": " + body.slice(0, 200));
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export interface HttpClientOptions {
  baseUrl?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

const GLOBAL_FETCH: Fetcher = (url, init) => fetch(url, init);

/** 通用 JSON HTTP 客户端（超时 + 非 2xx 抛 HttpError；响应体统一 JSON/text 取回）。 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(opts: HttpClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "";
    this.fetcher = opts.fetcher ?? GLOBAL_FETCH;
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.headers = { ...opts.headers };
  }

  url(path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return (this.baseUrl.replace(/\/$/, "") + "/" + path.replace(/^\//, "")).replace(/\/$/, "");
  }

  async request(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; json: unknown; text: string; headers: Headers }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const init: RequestInit = {
        method,
        signal: controller.signal,
        headers: { ...this.headers, ...extraHeaders },
      };
      if (body !== undefined) {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
        if (typeof body !== "string") init.headers = { ...(init.headers as Record<string, string>), "content-type": "application/json" };
      }
      const res = await this.fetcher(this.url(path), init);
      const text = await res.text();
      let json: unknown = null;
      if (text.length > 0) { try { json = JSON.parse(text); } catch { json = null; } }
      if (res.status < 200 || res.status >= 300) {
        throw new HttpError(res.status, text);
      }
      return { status: res.status, json, text, headers: res.headers };
    } finally {
      clearTimeout(timer);
    }
  }

  getJson<T = unknown>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request("GET", path, undefined, headers).then((r) => r.json as T);
  }

  postJson<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request("POST", path, body, headers).then((r) => r.json as T);
  }
}

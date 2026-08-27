// stage.ts —— 舞台壳（共享，无 DOM 假设之外的页面胶水）
// 供「聊天页 / 全功能演示页」共用：加载角色模型 → AppCore → 实时渲染（WebGL2/软光栅）→
// 角色切换/背景/缩放/同伴/动作预置/换装/指标；并负责把「上传创建」出的角色从 sessionStorage 恢复。
import {
  createWebGL2Renderer,
  loadL2dm,
  L2dmPlayer,
  SoftwareRenderer,
  type GL2,
  type L2dmModel,
  type RenderSink,
  type Tex2D,
} from "@l2dp/engine";
import { AppCore, type ReplyOutcome, type SpeakNotice } from "./core.ts";
import { APP_CHARACTERS, CHARACTER_LIST, type AppCharacter, type Emotion } from "./chars.ts";
import { decodeModelAtlas, decodeModelAtlasBitmap } from "./texture.ts";

export const STAGE_W = 560;
export const STAGE_H = 720;
const FRAME_INTERVAL_MS = 33;

export const CREATED_KEY = "l2dp:created";
export const IMPORTED_KEY = "l2dp:imported";

export interface StageOpts {
  stageWrap: HTMLElement;
  bubble: HTMLElement;
  badges?: HTMLElement;
  charBtns?: HTMLElement;
  presetsEl?: HTMLElement;
  outfitRow?: HTMLElement;
  outfitBtns?: HTMLElement;
  metricsEl?: HTMLElement;
  chatStatsEl?: HTMLElement;
  bgBtns?: HTMLElement;
  zoomIn?: HTMLElement;
  zoomOut?: HTMLElement;
  companionToggle?: HTMLElement;
  soundToggle?: HTMLElement;
  chatName?: HTMLElement;
  input?: HTMLInputElement;
  /** 页面状态/错误栏（如 #stageStatus） */
  statusEl?: HTMLElement;
  /** 角色 boot 完成后回调（页面可据此显示“基准烘焙/无几何形变”提示） */
  onBoot?: (stage: Stage) => void;
  /** 默认角色 id（未指定时按 URL ?character=，缺省 haru） */
  defaultCharId?: string;
}

export interface CreatedBundle {
  character: AppCharacter;
  reactions: Record<Emotion, string[]>;
  modelText: string;
}

function defaultCharFromUrl(): string {
  const c = new URLSearchParams(location.search).get("character");
  return c && (APP_CHARACTERS[c] || c === "created" || c === "imported") ? c : "haru";
}

// 模块级缓存（单页单实例；session 内复用）
const modelCache = new Map<string, { text: string; atlas: Map<string, Tex2D> }>();
const runtimeModels = new Map<string, { text: string; atlas: Map<string, Tex2D> }>();
const charReactions = new Map<string, Record<string, string[]>>();

async function ensureModel(
  charId: string,
  file: string | undefined,
): Promise<{ text: string; atlas: Map<string, Tex2D> }> {
  const rt = runtimeModels.get(charId);
  if (rt) return rt;
  const hit = modelCache.get(charId);
  if (hit) return hit;
  if (!file) throw new Error("角色无模型文件且未注册运行时模型: " + charId);
  const res = await fetch("/" + file);
  if (!res.ok) throw new Error("fetch " + file + " -> " + res.status);
  const text = await res.text();
  const loaded = loadL2dm(text);
  if (!loaded.ok || !loaded.model) throw new Error("模型加载失败: " + (loaded.ok ? "?" : loaded.error));
  const atlas = await decodeModelAtlasBitmap(loaded.model.atlas);
  const entry = { text, atlas };
  modelCache.set(charId, entry);
  return entry;
}

/** 保存「我的创作」（创建页写、其他页读） */
export function saveCreated(bundle: CreatedBundle): void {
  try {
    sessionStorage.setItem(CREATED_KEY, JSON.stringify(bundle));
  } catch (e) {
    console.warn("保存我的创作失败（可能超出 sessionStorage 容量）:", e);
  }
}

export function loadCreated(): CreatedBundle | null {
  try {
    const raw = sessionStorage.getItem(CREATED_KEY);
    return raw ? (JSON.parse(raw) as CreatedBundle) : null;
  } catch {
    return null;
  }
}

/** 保存导入的 .l2dm 角色（聊天/全功能页可恢复） */
export function saveImported(bundle: CreatedBundle): void {
  try {
    sessionStorage.setItem(IMPORTED_KEY, JSON.stringify(bundle));
  } catch (e) {
    console.warn("保存导入模型失败: ", e);
  }
}

export function loadImported(): CreatedBundle | null {
  try {
    const raw = sessionStorage.getItem(IMPORTED_KEY);
    return raw ? (JSON.parse(raw) as CreatedBundle) : null;
  } catch {
    return null;
  }
}

export class Stage {
  core: AppCore | null = null;
  charId: string;
  companionOn = false;
  private zoom = 1;
  private soundOn = true;
  private rendererKind: "webgl2" | "software" = "webgl2";
  private lastRenderAt = 0;
  private bubbleHideAt = 0;
  private softCtx: CanvasRenderingContext2D | null = null;
  private softImage: ImageData | null = null;
  private bubbleText = "";
  private hopCounts: Record<"1" | "2", number> = { "1": 0, "2": 0 };
  private onSpeak: ((n: SpeakNotice) => void) | null = null;
  private started = false;
  private readonly opts: StageOpts;

  constructor(opts: StageOpts, charId?: string) {
    this.opts = opts;
    this.charId = charId ?? opts.defaultCharId ?? defaultCharFromUrl();
  }

  get soundEnabled(): boolean {
    return this.soundOn;
  }

  get isWebGL2(): boolean {
    return this.rendererKind === "webgl2";
  }

  // ---------------- 渲染器 / 画布 ----------------
  private replaceCanvas(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.id = "canvas";
    cv.width = STAGE_W;
    cv.height = STAGE_H;
    const old = this.opts.stageWrap.querySelector("#canvas") as HTMLCanvasElement | null;
    if (old) old.replaceWith(cv);
    else this.opts.stageWrap.appendChild(cv);
    return cv;
  }

  private makeSink(cv: HTMLCanvasElement): { sink: RenderSink; kind: "webgl2" | "software" } {
    try {
      const glc = cv.getContext("webgl2", { alpha: true, premultipliedAlpha: true });
      if (glc) return { sink: createWebGL2Renderer(glc as unknown as GL2, { filter: "linear" }), kind: "webgl2" };
    } catch {
      // 回退软件
    }
    this.softCtx = cv.getContext("2d");
    this.softImage = null;
    return { sink: new SoftwareRenderer({ filter: "linear" }), kind: "software" };
  }

  // ---------------- 指标 ----------------
  private currentBackground(): [number, number, number, number] {
    const sel = this.opts.bgBtns?.querySelector("button.active")?.getAttribute("data-bg") ?? "clear";
    switch (sel) {
      case "night": return [14, 20, 46, 255];
      case "sunset": return [58, 34, 24, 255];
      case "forest": return [14, 40, 26, 255];
      case "purple": return [34, 22, 56, 255];
      default: return [0, 0, 0, 0];
    }
  }

  private providerCalls(): number {
    const p = this.core?.provider as { calls?: number } | undefined;
    return p?.calls ?? 0;
  }

  private sampleParams(): string {
    if (!this.core) return "";
    const p = this.core.params();
    const wanted = ["ParamMouthOpenY", "ParamAngleX", "微笑", "尾巴摆", "头转向", "衣装组1", "衣装组2"];
    const out: string[] = [];
    for (const k of wanted) if (k in p) out.push(k + "=" + p[k]!.toFixed(2));
    const all = Object.keys(p);
    if (out.length === 0 && all.length > 0) out.push(all[0]! + "=" + p[all[0]!]!.toFixed(2));
    return out.slice(0, 5).join("  ");
  }

  refreshMetrics(): void {
    if (!this.core) return;
    const model = this.core.model;
    const warpCount = model.parts.reduce(
      (n, p) => n + (p.mesh?.warps?.length ?? 0) + (p.mesh?.warp2d?.length ?? 0),
      0,
    );
    const atlasCount = Object.keys(model.atlas ?? {}).length;
    if (this.opts.badges) {
      this.opts.badges.innerHTML =
        '<span class="badge ok">' + this.core.character.id + "</span>" +
        '<span class="badge">参数 ' + model.parameters.length + "</span>" +
        '<span class="badge">部件 ' + model.parts.length + "</span>" +
        '<span class="badge">warp ' + warpCount + "</span>" +
        '<span class="badge">纹理 ' + atlasCount + "</span>" +
        '<span class="badge">渲染 ' + this.rendererKind + "</span>";
    }
    if (this.opts.metricsEl) {
      this.opts.metricsEl.textContent =
        "两跳：第一跳(本地规则) " + this.hopCounts["1"] + " · 第二跳(Provider) " + this.hopCounts["2"] +
        "　|　Provider 调用 " + this.providerCalls() +
        "　|　渲染 " + this.rendererKind + " · 同伴 " + (this.core.hasCompanion ? "开" : "关") +
        "　|　已投喂 " + this.core.ing.applied + " 行 · 坏行隔离 " + this.core.ing.skipped;
    }
    if (this.opts.chatStatsEl) {
      this.opts.chatStatsEl.textContent =
        "累计消息 " + (this.hopCounts["1"] + this.hopCounts["2"]) +
        " · 参数读数：" + this.sampleParams() +
        " · 台词确定性应答器，行为两跳决策（真实 LLM：npm run start + LLM_API_KEY）";
    }
  }

  // ---------------- 载体（onSpeak：气泡 + 语音） ----------------
  private handleSpeak(n: SpeakNotice): void {
    this.bubbleText = n.text;
    this.bubbleHideAt = performance.now() + n.speechMs + 250;
    this.opts.bubble.textContent = n.text;
    this.opts.bubble.hidden = false;
    if (this.soundOn && n.sound) {
      const a = new Audio("/sounds/" + n.sound);
      a.volume = 0.9;
      void a.play().catch(() => void 0);
    }
    this.onSpeak?.(n);
  }

  // ---------------- 载入角色 ----------------
  async boot(id?: string, withCompanion?: boolean): Promise<void> {
    const charId = id ?? this.charId;
    const joined = withCompanion ?? this.companionOn;
    try {
      // 运行时角色（我的创作 / 导入 .l2dm）先在本次会话注册（幂等）
      this.restoreCreatedFromStorage();
      this.restoreImportedFromStorage();
      const char = APP_CHARACTERS[charId];
      if (!char) throw new Error("未知角色: " + charId);
      const hero = await ensureModel(charId, char.file);
      const buddy = joined ? await ensureModel("demo", APP_CHARACTERS["demo"]?.file) : null;

      const cv = this.replaceCanvas();
      const { sink, kind } = this.makeSink(cv);
      this.rendererKind = kind;

      this.core = new AppCore({
        modelJson: hero.text,
        atlas: hero.atlas,
        sink,
        character: char,
        seed: 42,
        stage: { width: STAGE_W, height: STAGE_H },
        background: this.currentBackground(),
        companionModelJson: buddy ? buddy.text : undefined,
        companionAtlas: buddy ? buddy.atlas : undefined,
        reactionLines: charReactions.get(charId),
        onSpeak: (n) => this.handleSpeak(n),
      });
      this.charId = charId;

      // 角色按钮高亮
      if (this.opts.charBtns) {
        for (const b of this.opts.charBtns.querySelectorAll("button")) {
          b.classList.toggle("active", b.dataset["char"] === charId);
        }
      }
      if (this.opts.chatName) this.opts.chatName.textContent = char.label;
      if (this.opts.input) {
        this.opts.input.placeholder = "和「" + char.label.split("（")[0] + "」聊天… Enter 发送";
        this.opts.input.focus();
      }

      // 动作预置
      if (this.opts.presetsEl) {
        this.opts.presetsEl.innerHTML = "";
        for (const p of char.presets) {
          const b = document.createElement("button");
          b.textContent = p.label;
          b.addEventListener("click", () => {
            if (!this.core) return;
            if (p.lines.length === 0) this.core.reset();
            else this.core.feedLines(p.lines);
            this.refreshMetrics();
          });
          this.opts.presetsEl!.appendChild(b);
        }
      }

      // 换装（仅 rig 角色）
      if (this.opts.outfitRow && this.opts.outfitBtns) {
        this.opts.outfitRow.hidden = !char.costumes;
        this.opts.outfitBtns.innerHTML = "";
        if (char.costumes) {
          for (const c of char.costumes) {
            const b = document.createElement("button");
            b.className = "wear";
            b.textContent = "服装组 " + c.group;
            b.addEventListener("click", () => {
              if (!this.core) return;
              this.core.setOutfit(c.group);
              for (const x of this.opts.outfitBtns!.querySelectorAll("button")) x.classList.toggle("active", x === b);
              this.refreshMetrics();
            });
            this.opts.outfitBtns.appendChild(b);
          }
        }
      }

      this.refreshMetrics();
      this.opts.onBoot?.(this);
    } catch (e) {
      console.error("boot 失败:", e);
      this.notifyError("（角色加载失败：" + (e as Error).message + "）");
    }
  }

  /** 页面状态/错误栏（#stageStatus） */
  status(msg: string, tone: "ok" | "warn" | "err" | "" = ""): void {
    const el = this.opts.statusEl;
    if (!el) return;
    el.textContent = msg;
    el.className = "stage-status" + (tone ? " " + tone : "");
    el.hidden = msg.length === 0;
  }

  /** 角色是否有几何形变能力（网格 warp/warp2d）——基准姿态烘焙的官方模型为 false */
  get hasWarpMotion(): boolean {
    const model = this.core?.model;
    if (!model) return false;
    return model.parts.some((p) => (p.mesh?.warps?.length ?? 0) > 0 || (p.mesh?.warp2d?.length ?? 0) > 0);
  }

  private notifyError(text: string): void {
    this.status(text, "err");
    const logEl = document.getElementById("log");
    if (logEl) {
      const m = document.createElement("div");
      m.className = "msg char";
      m.textContent = text;
      m.style.color = "var(--bad)";
      logEl.appendChild(m);
      logEl.scrollTop = logEl.scrollHeight;
    } else {
      console.error(text);
    }
  }

  // ---------------- 驱动 ----------------
  feed(lines: string[]): { applied: number; skipped: number } {
    if (!this.core) return { applied: 0, skipped: 0 };
    const r = this.core.feedLines(lines);
    this.refreshMetrics();
    return r;
  }

  /** 聊天：完整两跳决策 + 台词，返回完整结果供页面渲染气泡/日志 */
  reply(text: string): Promise<ReplyOutcome | null> {
    if (!this.core) return Promise.resolve(null);
    return this.core.handleUserText(text).then((o) => {
      this.hopCounts[String(o.hop) as "1" | "2"]++;
      this.refreshMetrics();
      return o;
    });
  }

  setOutfit(group: number): void {
    if (!this.core) return;
    this.core.setOutfit(group);
    this.refreshMetrics();
  }

  reset(): void {
    if (!this.core) return;
    this.core.reset();
    this.refreshMetrics();
  }

  zoomBy(delta: number): void {
    this.zoom = Math.max(0.7, Math.min(1.6, this.zoom + delta));
    this.core?.zoomTo(this.zoom);
  }

  // ---------------- 运行时角色注册 / 恢复（我的创作 / 导入 .l2dm） ----------------
  private addRuntimeButton(char: AppCharacter, label: string): void {
    const btns = this.opts.charBtns;
    if (!btns) return;
    if (btns.querySelector('[data-char="' + char.id + '"]')) return;
    const b = document.createElement("button");
    b.dataset["char"] = char.id;
    b.textContent = label + "(" + char.label.split("（")[0] + ")";
    b.title = char.desc;
    b.addEventListener("click", () => {
      this.charId = char.id;
      void this.boot(char.id).then(() => void 0);
    });
    btns.appendChild(b);
  }

  registerCreated(char: AppCharacter, reactions: Record<Emotion, string[]>, model: L2dmModel, atlas: Map<string, Tex2D>): void {
    APP_CHARACTERS[char.id] = char;
    charReactions.set(char.id, reactions);
    runtimeModels.set(char.id, { text: JSON.stringify(model), atlas });
    this.addRuntimeButton(char, "✨");
  }

  /** 导入 .l2dm 文件 → 注册为运行时角色（会写入 charReactions=[] 语义映射占位，走 kind 默认反应）。 */
  registerImported(char: AppCharacter, reactions: Record<Emotion, string[]> | null, modelText: string): void {
    const model = JSON.parse(modelText) as L2dmModel;
    const atlas = decodeModelAtlas(model.atlas);
    APP_CHARACTERS[char.id] = char;
    if (reactions) charReactions.set(char.id, reactions);
    runtimeModels.set(char.id, { text: modelText, atlas });
    this.addRuntimeButton(char, "📥");
  }

  restoreCreatedFromStorage(): boolean {
    const bundle = loadCreated();
    if (!bundle || APP_CHARACTERS[bundle.character.id]) return !!bundle;
    try {
      const model = JSON.parse(bundle.modelText) as L2dmModel;
      const atlas = decodeModelAtlas(model.atlas);
      APP_CHARACTERS[bundle.character.id] = bundle.character;
      charReactions.set(bundle.character.id, bundle.reactions);
      runtimeModels.set(bundle.character.id, { text: bundle.modelText, atlas });
      this.addRuntimeButton(bundle.character, "✨");
      return true;
    } catch (e) {
      console.warn("恢复我的创作失败:", e);
      return false;
    }
  }

  restoreImportedFromStorage(): boolean {
    const bundle = loadImported();
    if (!bundle || APP_CHARACTERS[bundle.character.id]) return !!bundle;
    try {
      const model = JSON.parse(bundle.modelText) as L2dmModel;
      const atlas = decodeModelAtlas(model.atlas);
      APP_CHARACTERS[bundle.character.id] = bundle.character;
      charReactions.set(bundle.character.id, bundle.reactions);
      runtimeModels.set(bundle.character.id, { text: bundle.modelText, atlas });
      this.addRuntimeButton(bundle.character, "📥");
      return true;
    } catch (e) {
      console.warn("恢复导入模型失败:", e);
      return false;
    }
  }

  // ---------------- 启动（事件 + rAF） ----------------
  start(): void {
    if (this.started) return;
    this.started = true;

    const o = this.opts;
    o.soundToggle?.addEventListener("click", () => {
      this.soundOn = !this.soundOn;
      o.soundToggle?.classList.toggle("on", this.soundOn);
      if (o.soundToggle) o.soundToggle.textContent = this.soundOn ? "🔊 语音：开" : "🔇 语音：关";
    });
    o.companionToggle?.addEventListener("click", () => {
      this.companionOn = !this.companionOn;
      o.companionToggle?.classList.toggle("on", this.companionOn);
      void this.boot(this.charId, this.companionOn);
    });
    o.zoomIn?.addEventListener("click", () => this.zoomBy(+0.15));
    o.zoomOut?.addEventListener("click", () => this.zoomBy(-0.15));
    if (o.bgBtns) {
      for (const b of o.bgBtns.querySelectorAll("button")) {
        b.addEventListener("click", () => {
          for (const x of o.bgBtns!.querySelectorAll("button")) x.classList.remove("active");
          b.classList.add("active");
          this.core?.setBackground(this.currentBackground());
        });
      }
    }
    if (o.charBtns) {
      for (const c of CHARACTER_LIST) {
        const b = document.createElement("button");
        b.dataset["char"] = c.id;
        b.textContent = c.id === "haru" ? "Haru" : c.id === "demo" ? "小骨架" : "衣装酱";
        b.title = c.desc;
        b.addEventListener("click", () => {
          this.charId = c.id;
          void this.boot(c.id);
        });
        o.charBtns.appendChild(b);
      }
      if (loadCreated()) this.restoreCreatedFromStorage();
      if (loadImported()) this.restoreImportedFromStorage();
    }

    const draw = (now: number): void => {
      requestAnimationFrame(draw);
      if (!this.core) return;
      if (this.rendererKind === "software" && now - this.lastRenderAt < FRAME_INTERVAL_MS) return;
      this.lastRenderAt = now;
      this.core.onFrame(16);
      if (this.rendererKind === "software") {
        const img = this.softImage;
        const ctx = this.softCtx;
        if (img && ctx) {
          const px = this.core.sink.readPixels?.();
          if (px) {
            img.data.set(px);
            ctx.putImageData(img, 0, 0);
          }
        }
      }
      if (now >= this.bubbleHideAt && !this.core.isSpeaking()) {
        this.opts.bubble.hidden = true;
      }
    };
    requestAnimationFrame(draw);

    if (o.bgBtns) {
      const n = o.bgBtns.querySelector('[data-bg="night"]') as HTMLButtonElement | null;
      n?.classList.add("active");
    }
    void this.boot(this.charId, this.companionOn);
  }
}

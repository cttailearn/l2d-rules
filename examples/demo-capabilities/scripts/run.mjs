// demo-capabilities —— P6 driver + scene 能力演示
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  buildBehaviorIndex,
  driverToolCatalog,
  estimateSpeechTimeline,
  generateLibraryIndex,
  generateManifest,
  phonemeToViseme,
} from "@l2dp/driver";
import { L2DM_FORMAT_VERSION, L2dmPlayer, SceneStage, SoftwareRenderer } from "@l2dp/engine";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "out");
await mkdir(out, { recursive: true });

function model(id, color) {
  return {
    formatVersion: L2DM_FORMAT_VERSION,
    id,
    canvas: { width: 64, height: 64 },
    parameters: [{ id: "微笑", min: 0, max: 1, def: 0, group: "Custom" }],
    parts: [{
      id: "face", order: 1, color,
      mesh: { vertices: [12, 14, 52, 14, 52, 54, 12, 54], uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 1, 2, 0, 2, 3] },
    }],
  };
}

const red = model("red", [1, 0.25, 0.3, 1]);
const blue = model("blue", [0.25, 0.5, 1, 1]);
const manifest = generateManifest(red.parameters);
const library = generateLibraryIndex([{ name: "greet", group: "greeting" }], [{ name: "happy" }]);
const index = buildBehaviorIndex({ seed: 42, behaviors: [{ id: "greet", events: ["user_text"], kinds: ["greeting"], priority: 10, weight: 1, lines: ['{"op":"play","asset":"greet"}'], match: (e) => e.type === "user_text" && /hello|你好/i.test(e.text) }] });
const picked = index.pick({ type: "user_text", text: "你好" }, {});
const tools = driverToolCatalog();
const speech = estimateSpeechTimeline("Hello，你好！");

const stage = new SceneStage({ width: 180, height: 90 }, { background: [18, 22, 32, 255] });
stage.setChild({ id: "red", player: new L2dmPlayer(red, new Map()), x: 0, y: 10, z: 0 });
stage.setChild({ id: "blue", player: new L2dmPlayer(blue, new Map()), x: 90, y: 10, z: 1 });
const renderer = new SoftwareRenderer();
stage.render(renderer);
const pixels = renderer.readPixels();
await writeFile(join(out, "scene.png"), Buffer.from((await import("@l2dp/cutout")).encodePng(180, 90, pixels)));

const report = {
  manifestSems: manifest.sems.map((s) => s.name),
  library,
  firstHop: picked ? { id: picked.id, kinds: picked.kinds } : null,
  mcpTools: tools.map((t) => t.name),
  phonemes: ["iy", "ao", "sil"].map((p) => ({ p, viseme: phonemeToViseme(p) })),
  speech: { durationMs: speech.durationMs, visemeCount: speech.visemes?.length ?? 0, prosodyCount: speech.prosody?.length ?? 0 },
  scene: { width: 180, height: 90, nonTransparent: renderer.countNonTransparent(), sha256: createHash("sha256").update(pixels).digest("hex") },
};
await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));
console.log("[demo-capabilities] out/scene.png + out/report.json");

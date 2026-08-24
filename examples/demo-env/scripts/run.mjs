// demo-env（A2）：环境层专项演示——不喂任何 play，角色自己"一直活着"
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { L2dmPlayer, SoftwareRenderer } from "@l2dp/engine";
import { encodePng } from "@l2dp/cutout";
import { LayerStack, EnvironmentLayer, Evaluator } from "@l2dp/driver";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
await mkdir(OUT, { recursive: true });
const report = [];
const log = (s) => report.push(s);

// 简洁语义角色（组对齐环境层管辖：呼吸=Ambient/眨眼=EyeBlink/视线=Head/重心=Body）
const defs = [
  { id: "呼吸", min: 0, max: 1, def: 0.5, group: "Ambient" },
  { id: "眨眼", min: 0, max: 1, def: 0, group: "EyeBlink" },
  { id: "头转向", min: -30, max: 30, def: 0, group: "Head" },
  { id: "身转", min: -10, max: 10, def: 0, group: "Body" },
  { id: "微笑", min: 0, max: 1, def: 0, group: "Custom" },
];

async function sample(seed, emote, freqHz) {
  const stack = new LayerStack(defs);
  const env = new EnvironmentLayer(defs, { seed, freqHz });
  if (emote) env.setEmote(emote);
  const stats = { 呼吸: {min:Infinity,max:-Infinity,sum:0,n:0}, 眨眼: {min:Infinity,max:-Infinity,blinkHits:0}, 头转向: {min:Infinity,max:-Infinity,zero:0}, 身转: {min:Infinity,max:-Infinity,sum:0} };
  const ev = new Evaluator(stack, env, defs, {
    apply(_c, params) {
      for (const k of Object.keys(stats)) {
        const s = stats[k];
        const v = params[k] ?? 0;
        s.min = Math.min(s.min, v); s.max = Math.max(s.max, v);
        s.sum += v; s.n = (s.n ?? 0) + 1;
        if (k === "眨眼" && v > 0.25) s.blinkHits++;
        if (k === "头转向" && Math.abs(v) < 1e-6) s.zero++;
      }
    },
  });
  for (let i = 0; i < 750; i++) ev.onFrame(16); // 12s @16ms
  return stats;
}

const base = await sample(7, null, 0.25);
const calm = await sample(7, { valence: 0.7, arousal: 0.1 }, 0.25);
const excited = await sample(7, { valence: 0.6, arousal: 0.9 }, 0.25);
const sad = await sample(7, { valence: -0.8, arousal: 0.3 }, 0.25);

log("[1] 静默 12s 环境层（seed=7，无 emote）:");
log("  呼吸: min=" + base.呼吸.min.toFixed(3) + " max=" + base.呼吸.max.toFixed(3) + " avg=" + (base.呼吸.sum / base.呼吸.n).toFixed(3) + "（>0 恒动）");
log("  眨眼: max=" + base.眨眼.max.toFixed(3) + " 触发=" + base.眨眼.blinkHits + " 次（≥1）");
log("  视线: min=" + base.头转向.min.toFixed(2) + " max=" + base.头转向.max.toFixed(2) + " 静止帧=" + base.头转向.zero + "（微动非 0）");
log("  重心: min=" + base.身转.min.toFixed(3) + " max=" + base.身转.max.toFixed(3) + "（1/f 漂移）");

log("[2] emote 调制（同 seed，仅 emote 不同）:");
log("  兴奋(ar=0.9) 呼吸max=" + excited.呼吸.max.toFixed(3) + " vs 平静(ar=0.1) " + calm.呼吸.max.toFixed(3) + "（兴奋>平静=呼吸浅快幅度↑）");
log("  低落(val=-0.8) 呼吸min=" + sad.呼吸.min.toFixed(3) + " vs 平静 " + calm.呼吸.min.toFixed(3) + "（低落更低=深缓）");

// 渲染一帧（环境层叠加）
const canvas = { width: 240, height: 240 };
const model = {
  formatVersion: 1,
  id: "env-chan", canvas,
  parameters: defs.map((p) => ({ id: p.id, min: p.min, max: p.max, def: p.def, group: p.group })),
  parts: [
    { id: "torso", order: 0, color: [0.5, 0.6, 0.8, 1], mesh: { vertices: [60,60, 180,60, 180,200, 60,200], uvs: [0,0,1,0,1,1,0,1], indices: [0,1,2, 0,2,3] } },
    { id: "eye", order: 1, color: [0.1, 0.1, 0.1, 1], opacityParam: "眨眼", mesh: { vertices: [110,100, 130,100, 130,120, 110,120], uvs: [0,0,1,0,1,1,0,1], indices: [0,1,2, 0,2,3] } },
  ],
};
const sw = new SoftwareRenderer();
const player = new L2dmPlayer(model, new Map());
const stack2 = new LayerStack(defs);
const env2 = new EnvironmentLayer(defs, { seed: 42 });
const ev2 = new Evaluator(stack2, env2, defs, { apply(_c, params) { for (const [k, v] of Object.entries(params)) player.params.set(k, v); } });
for (let i = 0; i < 300; i++) ev2.onFrame(16);
player.render(sw);
const u8 = sw.readPixels();
await writeFile(join(OUT, "10-env-alive.png"), Buffer.from(encodePng(canvas.width, canvas.height, u8)));
log("[3] 环境层驱动渲染帧 out/10-env-alive.png；sha256=" + createHash("sha256").update(u8).digest("hex").slice(0, 16));

await writeFile(join(OUT, "report.txt"), report.join("\n") + "\n", "utf8");
console.log(report.join("\n"));
// 生成 rig 像素 golden fixture（确定性：同实现同哈希）
// 产物：packages/rig/test/fixtures/rig-golden.json
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sampleSpec } from "../test/sample.ts";
import { goldenRigFrames } from "../test/golden-frames.ts";
import { rigCharacter } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "test", "fixtures", "rig-golden.json");

const model = rigCharacter(sampleSpec()).model;
const frames = goldenRigFrames(model);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ canvas: [model.canvas.width, model.canvas.height], frames }, null, 1), "utf8");
console.log("golden written:", out, frames.length, "frames");

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = process.cwd();
const src = fs.readFileSync(path.join(root, "examples/live2d/live2d_3/js/live2dcubismcore.min.js"), "utf8");
vm.runInThisContext(src);
const L = globalThis.Live2DCubismCore;
const buf = new Uint8Array(fs.readFileSync(path.join(root, "examples/demo-real/assets-src/haru/Haru.moc3")));
const moc = L.Moc.fromArrayBuffer(buf.slice().buffer);
const m = L.Model.fromMoc(mocAlgorithmic);
const dt = m.drawables;
// 官方数据加载
const { readMoc3 } = require(root + "/packages/convert/test/DATA.js");

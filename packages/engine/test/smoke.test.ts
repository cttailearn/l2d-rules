import { test } from "node:test";
import assert from "node:assert/strict";
import { ENGINE_VERSION } from "../src/index.ts";

// M0 冒烟测试：确认包骨架可被 Node 原生加载（Nod 23.6+ 直跑 .ts）
test("engine 包骨架加载", () => {
  assert.equal(typeof ENGINE_VERSION, "string");
  assert.ok(ENGINE_VERSION.length > 0);
});

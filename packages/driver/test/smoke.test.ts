import { test } from "node:test";
import assert from "node:assert/strict";
import { DRIVER_VERSION } from "../src/index.ts";

// M0 冒烟测试：确认包骨架可被 Node 原生加载
test("driver 包骨架加载", () => {
  assert.equal(typeof DRIVER_VERSION, "string");
  assert.ok(DRIVER_VERSION.length > 0);
});

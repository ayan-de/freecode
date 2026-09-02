import { test } from "node:test";
import assert from "node:assert/strict";
import { SDK_FACTORIES } from "./sdk-factories.js";

test("has a factory for every SDK family the catalogue uses", () => {
  for (const family of [
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@ai-sdk/deepseek",
    "@ai-sdk/google",
  ] as const) {
    assert.equal(typeof SDK_FACTORIES[family], "function", family);
  }
});

test("anthropic factory builds a callable model provider", () => {
  const sdk = SDK_FACTORIES["@ai-sdk/anthropic"]({ apiKey: "test-key" });
  assert.equal(typeof sdk, "function");
});

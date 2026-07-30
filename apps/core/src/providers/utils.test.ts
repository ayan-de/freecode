import test from "node:test";
import assert from "node:assert/strict";
import { buildAnthropicSystemParam } from "./utils.js";

test("buildAnthropicSystemParam passes a string through unchanged", () => {
  assert.equal(buildAnthropicSystemParam("be helpful"), "be helpful");
});

// Regression: the AI SDK's standardizePrompt requires every array item to
// have role === "system"; a { type: "text", text } content-part shape throws
// AI_InvalidPromptError. See CHANGELOG 0.6.2.
test("buildAnthropicSystemParam produces role: system entries the AI SDK accepts", () => {
  const result = buildAnthropicSystemParam([
    { text: "rule one", cache: true },
    { text: "rule two" },
  ]);
  assert.ok(Array.isArray(result));
  for (const entry of result as Array<Record<string, unknown>>) {
    assert.equal(entry.role, "system");
    assert.equal(typeof entry.content, "string");
  }
});

test("buildAnthropicSystemParam only sets cacheControl providerOptions when block.cache is true", () => {
  const [cached, uncached] = buildAnthropicSystemParam([
    { text: "a", cache: true },
    { text: "b" },
  ]) as Array<{ providerOptions?: unknown }>;
  assert.ok(cached.providerOptions);
  assert.equal(uncached.providerOptions, undefined);
});

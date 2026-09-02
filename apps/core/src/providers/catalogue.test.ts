import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_CATALOGUE } from "./catalogue.js";

test("catalogue has exactly the six known metered providers, each with a unique id", () => {
  const ids = PROVIDER_CATALOGUE.map((e) => e.id);
  assert.deepEqual(
    [...ids].sort(),
    ["anthropic", "deepseek", "gemini", "minimax", "openai", "zai"],
  );
  assert.equal(new Set(ids).size, ids.length);
});

test("every entry has a non-empty defaultModel and a supported npm family", () => {
  const known = new Set([
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@ai-sdk/deepseek",
    "@ai-sdk/google",
  ]);
  for (const entry of PROVIDER_CATALOGUE) {
    assert.ok(entry.defaultModel.length > 0, `${entry.id} has a defaultModel`);
    assert.ok(known.has(entry.npm), `${entry.id} has a known npm family`);
  }
});

test("only minimax and zai carry a custom baseURL", () => {
  const withBaseUrl = PROVIDER_CATALOGUE.filter((e) => e.baseURL).map((e) => e.id);
  assert.deepEqual(withBaseUrl.sort(), ["minimax", "zai"]);
});

test("effortFamily is set only for anthropic, openai, and gemini", () => {
  const withEffort = PROVIDER_CATALOGUE.filter((e) => e.effortFamily).map((e) => e.id);
  assert.deepEqual(withEffort.sort(), ["anthropic", "gemini", "openai"]);
});

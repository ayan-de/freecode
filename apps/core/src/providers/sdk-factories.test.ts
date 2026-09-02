import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadSdkFactory,
  hasSdkFactory,
  supportedSdkFamilies,
} from "./sdk-factories.js";

test("covers the SDK families the catalogue actually needs", async () => {
  for (const family of [
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@ai-sdk/openai-compatible",
    "@ai-sdk/google",
    "@ai-sdk/deepseek",
  ]) {
    assert.ok(hasSdkFactory(family), family);
  }
});

test("every advertised family actually imports", async () => {
  // The failure this guards: a package renamed or removed from package.json
  // leaves an entry that only throws on the first real request, for whichever
  // provider happens to use it.
  for (const family of supportedSdkFamilies()) {
    const factory = await loadSdkFactory(family);
    assert.equal(typeof factory, "function", family);
  }
});

test("an unknown package rejects rather than returning undefined", async () => {
  await assert.rejects(
    () => loadSdkFactory("@ai-sdk/not-installed"),
    /No bundled SDK/,
  );
});

test("a family is imported once and memoized", async () => {
  const first = loadSdkFactory("@ai-sdk/anthropic");
  const second = loadSdkFactory("@ai-sdk/anthropic");
  assert.equal(first, second, "expected the same in-flight promise");
});

test("anthropic factory builds a callable model provider", async () => {
  const factory = await loadSdkFactory("@ai-sdk/anthropic");
  assert.equal(typeof factory({ apiKey: "test-key" }), "function");
});

test("openai-compatible builds with the name it requires", async () => {
  const factory = await loadSdkFactory("@ai-sdk/openai-compatible");
  const sdk = factory({
    apiKey: "test-key",
    baseURL: "https://example.invalid/v1",
    name: "someprovider",
  });
  assert.equal(typeof sdk, "function");
});

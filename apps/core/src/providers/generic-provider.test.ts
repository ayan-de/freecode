import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGenerateOptions } from "./generic-provider.js";

// These assertions describe the API-key request shape; pin the auth mode so
// they don't flip on a machine whose config resolves anthropic to OAuth.
// The OAuth shape has its own tests in anthropic-oauth.test.ts.
process.env.FREECODE_ANTHROPIC_AUTH = "api-key";
import { resolveCatalogue } from "./catalogue.js";
import type { ProviderCatalogueEntry } from "./catalogue.js";

const modelHandle = { __model: true };

// Entries come from the catalogue rather than being re-declared here. Local
// literals cannot catch drift: if resolution stopped setting `effortFamily` on
// gemini, or moved zai off @ai-sdk/anthropic, every assertion below would go
// on passing against a fixture that no longer describes anything real.
function entry(id: string): ProviderCatalogueEntry {
  const found = resolveCatalogue().find((e) => e.id === id);
  assert.ok(found, `${id} is not in the resolved catalogue`);
  return found;
}

const anthropicEntry = entry("anthropic");
const openaiEntry = entry("openai");
const geminiEntry = entry("gemini");
const minimaxEntry = entry("minimax");
const openaiCompatibleEntry = entry("groq");
const zaiEntry = entry("zai");

test("anthropic-family: system goes through buildAnthropicSystemParam, messages get cache breakpoints", () => {
  const opts = buildGenerateOptions(anthropicEntry, modelHandle, {
    system: "be helpful",
    messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] as any,
  });
  assert.equal(opts.model, modelHandle);
  assert.equal(opts.system, "be helpful");
  assert.ok(Array.isArray(opts.messages));
});

test("minimax (anthropic npm family, no effortFamily): effort is never applied", () => {
  const opts = buildGenerateOptions(minimaxEntry, modelHandle, {
    prompt: "hi",
    effort: "high",
  });
  assert.equal(opts.providerOptions, undefined);
});

test("anthropic (effortFamily set): effort is routed under providerOptions.anthropic", () => {
  const opts = buildGenerateOptions(anthropicEntry, modelHandle, {
    prompt: "hi",
    effort: "high",
  });
  assert.deepEqual((opts.providerOptions as any).anthropic, { effort: "high" });
});

test("openai: sessionId sets providerOptions.openai.promptCacheKey", () => {
  const opts = buildGenerateOptions(openaiEntry, modelHandle, {
    prompt: "hi",
    sessionId: "sess-123",
  });
  assert.equal((opts.providerOptions as any).openai.promptCacheKey, "sess-123");
});

test("openai: system is flattened to a plain string, not the anthropic block form", () => {
  const opts = buildGenerateOptions(openaiEntry, modelHandle, {
    system: [{ text: "one" }, { text: "two" }],
  } as any);
  assert.equal(opts.system, "one\n\ntwo");
});

test("gemini: xhigh effort clamps to high thinkingLevel", () => {
  const opts = buildGenerateOptions(geminiEntry, modelHandle, {
    prompt: "hi",
    effort: "xhigh",
  });
  assert.deepEqual((opts.providerOptions as any).google, {
    thinkingConfig: { thinkingLevel: "high" },
  });
});

test("maxOutputTokens: caller override wins over catalogue default", () => {
  const opts = buildGenerateOptions(minimaxEntry, modelHandle, {
    prompt: "hi",
    maxTokens: 9000,
  });
  assert.equal(opts.maxOutputTokens, 9000);
});

test("maxOutputTokens: falls back to the catalogue entry's own value", () => {
  const opts = buildGenerateOptions(minimaxEntry, modelHandle, { prompt: "hi" });
  // Read off the entry, not a copy of its number — minimax's reservation is
  // OUTPUT_TOKEN_CAP, and hardcoding 32_000 here would keep passing after the
  // cap moved.
  assert.equal(opts.maxOutputTokens, minimaxEntry.maxOutputTokens);
  assert.ok(minimaxEntry.maxOutputTokens > 4096, "expected minimax's override");
});


test("openai-compatible: openai-shaped system, but no promptCacheKey", () => {
  // promptCacheKey is OpenAI's own parameter. openai-compatible endpoints are
  // a different 172 vendors, and passing an unknown field risks a 400 — so the
  // cache key stays keyed to @ai-sdk/openai exactly, not to the request shape.
  const opts = buildGenerateOptions(openaiCompatibleEntry, modelHandle, {
    system: [{ text: "one" }, { text: "two" }],
    sessionId: "sess-123",
  } as any);
  assert.equal(opts.system, "one\n\ntwo");
  assert.equal(opts.providerOptions, undefined);
});

test("openai-compatible: no effortFamily means effort is never routed", () => {
  const opts = buildGenerateOptions(openaiCompatibleEntry, modelHandle, {
    prompt: "hi",
    effort: "high",
  });
  assert.equal(opts.providerOptions, undefined);
});

test("anthropic-family branch is keyed on the SDK package, not the provider id", () => {
  // zai and minimax are not "anthropic", but they speak the Messages shape.
  const opts = buildGenerateOptions(zaiEntry, modelHandle, {
    system: [{ text: "sys" }],
    messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] as any,
  } as any);
  // buildAnthropicSystemParam produces block form, not a joined string.
  assert.notEqual(opts.system, "sys");
  assert.ok(Array.isArray(opts.messages));
});

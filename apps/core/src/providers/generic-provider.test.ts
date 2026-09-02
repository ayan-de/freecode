import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGenerateOptions } from "./generic-provider.js";
import type { ProviderCatalogueEntry } from "./catalogue.js";

const modelHandle = { __model: true };

const anthropicEntry: ProviderCatalogueEntry = {
  id: "anthropic",
  name: "Anthropic",
  npm: "@ai-sdk/anthropic",
  defaultModel: "claude-sonnet-4-5",
  maxOutputTokens: 4096,
  effortFamily: "anthropic",
};

const openaiEntry: ProviderCatalogueEntry = {
  id: "openai",
  name: "OpenAI",
  npm: "@ai-sdk/openai",
  defaultModel: "gpt-4o",
  maxOutputTokens: 4096,
  effortFamily: "openai",
};

const geminiEntry: ProviderCatalogueEntry = {
  id: "gemini",
  name: "Google Gemini",
  npm: "@ai-sdk/google",
  defaultModel: "gemini-3.6-flash",
  maxOutputTokens: 4096,
  effortFamily: "gemini",
};

const minimaxEntry: ProviderCatalogueEntry = {
  id: "minimax",
  name: "MiniMax",
  npm: "@ai-sdk/anthropic",
  baseURL: "https://api.minimax.io/anthropic/v1",
  defaultModel: "MiniMax-M2",
  maxOutputTokens: 32_000,
};

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

test("maxOutputTokens: falls back to the catalogue entry's value", () => {
  const opts = buildGenerateOptions(minimaxEntry, modelHandle, { prompt: "hi" });
  assert.equal(opts.maxOutputTokens, 32_000);
});

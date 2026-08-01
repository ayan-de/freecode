import assert from "node:assert/strict";
import test from "node:test";
import { modelSupportsImages } from "./models-dev.js";

// These read the models.dev cache/network. They assert the *shape* of the
// decision, not a hardcoded provider list — the bug this replaced was a
// hardcoded allowlist that silently dropped images for every other provider.

test("modelSupportsImages: true for a model whose modalities include image", async () => {
  assert.equal(
    await modelSupportsImages("anthropic", "claude-sonnet-4-6"),
    true,
  );
});

test("modelSupportsImages: false for a text-only model", async () => {
  // MiniMax reports modalities.input = ["text"].
  assert.equal(await modelSupportsImages("minimax", "MiniMax-M2"), false);
});

test("modelSupportsImages: matches model ids case-insensitively", async () => {
  assert.equal(
    await modelSupportsImages("anthropic", "CLAUDE-SONNET-4-6"),
    true,
  );
});

test("modelSupportsImages: fails closed for unknown models and providers", async () => {
  assert.equal(await modelSupportsImages("anthropic", "no-such-model"), false);
  assert.equal(await modelSupportsImages("no-such-provider", "x"), false);
  assert.equal(await modelSupportsImages("anthropic", undefined), false);
});

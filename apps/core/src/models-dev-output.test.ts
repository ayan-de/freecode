import assert from "node:assert/strict";
import test from "node:test";
import { getModelOutputLimit, resolveMaxOutputTokens } from "./models-dev.js";
import { OUTPUT_TOKEN_CAP } from "./providers/utils.js";

// The reservation is charged against the context window, so it is subtracted
// from what the conversation may occupy AND validated by the API. These assert
// the invariants that hold whether or not models.dev is reachable — a network
// failure falls back to the cap, which still satisfies every case below.

test("resolveMaxOutputTokens never exceeds the cap", async () => {
  for (const [provider, model] of [
    ["minimax", "MiniMax-M2"],
    ["anthropic", "claude-sonnet-4-5"],
    ["openai", "gpt-4o"],
  ] as const) {
    const reserved = await resolveMaxOutputTokens(provider, model);
    assert.ok(
      reserved > 0 && reserved <= OUTPUT_TOKEN_CAP,
      `${provider}/${model} reserved ${reserved}`,
    );
  }
});

test("resolveMaxOutputTokens prefers the model's own ceiling when it is lower", async () => {
  // gpt-4o caps output at 16384, well under OUTPUT_TOKEN_CAP. Skip the
  // assertion when models.dev is unreachable rather than fail on the network.
  const limit = await getModelOutputLimit("openai", "gpt-4o").catch(() => 0);
  if (limit > 0 && limit < OUTPUT_TOKEN_CAP) {
    assert.equal(await resolveMaxOutputTokens("openai", "gpt-4o"), limit);
  }
});

test("resolveMaxOutputTokens falls back to the cap, never to zero", async () => {
  // Reserving nothing would let a request be built with no room for a reply.
  assert.equal(
    await resolveMaxOutputTokens("minimax", undefined),
    OUTPUT_TOKEN_CAP,
  );
  assert.equal(
    await resolveMaxOutputTokens("no-such-provider", "no-such-model"),
    OUTPUT_TOKEN_CAP,
  );
});

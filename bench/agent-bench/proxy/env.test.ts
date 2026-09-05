import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_UPSTREAM, meterEnv, upstreamFor } from "./env.js";

test("Claude gets the origin, freecode gets the origin plus /v1", () => {
  assert.deepEqual(meterEnv("http://127.0.0.1:9"), {
    ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
    MINIMAX_BASE_URL: "http://127.0.0.1:9/v1",
  });
});

test("upstream is the adapter's Anthropic URL when it is a literal", () => {
  assert.equal(
    upstreamFor({ env: { ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic" } }),
    "https://api.minimax.io/anthropic",
  );
  assert.equal(upstreamFor({ env: { ANTHROPIC_BASE_URL: "${MINIMAX_API_KEY}" } }), DEFAULT_UPSTREAM);
  assert.equal(upstreamFor({}), DEFAULT_UPSTREAM);
});

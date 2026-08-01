import test from "node:test";
import assert from "node:assert/strict";
import { isContextOverflowError } from "./manager.js";

// Shaped like an AI SDK APICallError: a 400 whose only distinguishing signal
// is the message text.
function apiError(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

test("detects context overflow across provider wordings", () => {
  const real = [
    // MiniMax — the rejection that motivated this path.
    "invalid params, context window exceeds limit (2013)",
    // Anthropic
    "prompt is too long: 210000 tokens > 200000 maximum",
    // OpenAI
    "This model's maximum context length is 128000 tokens",
    "context_length_exceeded",
    // Gemini
    "The input token count exceeds the maximum number of tokens allowed",
  ];
  for (const message of real) {
    assert.equal(
      isContextOverflowError(apiError(message)),
      true,
      `should detect: ${message}`,
    );
  }
});

test("ignores unrelated failures", () => {
  // A false positive triggers a compaction, which discards message detail —
  // so anything that is not an overflow must not match.
  const other = [
    apiError("invalid params, tool_use.input must be an object"),
    apiError("model not found"),
    apiError("rate limit exceeded", 429),
    apiError("internal server error", 500),
    apiError("overloaded", 529),
    new Error("fetch failed"),
    Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
  ];
  for (const error of other) {
    assert.equal(
      isContextOverflowError(error),
      false,
      `should ignore: ${(error as Error).message}`,
    );
  }
});

test("does not treat a server-side failure as overflow", () => {
  // Same wording, 5xx status: a server fault, not an oversized prompt.
  assert.equal(isContextOverflowError(apiError("context length", 503)), false);
});

test("handles null and non-error values", () => {
  assert.equal(isContextOverflowError(null), false);
  assert.equal(isContextOverflowError(undefined), false);
  assert.equal(isContextOverflowError("context length"), true);
});

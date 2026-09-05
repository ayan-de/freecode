import test from "node:test";
import assert from "node:assert/strict";
import { parseUsage, usageFromSse } from "./usage.js";

test("Anthropic wire is exclusive; Usage.inputTokens comes back inclusive", () => {
  // Real Anthropic convention: input_tokens does NOT include the cache
  // fields. 15 fresh + 80 read + 5 written = 100 inclusive.
  assert.deepEqual(
    parseUsage({
      usage: {
        input_tokens: 15,
        output_tokens: 20,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 5,
      },
    }),
    {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 5,
    },
  );
});

test("Anthropic with no cache fields: input passes through untouched", () => {
  assert.deepEqual(
    parseUsage({ usage: { input_tokens: 40, output_tokens: 3 } }),
    { inputTokens: 40, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
});

test("reads OpenAI Chat Completions usage, cached_tokens as cache reads", () => {
  assert.deepEqual(
    parseUsage({
      usage: {
        prompt_tokens: 50,
        completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 40 },
      },
    }),
    {
      inputTokens: 50,
      outputTokens: 10,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
    },
  );
});

test("ignores a body with no usage", () => {
  assert.equal(parseUsage({ id: "msg_1", content: [] }), undefined);
});

test("SSE: message_delta only has output_tokens; input and cache stay from message_start", () => {
  const sse = [
    "event: message_start",
    'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":4}}}',
    "",
    "event: message_delta",
    'data: {"type":"message_delta","usage":{"output_tokens":7}}',
    "",
  ].join("\n");
  // 10 fresh + 4 cache-read = 14 inclusive; the delta overlays only output.
  assert.deepEqual(usageFromSse(sse), {
    inputTokens: 14,
    outputTokens: 7,
    cacheReadTokens: 4,
    cacheWriteTokens: 0,
  });
});

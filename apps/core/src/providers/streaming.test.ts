import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAiSdkStream } from "./streaming.js";

async function* fakeStream(chunks: Array<{ type: string } & Record<string, unknown>>) {
  for (const c of chunks) yield c;
}

async function collect(gen: AsyncGenerator<unknown>) {
  const out: unknown[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

// Regression: the AI SDK's fullStream "finish" part carries `totalUsage`,
// not `usage` (that field only exists on the per-step "finish-step" part).
// Reading chunk.usage on "finish" was always undefined, so the streaming
// path never emitted a usage chunk and the TUI showed 0 tokens on completion
// even though text streamed live correctly.
test("normalizeAiSdkStream emits usage from the finish part's totalUsage", async () => {
  const chunks = await collect(
    normalizeAiSdkStream(
      fakeStream([
        { type: "text-delta", text: "hi" },
        {
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 42, outputTokens: 7 },
        },
      ]),
    ),
  );
  const usage = chunks.find(
    (c): c is { type: "usage"; usage: { inputTokens: number; outputTokens: number } } =>
      (c as { type: string }).type === "usage",
  );
  assert.ok(usage, "expected a usage chunk");
  assert.equal(usage.usage.inputTokens, 42);
  assert.equal(usage.usage.outputTokens, 7);
});

test("normalizeAiSdkStream still completes with a done chunk when usage is absent", async () => {
  const chunks = await collect(
    normalizeAiSdkStream(
      fakeStream([{ type: "finish", finishReason: "stop" }]),
    ),
  );
  assert.ok(chunks.some((c) => (c as { type: string }).type === "done"));
});

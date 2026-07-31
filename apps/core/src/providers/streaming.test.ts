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

// Regression: a tool call truncated by the output-token cap comes back from
// the AI SDK as a tool-call part whose `input` is the raw (unparseable) JSON
// string rather than an object. Passing it through stored a string in history
// that every later request re-sent as tool_use.input, which providers reject
// with "Input should be a valid dictionary" — permanently bricking the session.
test("normalizeAiSdkStream rejects a tool call whose input is not an object", async () => {
  const chunks = await collect(
    normalizeAiSdkStream(
      fakeStream([
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "write",
          input: '{"filePath": "/tmp/a.md", "content": "# truncated',
          invalid: true,
        },
        { type: "finish", finishReason: "tool-calls" },
      ]),
    ),
  );
  assert.ok(
    !chunks.some((c) => (c as { type: string }).type === "tool_call"),
    "malformed tool call must not reach the agent loop",
  );
  const err = chunks.find(
    (c): c is { type: "error"; error: string } =>
      (c as { type: string }).type === "error",
  );
  assert.ok(err, "expected an error chunk");
  assert.match(err.error, /write/);
});

test("normalizeAiSdkStream passes through a well-formed tool call", async () => {
  const chunks = await collect(
    normalizeAiSdkStream(
      fakeStream([
        {
          type: "tool-call",
          toolCallId: "call-2",
          toolName: "read",
          input: { filePath: "/tmp/a.md" },
        },
        { type: "finish", finishReason: "tool-calls" },
      ]),
    ),
  );
  const call = chunks.find(
    (c): c is { type: "tool_call"; id: string; name: string; args: Record<string, unknown> } =>
      (c as { type: string }).type === "tool_call",
  );
  assert.ok(call, "expected a tool_call chunk");
  assert.equal(call.name, "read");
  assert.deepEqual(call.args, { filePath: "/tmp/a.md" });
});

test("normalizeAiSdkStream still completes with a done chunk when usage is absent", async () => {
  const chunks = await collect(
    normalizeAiSdkStream(
      fakeStream([{ type: "finish", finishReason: "stop" }]),
    ),
  );
  assert.ok(chunks.some((c) => (c as { type: string }).type === "done"));
});

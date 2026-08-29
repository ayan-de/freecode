import test from "node:test";
import assert from "node:assert/strict";
import { traceToOtlp } from "./otlp.js";
import type { ModelSpan, Trace } from "./trace.js";

interface Span {
  name: string;
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
}

function spansOf(trace: Trace): Span[] {
  const doc = traceToOtlp(trace) as {
    resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }>;
  };
  return doc.resourceSpans[0].scopeSpans[0].spans;
}

const attr = (span: Span, key: string) =>
  span.attributes.find((a) => a.key === key)?.value;

const modelSpan = (over: Partial<ModelSpan> = {}): ModelSpan => ({
  turnId: "turn-0",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  startedAt: 1000,
  status: "ok",
  duration_ms: 500,
  messageCount: 2,
  toolCount: 5,
  promptChars: 100,
  toolCalls: [],
  ...over,
});

const trace = (over: Partial<Trace> = {}): Trace => ({
  sessionId: "session-abc",
  startedAt: 1000,
  endedAt: 2000,
  wall_ms: 1000,
  modelSpans: [],
  toolSpans: [],
  deniedSpans: [],
  model_ms: 500,
  tool_ms: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  hung: false,
  inFlight: false,
  redirects: 0,
  redirectsSkipped: 0,
  ...over,
});

test("the root span is an invoke_agent span", () => {
  // What makes a multi-turn session render as one agent run rather than N
  // unrelated chats (spec §12.3).
  const [root] = spansOf(trace());
  assert.match(root.name, /^invoke_agent/);
  assert.deepEqual(attr(root, "gen_ai.operation.name"), {
    stringValue: "invoke_agent",
  });
});

test("every span carries the conversation id", () => {
  const spans = spansOf(trace({ modelSpans: [modelSpan()] }));
  const chat = spans.find((s) => s.name.startsWith("chat"))!;
  assert.deepEqual(attr(spans[0], "gen_ai.conversation.id"), {
    stringValue: "session-abc",
  });
  assert.deepEqual(attr(chat, "gen_ai.conversation.id"), {
    stringValue: "session-abc",
  });
});

test("cost is a double, not a rounded integer", () => {
  // Every real call costs fractions of a cent; the integer formatter every
  // other numeric attribute uses would report all of them as $0.
  const spans = spansOf(
    trace({
      modelSpans: [modelSpan({ inputTokens: 1_000_000, outputTokens: 0 })],
    }),
  );
  const chat = spans.find((s) => s.name.startsWith("chat"))!;
  assert.deepEqual(attr(chat, "gen_ai.usage.cost"), { doubleValue: 3 });
});

test("an unpriced model emits no cost attribute at all", () => {
  // A collector cannot tell a real zero from a missing price, so it must not
  // be shown one.
  const spans = spansOf(
    trace({
      modelSpans: [
        modelSpan({ provider: "minimax", model: "MiniMax-M3", inputTokens: 10 }),
      ],
    }),
  );
  const chat = spans.find((s) => s.name.startsWith("chat"))!;
  assert.equal(attr(chat, "gen_ai.usage.cost"), undefined);
  assert.equal(attr(spans[0], "gen_ai.usage.cost"), undefined);
});

test("a mixed-provider session reports a partial cost, and says so", () => {
  const spans = spansOf(
    trace({
      modelSpans: [
        modelSpan({ inputTokens: 1_000_000 }),
        modelSpan({ provider: "minimax", model: "MiniMax-M3", inputTokens: 10 }),
      ],
    }),
  );
  assert.deepEqual(attr(spans[0], "gen_ai.usage.cost"), { doubleValue: 3 });
  assert.deepEqual(attr(spans[0], "freecode.cost_partial"), { boolValue: true });
});

test("cache write tokens reach the export", () => {
  // The fold dropped these until pricing needed them; a regression here silently
  // understates every cached session.
  const spans = spansOf(
    trace({ modelSpans: [modelSpan({ cacheWriteTokens: 4096 })] }),
  );
  const chat = spans.find((s) => s.name.startsWith("chat"))!;
  assert.deepEqual(attr(chat, "gen_ai.usage.cache_creation_input_tokens"), {
    intValue: "4096",
  });
});

test("a refused call is exported as an errored span, not omitted", () => {
  const spans = spansOf(
    trace({
      deniedSpans: [
        {
          tool: "edit",
          at: 1500,
          args: { filePath: "match.ts" },
          source: "mode",
          reason: 'Tool "edit" is not allowed in review mode (read-only)',
        },
      ],
    }),
  );
  const denied = spans.find((s) => s.name === "execute_tool edit");
  assert.ok(denied, "the denial reaches the collector");
  assert.equal(attr(denied, "freecode.denied")?.boolValue, true);
  assert.equal(attr(denied, "freecode.deny_source")?.stringValue, "mode");
  const status = (denied as unknown as { status: { code: number } }).status;
  assert.equal(status.code, 2, "STATUS_ERROR — nothing was done");
});

test("denied spans do not collide with tool span ids", () => {
  const spans = spansOf(
    trace({
      toolSpans: [{ tool: "read", callSeq: 1, startedAt: 1100, duration_ms: 10 }],
      deniedSpans: [{ tool: "edit", at: 1500, source: "mode", reason: "no" }],
    }),
  ) as unknown as Array<{ spanId: string }>;
  const ids = spans.map((s) => s.spanId);
  assert.equal(new Set(ids).size, ids.length, "every span id is distinct");
});

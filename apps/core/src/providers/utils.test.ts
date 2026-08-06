import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnthropicSystemParam,
  buildToolsParam,
  resolveModel,
  applyMessageCaching,
  getCacheTtl,
} from "./utils.js";
import { PromptCompiler } from "../context/compiler.js";

test("buildAnthropicSystemParam passes a string through unchanged", () => {
  assert.equal(buildAnthropicSystemParam("be helpful"), "be helpful");
});

// Regression: the AI SDK's standardizePrompt requires every array item to
// have role === "system"; a { type: "text", text } content-part shape throws
// AI_InvalidPromptError. See CHANGELOG 0.6.2.
test("buildAnthropicSystemParam produces role: system entries the AI SDK accepts", () => {
  const result = buildAnthropicSystemParam([
    { text: "rule one", cache: true },
    { text: "rule two" },
  ]);
  assert.ok(Array.isArray(result));
  for (const entry of result as Array<Record<string, unknown>>) {
    assert.equal(entry.role, "system");
    assert.equal(typeof entry.content, "string");
  }
});

test("buildAnthropicSystemParam only sets cacheControl providerOptions when block.cache is true", () => {
  const [cached, uncached] = buildAnthropicSystemParam([
    { text: "a", cache: true },
    { text: "b" },
  ]) as Array<{ providerOptions?: unknown }>;
  assert.ok(cached.providerOptions);
  assert.equal(uncached.providerOptions, undefined);
});

test("buildToolsParam returns undefined for no tools", () => {
  assert.equal(buildToolsParam(undefined), undefined);
  assert.equal(buildToolsParam([]), undefined);
});

// Regression: raw JSON Schema objects passed unwrapped as inputSchema hit the
// AI SDK's asSchema() ambiguous-shape detection — it checks for a "~standard"
// marker and otherwise calls the object as a function (schema()), throwing
// "H is not a function" or misrouting into Zod's own toJSONSchema internals.
// jsonSchema() tags the object so asSchema() short-circuits via isSchema().
test("buildToolsParam wraps inputSchema so it is not a bare plain object", () => {
  const tools = buildToolsParam([
    {
      name: "read",
      description: "read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  ]);
  assert.ok(tools);
  const inputSchema = tools!.read.inputSchema as Record<string, unknown>;
  // A raw JSON Schema object would just be { type: "object", properties: {...} }
  // with no marker; the wrapped Schema instance exposes jsonSchema/validate.
  assert.notEqual(typeof inputSchema, "function");
  assert.ok("jsonSchema" in inputSchema || "validate" in inputSchema);
});

test("resolveModel returns the requested model unchanged", () => {
  assert.equal(
    resolveModel("MiniMax-M3", "minimax", "MiniMax-M2"),
    "MiniMax-M3",
  );
});

test("resolveModel falls back to the provider default when none is requested", () => {
  assert.equal(resolveModel(undefined, "minimax", "MiniMax-M2"), "MiniMax-M2");
  // Empty string is "no model" too — it must not reach the provider as-is.
  assert.equal(resolveModel("", "minimax", "MiniMax-M2"), "MiniMax-M2");
});

// The bug this pins: marking only the final message means every breakpoint
// describes a prefix ending in content the model has never seen, so the
// request can only ever WRITE a cache entry, never read one. A MiniMax-M3
// session showed 6.4% hits -- the system blocks (stable breakpoints) and not a
// single conversation message, at 86K input. The second-to-last message is the
// read anchor: it was the final message last turn, so an entry exists there.
const marked = (m: any) =>
  m.content[m.content.length - 1].providerOptions !== undefined;

// The load-bearing case, and the one a plain .slice(-2) gets wrong: a turn
// that used tools expands into TWO wire messages, so the last two are both new
// and the read anchor would never match a stored prefix.
test("applyMessageCaching anchors on where the previous request ended", () => {
  const msgs: any[] = [
    { role: "system", content: "sys" },
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "1" }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "1" }] },
    // ^ the previous request ended here
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "2" }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "2" }] },
  ];
  applyMessageCaching(msgs as never);

  assert.equal(marked(msgs[5]), true, "write anchor: the tail");
  assert.equal(
    marked(msgs[3]),
    true,
    "read anchor: the previous request's final message",
  );
  assert.equal(
    marked(msgs[4]),
    false,
    "the new assistant message is not a hit",
  );
  assert.equal(marked(msgs[1]), false, "older messages stay unmarked");
  assert.equal(
    (msgs[0] as any).providerOptions,
    undefined,
    "system blocks carry their own breakpoints and must not be double-marked",
  );
});

test("applyMessageCaching handles a text-only turn (one wire message)", () => {
  const msgs: any[] = [
    { role: "user", content: [{ type: "text", text: "one" }] },
    { role: "assistant", content: [{ type: "text", text: "two" }] },
    { role: "user", content: [{ type: "text", text: "three" }] },
    { role: "assistant", content: [{ type: "text", text: "four" }] },
  ];
  applyMessageCaching(msgs as never);
  assert.equal(marked(msgs[3]), true, "write anchor");
  assert.equal(marked(msgs[2]), true, "read anchor: previous request's end");
  assert.equal(marked(msgs[1]), false);
});

test("applyMessageCaching marks only the tail on the first request", () => {
  // Nothing has been cached yet, so there is no read anchor to place.
  const msgs: any[] = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ];
  applyMessageCaching(msgs as never);
  assert.equal(marked(msgs[0]), true);
});

test("applyMessageCaching sets every provider flavor's key", () => {
  const msgs: any[] = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ];
  applyMessageCaching(msgs as never);
  const opts = msgs[0].content[0].providerOptions;
  // Anthropic-shaped endpoints read `anthropic`; a gateway reads its own key.
  assert.ok(opts.anthropic.cacheControl);
  assert.ok(opts.openrouter.cacheControl);
  assert.ok(opts.openaiCompatible.cache_control);
  assert.ok(opts.bedrock.cachePoint);
});

test("applyMessageCaching promotes string content so a marker can attach", () => {
  const msgs: any[] = [{ role: "user", content: "plain string" }];
  applyMessageCaching(msgs as never);
  assert.ok(Array.isArray(msgs[0].content));
  assert.equal(msgs[0].content[0].text, "plain string");
  assert.ok(msgs[0].content[0].providerOptions.anthropic);
});

test("applyMessageCaching preserves existing providerOptions on the part", () => {
  const msgs: any[] = [
    {
      role: "user",
      content: [{ type: "text", text: "hi", providerOptions: { foo: 1 } }],
    },
  ];
  applyMessageCaching(msgs as never);
  const opts = msgs[0].content[0].providerOptions;
  assert.equal(opts.foo, 1, "must merge, not clobber");
  assert.ok(opts.anthropic);
});

// Providers cap cache breakpoints at 4 and the AI SDK drops the excess with a
// warning ("Maximum 4 cache breakpoints exceeded (found 5). This breakpoint
// will be ignored"), so going over silently loses a breakpoint rather than
// failing. Adding the second message anchor did exactly that until the dynamic
// system block gave up its slot. This counts the whole request budget.
test("the whole request stays within the 4 cache-breakpoint limit", async () => {
  const tools = buildToolsParam([
    { name: "a", description: "", parameters: { type: "object" } },
    { name: "b", description: "", parameters: { type: "object" } },
  ] as never);
  const toolBreakpoints = Object.values(tools ?? {}).filter(
    (t: any) => t.providerOptions !== undefined,
  ).length;

  // Deliberately the REAL compiler output, not a hand-built stand-in. The
  // budget has exactly one variable in it — how many system blocks carry
  // `cache: true` — and a literal array here would keep passing while
  // compiler.ts grew a second cached block and pushed the live request to 5.
  // Wiring it to the source of that number is what makes this test load-bearing
  // rather than a restatement of its own inputs.
  const compiler = new PromptCompiler("/path/to/project", "my-project", "build");
  const system = buildAnthropicSystemParam(
    await compiler.compileSystemBlocks("anthropic", "claude-sonnet-4-5"),
  );
  const systemBreakpoints = (system as any[]).filter(
    (b) => b.providerOptions !== undefined,
  ).length;

  const msgs: any[] = [
    { role: "user", content: [{ type: "text", text: "1" }] },
    { role: "assistant", content: [{ type: "text", text: "2" }] },
    { role: "user", content: [{ type: "text", text: "3" }] },
  ];
  applyMessageCaching(msgs as never);
  const messageBreakpoints = msgs.filter(
    (m) => m.content[m.content.length - 1].providerOptions !== undefined,
  ).length;

  assert.equal(toolBreakpoints, 1, "tools array is marked once, on the last");
  assert.equal(systemBreakpoints, 1, "only the static block earns a slot");
  assert.equal(messageBreakpoints, 2, "read anchor + write anchor");
  assert.ok(
    toolBreakpoints + systemBreakpoints + messageBreakpoints <= 4,
    "total request breakpoints must not exceed the provider limit of 4",
  );
});

// --- Cache TTL (FREECODE_CACHE_TTL) ------------------------------------------

/** Runs `fn` with FREECODE_CACHE_TTL set to `value` (or unset), then restores. */
function withCacheTtl(value: string | undefined, fn: () => void): void {
  const prev = process.env.FREECODE_CACHE_TTL;
  if (value === undefined) delete process.env.FREECODE_CACHE_TTL;
  else process.env.FREECODE_CACHE_TTL = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.FREECODE_CACHE_TTL;
    else process.env.FREECODE_CACHE_TTL = prev;
  }
}

test("getCacheTtl defaults to 5m and rejects unusable values", () => {
  withCacheTtl(undefined, () => assert.equal(getCacheTtl(), "5m"));
  withCacheTtl("", () => assert.equal(getCacheTtl(), "5m"));
  withCacheTtl("1h", () => assert.equal(getCacheTtl(), "1h"));
  withCacheTtl("5m", () => assert.equal(getCacheTtl(), "5m"));
  // An unusable value must not reach the wire as a literal.
  withCacheTtl("60m", () => assert.equal(getCacheTtl(), "5m"));
  withCacheTtl("1hour", () => assert.equal(getCacheTtl(), "5m"));
});

test("the default path sends no ttl field at all", () => {
  withCacheTtl(undefined, () => {
    // 5m is already the server-side default, so omitting it keeps the request
    // bytes identical to what shipped before the knob existed. If this starts
    // failing, the default path has changed and existing caches will miss.
    const msgs: any[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    applyMessageCaching(msgs as never);
    const opts = msgs[0].content[0].providerOptions;
    assert.deepEqual(opts.anthropic.cacheControl, { type: "ephemeral" });
    assert.deepEqual(opts.openrouter.cacheControl, { type: "ephemeral" });

    const tools = buildToolsParam([
      { name: "read", description: "d", parameters: {} },
    ] as never);
    assert.deepEqual(
      (tools!.read.providerOptions as any).anthropic.cacheControl,
      { type: "ephemeral" },
    );

    const system = buildAnthropicSystemParam([{ text: "s", cache: true }]);
    assert.deepEqual(
      ((system as any[])[0].providerOptions as any).anthropic.cacheControl,
      { type: "ephemeral" },
    );
  });
});

test("FREECODE_CACHE_TTL=1h reaches all three breakpoint kinds", () => {
  withCacheTtl("1h", () => {
    // Messages, tools and the system block must agree — a mixed set would
    // expire the prefix piecemeal, which is worse than either TTL alone.
    const msgs: any[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    applyMessageCaching(msgs as never);
    assert.deepEqual(msgs[0].content[0].providerOptions.anthropic.cacheControl, {
      type: "ephemeral",
      ttl: "1h",
    });

    const tools = buildToolsParam([
      { name: "read", description: "d", parameters: {} },
    ] as never);
    assert.deepEqual(
      (tools!.read.providerOptions as any).anthropic.cacheControl,
      { type: "ephemeral", ttl: "1h" },
    );

    const system = buildAnthropicSystemParam([{ text: "s", cache: true }]);
    assert.deepEqual(
      ((system as any[])[0].providerOptions as any).anthropic.cacheControl,
      { type: "ephemeral", ttl: "1h" },
    );
  });
});

test("ttl rides only on the provider keys verified to accept it", () => {
  withCacheTtl("1h", () => {
    const msgs: any[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    applyMessageCaching(msgs as never);
    const opts = msgs[0].content[0].providerOptions;

    assert.equal(opts.anthropic.cacheControl.ttl, "1h");
    assert.equal(opts.openrouter.cacheControl.ttl, "1h");
    // openaiCompatible is a raw passthrough to MiniMax/Z.ai and bedrock's
    // cachePoint has no TTL concept — an unrecognised field on the primary
    // path risks a 400 to buy nothing.
    assert.equal(opts.openaiCompatible.cache_control.ttl, undefined);
    assert.equal(opts.bedrock.cachePoint.ttl, undefined);
    assert.equal(opts.alibaba.cacheControl.ttl, undefined);
  });
});

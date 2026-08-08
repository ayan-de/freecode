import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "fs/promises";
import { createAgentLoop } from "./loop.js";
import {
  createSessionStore,
  type SessionStore,
  type SerializedMessage,
} from "../session/store.js";
import { PromptCompiler } from "../context/compiler.js";
import {
  getReadState,
  canDedup,
  disposeReadState,
} from "../tools/read-state.js";
import type { Message, ToolCall } from "./types.js";

test("PromptCompiler.compileSystemBlocks returns only the static block", async () => {
  const compiler = new PromptCompiler(
    "/path/to/project",
    "my-project",
    "build",
  );

  const blocks = await compiler.compileSystemBlocks(
    "anthropic",
    "claude-sonnet-4-5",
  );

  // Dynamic content (file tree, memory, clock) was deliberately moved out of
  // the system blocks and is now inlined as the first user message — see
  // compileDynamicContext. Putting it in the system blocks invalidates the
  // static-prefix cache marker on every turn. Claude Code uses the same
  // architecture (utils/api.ts:321, SYSTEM_PROMPT_DYNAMIC_BOUNDARY).
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].cache, true, "static block earns a breakpoint");

  // Static section has system prompts (tools are sent as native schemas)
  assert.ok(blocks[0].text.includes("BUILD mode"));
  assert.ok(!blocks[0].text.includes("Available tools"));
});

test("PromptCompiler.compileDynamicContext carries file tree and clock", () => {
  const compiler = new PromptCompiler(
    "/path/to/project",
    "my-project",
    "build",
  );
  const text = compiler.compileDynamicContext(
    "📄 index.js",
    "abc12345",
    "",
    "Some memory summary",
  );
  assert.ok(text.includes("my-project"));
  assert.ok(text.includes("/path/to/project"));
  assert.ok(text.includes("📄 index.js"));
  assert.ok(text.includes("Some memory summary"));
  assert.ok(text.includes("Current Time"));
});

test("AgentLoop.loadHistory reconstructs the message list correctly", async () => {
  const testDir = "/tmp/freecode-test-loop-caching-history";
  await rm(testDir, { recursive: true, force: true });
  const store: SessionStore = await createSessionStore(testDir);

  const sessionId = await store.createSession({
    title: "Test Caching",
    projectPath: "/tmp/test",
    provider: "mock",
  });

  // Append user message
  const userMsg: SerializedMessage = {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", content: "Tell me a joke" }],
    timestamp: Date.now(),
  };
  await store.appendMessage(sessionId, userMsg, "/tmp/test");

  // Append assistant message with tool call
  const assistantMsg: SerializedMessage = {
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "text", content: "Thinking..." },
      {
        type: "tool",
        tool: { name: "bash", args: { command: "echo 'haha'" } },
        result: "haha\n",
      },
    ],
    timestamp: Date.now(),
  };
  await store.appendMessage(sessionId, assistantMsg, "/tmp/test");

  const loop = createAgentLoop(sessionId, { sessionStore: store });
  // Set path manually to avoid scanning in tests
  (loop as any).state.projectPath = "/tmp/test";

  await (loop as any).loadHistory();

  const history: Message[] = (loop as any).history;
  assert.equal(history.length, 2);
  assert.equal(history[0].role, "user");
  assert.equal(history[0].parts[0].type, "text");
  assert.equal(history[0].parts[0].content, "Tell me a joke");

  assert.equal(history[1].role, "assistant");
  assert.equal(history[1].parts[0].type, "text");
  assert.equal(history[1].parts[0].content, "Thinking...");
  assert.equal(history[1].parts[1].type, "tool");
  assert.equal((history[1].parts[1] as any).tool.tool, "bash");
  assert.equal((history[1].parts[1] as any).tool.args.command, "echo 'haha'");
  assert.equal((history[1].parts[1] as any).result, "haha\n");

  await rm(testDir, { recursive: true, force: true });
});

// Replaces the old "maybeTimeBasedMicrocompact prunes old tool results after
// idle gap" test. That method cleared every tool result over 200 chars across
// the whole history — including the newest turn — whenever the user paused for
// five minutes, with no handle to retrieve what was dropped. It missed the
// prompt cache 100% on the next request and forced the model to re-read
// everything (spec 2026-08-05-token-efficiency, RC3). An idle gap says nothing
// about whether a result is still needed; size and age-in-turns do, and
// pruneHistoryToolResults already acts on those.
test("history is untouched by an idle gap, however long", async () => {
  const testDir = "/tmp/freecode-test-loop-idle-gap";
  await rm(testDir, { recursive: true, force: true });
  const store: SessionStore = await createSessionStore(testDir);

  const sessionId = await store.createSession({
    title: "Idle gap",
    projectPath: "/tmp/test",
    provider: "mock",
  });

  const hourAgo = Date.now() - 60 * 60_000;
  const bigResult = "x".repeat(5_000);
  await store.appendMessage(
    sessionId,
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool",
          tool: { name: "bash", args: { command: "ls" } },
          result: bigResult,
        },
      ],
      timestamp: hourAgo,
    },
    "/tmp/test",
  );

  const loop = createAgentLoop(sessionId, { sessionStore: store });
  (loop as any).state.projectPath = "/tmp/test";
  await (loop as any).loadHistory();

  // The clearing ran inside run(), not loadHistory(), so this half alone would
  // have passed before the deletion too — exercising run() needs a live
  // provider. The assertion below is what actually holds the change in place.
  const history: Message[] = (loop as any).history;
  assert.equal((history[0].parts[0] as any).result, bigResult);
  assert.ok(
    !JSON.stringify(history).includes("Old tool result content cleared"),
  );

  // Guards against the method being reintroduced: there is no time-based
  // history mutation on the loop at all.
  assert.equal(
    (loop as any).maybeTimeBasedMicrocompact,
    undefined,
    "time-based tool-result clearing must not come back — see RC3",
  );

  await rm(testDir, { recursive: true, force: true });
});

// Rewritten for RC4. The previous version asserted the sliding-window rule
// ("last 2 assistant turns full size, everything older capped at 1000 chars"),
// which is the behaviour being removed — that window is what mutated the prompt
// prefix two turns back on every turn.
const bigResult = (n: number) => "x".repeat(n);

function assistantWithResult(id: string, resultLength: number): Message {
  return {
    id,
    role: "assistant",
    timestamp: Date.now(),
    parts: [
      {
        type: "tool",
        tool: {
          id: `t-${id}`,
          tool: "read",
          args: {},
          execution: "sequential",
        },
        result: bigResult(resultLength),
      },
    ],
  };
}

// The load-bearing test: whatever the pruner does, the bytes it already sent
// must not change when the conversation grows. A cached prefix that mutates is
// re-billed as a write; that is the entire cost RC4 describes.
test("pruneHistoryToolResults keeps the sent prefix byte-identical as history grows", () => {
  const loop = createAgentLoop("test-session");

  // Well over the 200K-char budget, so replacement definitely engages.
  const messages: Message[] = [
    assistantWithResult("a", 90_000),
    assistantWithResult("b", 90_000),
    assistantWithResult("c", 90_000),
  ];

  const first = (loop as any).pruneHistoryToolResults(messages);
  const prefixA = JSON.stringify(first);

  // Next turn: same history plus a new assistant turn.
  const grown = [...messages, assistantWithResult("d", 90_000)];
  const second = (loop as any).pruneHistoryToolResults(grown);
  const prefixB = JSON.stringify(second);

  assert.ok(
    prefixB.startsWith(prefixA.slice(0, prefixA.length - 1)),
    "everything sent on the first turn must be byte-identical on the second",
  );

  // And again, to catch a decision that only stabilises after two rounds.
  const grownAgain = [...grown, assistantWithResult("e", 90_000)];
  const third = JSON.stringify(
    (loop as any).pruneHistoryToolResults(grownAgain),
  );
  assert.ok(third.startsWith(prefixB.slice(0, prefixB.length - 1)));
});

test("a result sent at full size is frozen, even once it is old", () => {
  const loop = createAgentLoop("test-session");

  // Under budget: nothing is replaced, so this goes out whole and freezes.
  const messages: Message[] = [assistantWithResult("a", 50_000)];
  const first = (loop as any).pruneHistoryToolResults(messages);
  assert.equal((first[0].parts[0] as any).result.length, 50_000);

  // Now blow past the budget. The frozen result must stay full size — it is in
  // the cached prefix, and shrinking it would cost more than it saves.
  const grown: Message[] = [
    ...messages,
    assistantWithResult("b", 150_000),
    assistantWithResult("c", 150_000),
  ];
  const second = (loop as any).pruneHistoryToolResults(grown);
  assert.equal(
    (second[0].parts[0] as any).result.length,
    50_000,
    "frozen result must not be replaced after aging",
  );
});

test("a replaced result is re-applied with the identical string", () => {
  const loop = createAgentLoop("test-session");

  const messages: Message[] = [
    assistantWithResult("a", 150_000),
    assistantWithResult("b", 150_000),
    assistantWithResult("c", 10),
  ];

  const first = (loop as any).pruneHistoryToolResults(messages);
  const replacedOnce = (first[0].parts[0] as any).result;
  assert.ok(replacedOnce.includes("tool result omitted"));
  assert.ok(replacedOnce.includes('id="t-a"'));

  const second = (loop as any).pruneHistoryToolResults([
    ...messages,
    assistantWithResult("d", 10),
  ]);
  assert.equal(
    (second[0].parts[0] as any).result,
    replacedOnce,
    "re-derived replacements must be byte-identical, not merely equivalent",
  );
});

test("the newest assistant turn is never replaced before the model reads it", () => {
  const loop = createAgentLoop("test-session");

  const messages: Message[] = [
    assistantWithResult("a", 150_000),
    assistantWithResult("b", 150_000),
    // Newest: huge, but the model has not reasoned over it yet.
    assistantWithResult("newest", 150_000),
  ];

  const pruned = (loop as any).pruneHistoryToolResults(messages);
  assert.equal(
    (pruned[2].parts[0] as any).result.length,
    150_000,
    "replacing the current turn's result just forces an immediate re-read",
  );
});

test("history under budget is passed through untouched, by reference", () => {
  const loop = createAgentLoop("test-session");

  const messages: Message[] = [
    assistantWithResult("a", 500),
    assistantWithResult("b", 1_500),
  ];
  const pruned = (loop as any).pruneHistoryToolResults(messages);

  assert.equal(pruned, messages, "no copy when nothing is replaced");
  assert.equal((pruned[0].parts[0] as any).result.length, 500);
  assert.equal((pruned[1].parts[0] as any).result.length, 1_500);
});

// The interaction between RC4 and RC5: read dedup answers a repeat read with
// "it's already above". If pruning replaced that copy with a marker, the model
// would be pointed at nothing. Pruning a read must therefore retract its
// dedup entry.
test("pruning a read result retracts its dedup entry", () => {
  const sessionId = "test-prune-readstate";
  const loop = createAgentLoop(sessionId);

  const readMsg = (id: string, filePath: string, size: number): Message => ({
    id,
    role: "assistant",
    timestamp: Date.now(),
    parts: [
      {
        type: "tool",
        tool: {
          id: `t-${id}`,
          tool: "read",
          args: { filePath },
          execution: "sequential",
        },
        result: "x".repeat(size),
      },
    ],
  });

  const state = getReadState(sessionId);
  const probe = { mtimeMs: 1, size: 1, offset: 1, limit: 2000 };
  state.set("/big.ts", { ...probe, inContext: true });
  assert.equal(canDedup(state.get("/big.ts"), probe), true);

  // Over budget, and not the newest turn, so /big.ts gets replaced.
  (loop as any).pruneHistoryToolResults([
    readMsg("big", "/big.ts", 150_000),
    readMsg("other", "/other.ts", 150_000),
    assistantWithResult("newest", 10),
  ]);

  assert.equal(
    canDedup(state.get("/big.ts"), probe),
    false,
    "a read whose content was pruned must not be deduped against",
  );
  disposeReadState(sessionId);
});

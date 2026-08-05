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
import type { Message, ToolCall } from "./types.js";

test("PromptCompiler.compileSystemBlocks splits static and dynamic parts correctly", async () => {
  const compiler = new PromptCompiler(
    "/path/to/project",
    "my-project",
    "build",
  );
  const tree = "📄 index.js";
  const gitHead = "abc12345";

  const blocks = await compiler.compileSystemBlocks(
    tree,
    gitHead,
    "",
    "anthropic",
    "claude-sonnet-4-5",
    "Some memory summary",
  );

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].cache, true);
  assert.equal(blocks[1].cache, true);

  // Static section has system prompts (tools are sent as native schemas)
  assert.ok(blocks[0].text.includes("BUILD mode"));
  assert.ok(!blocks[0].text.includes("Available tools"));

  // Dynamic section has tree, git head, path, and memory
  assert.ok(blocks[1].text.includes("my-project"));
  assert.ok(blocks[1].text.includes("/path/to/project"));
  assert.ok(blocks[1].text.includes("📄 index.js"));
  assert.ok(blocks[1].text.includes("Some memory summary"));
  assert.ok(blocks[1].text.includes("Current Time"));
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

test("AgentLoop.pruneHistoryToolResults caps old tool results but preserves recent turns", () => {
  const loop = createAgentLoop("test-session");

  const buildAssistantMsg = (id: string, resultLength: number): Message => ({
    id,
    role: "assistant",
    timestamp: Date.now(),
    parts: [
      {
        type: "tool",
        tool: { id: `t-${id}`, tool: "read", args: {}, execution: "sequential" },
        result: "x".repeat(resultLength),
      },
    ],
  });

  const messages: Message[] = [
    // Turn 1 (Oldest, assistant): should be pruned if result is large
    buildAssistantMsg("ast-1", 1500),
    // Turn 2 (Old, assistant): should be pruned if result is large
    buildAssistantMsg("ast-2", 1200),
    // User message in between
    { id: "usr-1", role: "user", parts: [{ type: "text", content: "ok" }], timestamp: Date.now() },
    // Turn 3 (Recent, assistant): should be preserved
    buildAssistantMsg("ast-3", 1500),
    // Turn 4 (Most recent assistant): should be preserved
    buildAssistantMsg("ast-4", 2000),
  ];

  const pruned = (loop as any).pruneHistoryToolResults(messages);

  assert.equal(pruned.length, 5);

  // Turn 4 (most recent assistant) -> preserved
  assert.equal((pruned[4].parts[0] as any).result.length, 2000);

  // Turn 3 (second most recent assistant) -> preserved
  assert.equal((pruned[3].parts[0] as any).result.length, 1500);

  // Turn 2 (older assistant) -> pruned
  assert.ok((pruned[1].parts[0] as any).result.includes("[... result truncated in history; re-read if needed ...]"));
  assert.equal((pruned[1].parts[0] as any).result.slice(0, 1000), "x".repeat(1000));

  // Turn 1 (oldest assistant) -> pruned
  assert.ok((pruned[0].parts[0] as any).result.includes("[... result truncated in history; re-read if needed ...]"));
  assert.equal((pruned[0].parts[0] as any).result.slice(0, 1000), "x".repeat(1000));

  // Small outputs should not be pruned even in old turns
  const messagesWithSmall: Message[] = [
    buildAssistantMsg("ast-old-small", 500),
    buildAssistantMsg("ast-rec-1", 1000),
    buildAssistantMsg("ast-rec-2", 1000),
  ];
  const prunedSmall = (loop as any).pruneHistoryToolResults(messagesWithSmall);
  assert.equal((prunedSmall[0].parts[0] as any).result, "x".repeat(500)); // intact
});


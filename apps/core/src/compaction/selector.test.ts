import test from "node:test";
import assert from "node:assert/strict";
import { selectForCompaction, renderPromptMemoryContext } from "./selector.js";
import {
  DEFAULT_COMPACTION_CONFIG,
  type CompactionSummary,
  type MemoryMessage,
} from "./types.js";

function msg(
  id: string,
  role: MemoryMessage["role"],
  content: string,
  tokenCount = 100,
): MemoryMessage {
  return { id, role, content, tokenCount, timestamp: Number(id) };
}

test("selectForCompaction preserves the recent tail and summarizes older messages", () => {
  const messages = [
    msg("1", "user", "old request"),
    msg("2", "assistant", "old answer"),
    msg("3", "user", "middle request"),
    msg("4", "assistant", "middle answer"),
    msg("5", "user", "latest request"),
    msg("6", "assistant", "latest answer"),
  ];

  const result = selectForCompaction(messages, DEFAULT_COMPACTION_CONFIG);

  // "1" is the founding user instruction and is carved out of the summary.
  assert.deepEqual(
    result.summarize.map((item) => item.id),
    ["2"],
  );
  assert.deepEqual(
    result.preserve.map((item) => item.id),
    ["1", "3", "4", "5", "6"],
  );
});

test("selectForCompaction never summarizes the founding instruction away", () => {
  const messages = [
    msg("1", "user", "build a parser for TOML"),
    ...Array.from({ length: 20 }, (_, i) =>
      msg(String(i + 2), i % 2 === 0 ? "assistant" : "user", `chatter ${i}`),
    ),
  ];

  // Compact twice: the second pass is where the old code re-summarized the
  // summary of the brief.
  const first = selectForCompaction(messages, DEFAULT_COMPACTION_CONFIG);
  assert.equal(first.preserve[0].id, "1");
  assert.ok(!first.summarize.some((m) => m.id === "1"));

  const second = selectForCompaction(first.preserve, DEFAULT_COMPACTION_CONFIG);
  assert.equal(second.preserve[0].id, "1");
  assert.ok(!second.summarize.some((m) => m.id === "1"));
});

test("a head too large to be a brief is summarized like anything else", () => {
  const messages = [
    msg("1", "user", "a pasted 50k spec", 50_000),
    msg("2", "assistant", "ack"),
    msg("3", "user", "middle"),
    msg("4", "assistant", "middle answer"),
    msg("5", "user", "latest"),
    msg("6", "assistant", "latest answer"),
  ];

  const result = selectForCompaction(messages, DEFAULT_COMPACTION_CONFIG);

  assert.ok(result.summarize.some((m) => m.id === "1"));
  assert.equal(result.preserve[0].id, "3");
});

test("selectForCompaction returns no summarize set when history is too short", () => {
  const messages = [
    msg("1", "user", "latest"),
    msg("2", "assistant", "answer"),
  ];
  const result = selectForCompaction(messages, DEFAULT_COMPACTION_CONFIG);

  assert.deepEqual(result.summarize, []);
  assert.deepEqual(
    result.preserve.map((item) => item.id),
    ["1", "2"],
  );
});

test("renderPromptMemoryContext includes summary and recent messages", () => {
  const summary: CompactionSummary = {
    id: "summary-1",
    createdAt: 1,
    originalMessageCount: 2,
    originalTokenCount: 200,
    summaryTokenCount: 50,
    content: "## Goal\n- Build memory",
  };

  const rendered = renderPromptMemoryContext({
    summary: summary.content,
    recentMessages: [
      msg("3", "user", "continue work"),
      msg("4", "assistant", "working"),
    ],
    tokenCount: 250,
  });

  assert.match(rendered, /Compacted session summary/);
  assert.match(rendered, /Build memory/);
  assert.match(rendered, /Recent session messages/);
  assert.match(rendered, /user: continue work/);
});

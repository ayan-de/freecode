import test from "node:test";
import assert from "node:assert/strict";
import { buildBootstrap, renderOutgoing } from "./encode.js";
import type { Message } from "../../agent/types.js";

function userText(id: string, content: string): Message {
  return { id, role: "user", parts: [{ type: "text", content }], timestamp: 0 };
}

test("assistant messages are never re-sent — the site already has them", () => {
  const out = renderOutgoing(
    [
      userText("a", "do the thing"),
      {
        id: "b",
        role: "assistant",
        parts: [{ type: "text", content: "on it" }],
        timestamp: 0,
      },
    ],
    4000,
  );
  assert.match(out, /do the thing/);
  assert.doesNotMatch(out, /on it/);
});

test("tool results render as a result block keyed by call id", () => {
  const message: Message = {
    id: "m",
    role: "user",
    parts: [
      {
        type: "tool",
        tool: { id: "7", name: "read", args: {} } as never,
        result: "file contents",
      },
    ],
    timestamp: 0,
  };
  const out = renderOutgoing([message], 4000);
  assert.match(out, /~~~freecode-result/);
  assert.match(out, /"7":"file contents"/);
});

test("oversized results are truncated with a pointer to ask for more", () => {
  const message: Message = {
    id: "m",
    role: "user",
    parts: [
      {
        type: "tool",
        tool: { id: "1", name: "read", args: {} } as never,
        result: "x\n".repeat(500),
      },
    ],
    timestamp: 0,
  };
  const out = renderOutgoing([message], 100);
  assert.match(out, /truncated/);
  assert.ok(out.length < 500, "should be far shorter than the raw result");
});

test("the bootstrap carries the system prompt, tools and the contract", () => {
  const out = buildBootstrap({
    system: "SYSTEM-PROMPT-MARKER",
    tools: [
      { name: "read", description: "Read a file", parameters: { type: "object" } },
    ],
    messages: [userText("a", "start")],
    maxToolResultChars: 4000,
  });
  assert.match(out, /SYSTEM-PROMPT-MARKER/);
  assert.match(out, /### read/);
  assert.match(out, /Output protocol/);
  assert.match(out, /start/);
});

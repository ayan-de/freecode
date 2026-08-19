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
  assert.match(out, /Asking me to run something/);
  assert.match(out, /start/);
});

test("REGRESSION: the bootstrap never claims the model is FreeCode", () => {
  // The first live run failed exactly here. Told it was "FreeCode ... with a
  // bash/edit/glob toolset", the model replied that it is Claude in the
  // claude.ai interface and has no such tools — rejecting the premise, not
  // the format.
  const out = buildBootstrap({
    system: "You are FreeCode, an AI coding assistant CLI.",
    tools: [
      { name: "bash", description: "Run a command", parameters: { type: "object" } },
    ],
    messages: [userText("a", "go")],
    maxToolResultChars: 4000,
  });

  // We identify ourselves as the program…
  assert.match(out, /I am FreeCode, a command-line\ntool/);
  // …explicitly disclaim the model's ownership of the tools…
  assert.match(out, /You do not have these tools yourself/);
  // …and the framing must come BEFORE the system prompt, so the second-person
  // configuration text is read inside it.
  assert.ok(
    out.indexOf("Who you are talking to") <
      out.indexOf("You are FreeCode, an AI coding assistant CLI."),
    "the relay framing must precede the system prompt",
  );
  assert.match(out, /not a claim about who you are/);
});

test("tools are offered, not attributed to the model", () => {
  const out = buildBootstrap({
    system: "",
    tools: [{ name: "read", description: "d", parameters: {} }],
    messages: [userText("a", "go")],
    maxToolResultChars: 4000,
  });
  assert.match(out, /What I can run for you/);
  assert.doesNotMatch(out, /Available tools/);
});

test("REGRESSION: the bootstrap disowns the site's own sandbox tools", () => {
  // Second live failure: the model accepted the framing, then used claude.ai's
  // built-in bash tool to search its own container, found no package.json, and
  // reported the file missing. Nothing had told it the sandbox is a different
  // machine, so reaching for it was the reasonable reading.
  const out = buildBootstrap({
    system: "",
    tools: [{ name: "read", description: "d", parameters: {} }],
    messages: [userText("a", "read package.json")],
    maxToolResultChars: 4000,
  });
  assert.match(out, /different computer/i);
  assert.match(out, /does not\nexist there/);
  assert.match(out, /do not use those tools for this task/i);
});

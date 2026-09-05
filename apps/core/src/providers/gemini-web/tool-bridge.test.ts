import test from "node:test";
import assert from "node:assert/strict";
import {
  buildToolProtocol,
  correctionPrompt,
  parseReply,
  StreamGate,
} from "./tool-bridge.js";
import { buildPrompt } from "./index.js";
import type { Message } from "../../agent/types.js";
import type { ToolDef } from "../types.js";

const READ_TOOL: ToolDef = {
  name: "read",
  description: "Read a file from the filesystem. Supports offset and limit.",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string" },
      offset: { type: "number" },
      limit: { type: "number" },
    },
    required: ["filePath"],
  },
};

// ---------------------------------------------------------------------------
// buildToolProtocol
// ---------------------------------------------------------------------------

test("protocol lists tools with required params bare, optional suffixed ?", () => {
  const prompt = buildToolProtocol([READ_TOOL]);
  assert.match(prompt, /- read\(filePath, offset\?, limit\?\): Read a file/);
  assert.match(prompt, /\[TOOL_CALLS\]/);
  assert.match(prompt, /FINAL:/);
});

test("protocol truncates tool descriptions to the first sentence", () => {
  const prompt = buildToolProtocol([READ_TOOL]);
  assert.ok(!prompt.includes("Supports offset"));
});

// ---------------------------------------------------------------------------
// parseReply
// ---------------------------------------------------------------------------

test("parses a bare tool block", () => {
  const reply = '[TOOL_CALLS]\nread:{"filePath":"TRACE.md"}\n[/TOOL_CALLS]';
  const parsed = parseReply(reply);
  assert.equal(parsed.violation, undefined);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].name, "read");
  assert.deepEqual(parsed.toolCalls[0].args, { filePath: "TRACE.md" });
  assert.equal(parsed.content, "");
});

test("parses multiple calls and keeps prose outside the block", () => {
  const reply =
    'I need two files.\n[TOOL_CALLS]\nread:{"filePath":"a.ts"}\ngrep:{"pattern":"foo"}\n[/TOOL_CALLS]';
  const parsed = parseReply(reply);
  assert.equal(parsed.toolCalls.length, 2);
  assert.equal(parsed.toolCalls[1].name, "grep");
  assert.equal(parsed.content, "I need two files.");
});

test("tolerates code fences wrapped around the block lines", () => {
  const reply =
    '[TOOL_CALLS]\n```\nread:{"filePath":"a.ts"}\n```\n[/TOOL_CALLS]';
  const parsed = parseReply(reply);
  assert.equal(parsed.toolCalls.length, 1);
});

test("strips the FINAL: token from a final answer", () => {
  const parsed = parseReply("FINAL: The first line is `# Trace`. ");
  assert.equal(parsed.violation, undefined);
  assert.equal(parsed.toolCalls.length, 0);
  assert.equal(parsed.content, "The first line is `# Trace`.");
});

test("a fluent answer with neither form is a violation", () => {
  const parsed = parseReply("The file contains 23 quarantined cases.");
  assert.ok(parsed.violation);
  assert.equal(parsed.toolCalls.length, 0);
  // The text is preserved so a twice-violating reply can still be shown.
  assert.equal(parsed.content, "The file contains 23 quarantined cases.");
});

test("unparseable args are a violation carrying the bad line", () => {
  const parsed = parseReply("[TOOL_CALLS]\nread:{filePath: broken}\n[/TOOL_CALLS]");
  assert.ok(parsed.violation);
  assert.match(parsed.violation!, /read:\{filePath: broken\}/);
});

test("one good call among bad lines still executes", () => {
  const parsed = parseReply(
    '[TOOL_CALLS]\nnonsense line\nread:{"filePath":"a.ts"}\n[/TOOL_CALLS]',
  );
  assert.equal(parsed.violation, undefined);
  assert.equal(parsed.toolCalls.length, 1);
});

test("call ids are unique", () => {
  const parsed = parseReply(
    '[TOOL_CALLS]\nread:{"filePath":"a.ts"}\nread:{"filePath":"b.ts"}\n[/TOOL_CALLS]',
  );
  assert.notEqual(parsed.toolCalls[0].id, parsed.toolCalls[1].id);
});

// ---------------------------------------------------------------------------
// StreamGate
// ---------------------------------------------------------------------------

function drive(gate: StreamGate, deltas: string[]): string {
  let out = "";
  for (const delta of deltas) out += gate.push(delta);
  out += gate.finish();
  return out;
}

test("gate streams a FINAL answer live with the token stripped", () => {
  const gate = new StreamGate();
  const out = drive(gate, ["FIN", "AL: the ans", "wer"]);
  assert.equal(out, "the answer");
  assert.equal(gate.mode, "final");
  assert.equal(gate.emitted, true);
});

test("gate withholds a tool block entirely", () => {
  const gate = new StreamGate();
  const out = drive(gate, [
    "[TOOL_C",
    'ALLS]\nread:{"filePath":"a.ts"}\n[/TOOL_CALLS]',
  ]);
  assert.equal(out, "");
  assert.equal(gate.mode, "tool");
  assert.equal(gate.emitted, false);
  assert.equal(parseReply(gate.full).toolCalls.length, 1);
});

test("gate emits prose before a block, withholds the block", () => {
  const gate = new StreamGate();
  const out = drive(gate, [
    "Let me read that.\n",
    '[TOOL_CALLS]\nread:{"filePath":"a.ts"}\n[/TOOL_CALLS]',
  ]);
  assert.equal(out, "Let me read that.\n");
  assert.equal(gate.mode, "tool");
});

test("gate withholds a marker split across deltas mid-FINAL", () => {
  const gate = new StreamGate();
  let out = gate.push("FINAL: done. [TOOL_");
  assert.ok(!out.includes("[TOOL_"));
  out += gate.push('CALLS]\nread:{"filePath":"a.ts"}\n[/TOOL_CALLS]');
  out += gate.finish();
  assert.equal(out, "done. ");
});

test("a bracket that is not the marker is released, not eaten", () => {
  const gate = new StreamGate();
  const out = drive(gate, ["FINAL: see [TOOL", " docs] for details"]);
  assert.equal(out, "see [TOOL docs] for details");
});

test("an unclassifiable reply emits nothing and ends in violation", () => {
  const gate = new StreamGate();
  const out = drive(gate, ["The file has ", "23 quarantined cases."]);
  assert.equal(out, "");
  assert.equal(gate.mode, "violation");
  assert.equal(gate.emitted, false);
  assert.equal(gate.full, "The file has 23 quarantined cases.");
});

test("correction prompt carries the violating reply and the reason", () => {
  const text = correctionPrompt("bad reply", "no FINAL");
  assert.match(text, /bad reply/);
  assert.match(text, /no FINAL/);
});

// ---------------------------------------------------------------------------
// buildPrompt in tool mode
// ---------------------------------------------------------------------------

function msg(role: Message["role"], parts: Message["parts"]): Message {
  return { id: `m-${Math.random()}`, role, parts, timestamp: 0 };
}

test("tool mode renders calls in wire format and results unlabelled", () => {
  const messages: Message[] = [
    msg("user", [{ type: "text", content: "what is in a.ts?" }]),
    msg("assistant", [
      {
        type: "tool",
        tool: { id: "t1", tool: "read", args: { filePath: "a.ts" }, execution: "sequential" },
        result: "export const x = 1;",
      },
    ]),
  ];
  const prompt = buildPrompt(messages, [READ_TOOL]);
  assert.match(prompt, /\[TOOL_CALLS\]\nread:\{"filePath":"a\.ts"\}\n\[\/TOOL_CALLS\]/);
  assert.match(prompt, /\[Tool result for read\]:\nexport const x = 1;/);
  assert.match(prompt, /PROTOCOL/);
});

test("without tools the same history drops tool parts (default path)", () => {
  const messages: Message[] = [
    msg("user", [{ type: "text", content: "hi" }]),
    msg("assistant", [
      {
        type: "tool",
        tool: { id: "t1", tool: "read", args: {}, execution: "sequential" },
        result: "secret",
      },
    ]),
  ];
  const prompt = buildPrompt(messages);
  assert.ok(!prompt.includes("secret"));
  assert.ok(!prompt.includes("TOOL_CALLS"));
});

test("older tool results collapse when over the transcript budget", () => {
  const big = "x".repeat(15_000);
  const messages: Message[] = [
    msg("user", [{ type: "text", content: "q1" }]),
    msg("assistant", [
      {
        type: "tool",
        tool: { id: "t1", tool: "read", args: { filePath: "old.ts" }, execution: "sequential" },
        result: big,
      },
    ]),
    msg("user", [{ type: "text", content: "q2" }]),
    msg("assistant", [
      ...Array.from({ length: 4 }, (_, i) => ({
        type: "tool" as const,
        tool: {
          id: `t${i + 2}`,
          tool: "read",
          args: { filePath: `f${i}.ts` },
          execution: "sequential" as const,
        },
        result: big,
      })),
    ]),
  ];
  const prompt = buildPrompt(messages, [READ_TOOL]);
  // Newest results keep their (capped) bytes; the oldest collapses.
  assert.match(prompt, /omitted — older result over the transcript budget/);
  assert.match(prompt, /truncated: result is larger than the transcript budget/);
});

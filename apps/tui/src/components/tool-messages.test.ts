import assert from "node:assert/strict";
import test from "node:test";
import { clearMessages, getMessages } from "../state/message-store.js";
import { createToolProgressMessage } from "./index.js";
import { ToolResultMessage } from "./tool-result-message.js";

/**
 * Headers are chalk-styled, so reset codes land between the parts an assertion
 * wants adjacent (`Run` and `(`, a path and its `:range`). Whether they appear
 * at all depends on chalk's colour detection — FORCE_COLOR or a TTY turns them
 * on — so assert on the plain text and the test holds either way.
 */
function plain(lines: string[]): string {
  return lines.join("|").replace(/\x1b\[[0-9;]*m/g, "");
}

test("createToolProgressMessage adds a renderable tool message", () => {
  clearMessages();

  const message = createToolProgressMessage("call-1", "Write", {
    path: "FREECODE.md",
  });

  const messages = getMessages();
  assert.equal(messages.length, 1);
  assert.equal(messages[0], message);
  assert.equal(message.type, "tool");
  assert.match(message.component.render(80).join("\n"), /Write/);
  assert.match(message.component.render(80).join("\n"), /FREECODE\.md/);
});

test("large multi-line results render one terminal row per line, collapsed", () => {
  const bigResult = Array.from({ length: 50 }, (_, i) => `out-${i}`).join("\n");
  const msg = new ToolResultMessage({
    toolCallId: "call-2",
    toolName: "Bash",
    args: { command: "ls" },
    result: bigResult,
    success: true,
  });

  const lines = msg.render(80);
  // No rendered element may contain an embedded newline — pi-tui counts each
  // array element as exactly one terminal row.
  for (const line of lines) {
    assert.ok(!line.includes("\n"), `embedded newline in: ${line}`);
  }
  // Collapsed preview: 5 result lines + "… +45 lines" tail.
  assert.match(lines.join("|"), /out-4/);
  assert.doesNotMatch(lines.join("|"), /out-5\b/);
  assert.match(lines.join("|"), /\+45 lines/);
});

test("a multi-line bash command is flattened in the Run header", () => {
  const msg = new ToolResultMessage({
    toolCallId: "call-4",
    toolName: "Bash",
    args: {
      command: "cd apps/tui && node -e '\nconst x = 1;\nconsole.log(x);\n'",
    },
    result: "1",
    success: true,
  });

  const lines = msg.render(80);
  for (const line of lines) {
    assert.ok(!line.includes("\n"), `embedded newline in: ${line}`);
  }
  assert.match(plain(lines), /Run\(cd apps\/tui/);
});

test("multi-line string args are flattened in the header", () => {
  const msg = new ToolResultMessage({
    toolCallId: "call-3",
    toolName: "Edit",
    args: { old_string: "line one\nline two" },
    result: "ok",
    success: true,
  });

  for (const line of msg.render(80)) {
    assert.ok(!line.includes("\n"), `embedded newline in: ${line}`);
  }
});

test("a ranged read shows the line window in the header", () => {
  const header = (args: Record<string, unknown>) =>
    plain(
      new ToolResultMessage({
        toolCallId: "call-range",
        toolName: "read",
        args: { filePath: "/tmp/auth.ts", ...args },
        result: "ok",
        success: true,
      }).render(120),
    );

  // offset + limit → an explicit closed range.
  assert.match(header({ offset: 340, limit: 60 }), /auth\.ts:340-399/);
  // offset alone runs to the default limit, so the end is open.
  assert.match(header({ offset: 340 }), /auth\.ts:340\+/);
  // limit alone starts at line 1.
  assert.match(header({ limit: 60 }), /auth\.ts:1-60/);
  // Providers that stringify numeric args get the same treatment.
  assert.match(header({ offset: "10", limit: "5" }), /auth\.ts:10-14/);
  // A whole-file read is unchanged.
  const wholeFile = header({});
  assert.match(wholeFile, /auth\.ts\)/);
  assert.equal(/auth\.ts:/.test(wholeFile), false);
});

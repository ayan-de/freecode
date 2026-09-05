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

  // Collapsed by default: the header is the whole message.
  assert.deepEqual(msg.render(80).length, 1);
  assert.match(plain(msg.render(80)), /\u25b6 . Run\(ls\)/);
  assert.doesNotMatch(plain(msg.render(80)), /out-0/);

  msg.toggle();
  const lines = msg.render(80);
  // No rendered element may contain an embedded newline — pi-tui counts each
  // array element as exactly one terminal row.
  for (const line of lines) {
    assert.ok(!line.includes("\n"), `embedded newline in: ${line}`);
  }
  // Expanded preview: 5 result lines + "… +45 lines" tail.
  assert.match(lines.join("|"), /out-4/);
  assert.doesNotMatch(lines.join("|"), /out-5\b/);
  assert.match(lines.join("|"), /\+45 lines/);
  assert.match(plain(lines), /\u25bc /);
});

test("only the header row toggles, so expanded output stays selectable", () => {
  const msg = new ToolResultMessage({
    toolCallId: "call-2b",
    toolName: "Bash",
    args: { command: "ls" },
    result: "a\nb\nc",
    success: true,
  });

  msg.render(80);
  assert.equal(msg.isToggleLine(0), true); // collapsed: header is row 0

  msg.toggle();
  msg.render(80);
  // Expanded: row 0 is the leading blank, row 1 the header, rest is output.
  assert.equal(msg.isToggleLine(0), false);
  assert.equal(msg.isToggleLine(1), true);
  assert.equal(msg.isToggleLine(2), false);
});

test("a diff result is never collapsible and renders untouched", () => {
  const msg = new ToolResultMessage({
    toolCallId: "call-2c",
    toolName: "Edit",
    args: { file_path: "x.ts" },
    result: "  1 keep\n- 2 old\n+ 2 new\n",
    success: true,
  });

  const lines = msg.render(80);
  assert.doesNotMatch(plain(lines), /\u25b6|\u25bc/);
  assert.match(plain(lines), /Update\(x\.ts\)/);
  assert.match(plain(lines), /Added 1 line, removed 1 line/);
  // No row claims the click, so drag-select works across the whole diff.
  for (let i = 0; i < lines.length; i++) {
    assert.equal(msg.isToggleLine(i), false);
  }
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

test("a read of a bulleted markdown file is not mistaken for a diff", () => {
  const msg = new ToolResultMessage({
    toolCallId: "call-2d",
    toolName: "Read",
    args: { file_path: "README.md" },
    result: "# Title\n\n- one\n- two\n",
    success: true,
  });

  const lines = msg.render(80);
  assert.doesNotMatch(plain(lines), /Removed 2 lines/);
  assert.doesNotMatch(plain(lines), /one/);
  assert.match(plain(lines), /Read\(README\.md\)/);
});

test("a read is a single row — no blank lines framing a bodyless header", () => {
  const msg = new ToolResultMessage({
    toolCallId: "call-2e",
    toolName: "Read",
    args: { file_path: "a.ts" },
    result: "whatever the file said",
    success: true,
  });

  const lines = msg.render(80);
  assert.equal(lines.length, 1);
  assert.match(plain(lines), /Read\(a\.ts\)/);
});

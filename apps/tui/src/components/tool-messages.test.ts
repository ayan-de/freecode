import assert from "node:assert/strict";
import test from "node:test";
import { clearMessages, getMessages } from "../state/message-store.js";
import { createToolProgressMessage } from "./index.js";
import { ToolResultMessage } from "./tool-result-message.js";

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

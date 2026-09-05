import assert from "node:assert/strict";
import test from "node:test";
import { clearMessages, getMessages } from "../state/message-store.js";
import {
  createToolProgressMessage,
  createToolResultMessage,
  createAssistantMessage,
  createSystemMessage,
  sealToolGroups,
} from "./index.js";
import { ToolGroupMessage } from "./tool-group-message.js";

function plain(lines: string[]): string {
  return lines.join("|").replace(/\x1b\[[0-9;]*m/g, "");
}

function addResult(name: string, args: Record<string, unknown>, success = true) {
  return createToolResultMessage(`call-${name}-${Math.random()}`, name, args, "ok", success);
}

test("consecutive tool results share one message and summarize by tool", () => {
  clearMessages();

  addResult("Read", { file_path: "a.ts" });
  addResult("Read", { file_path: "b.ts" });
  addResult("Edit", { file_path: "c.ts" });
  addResult("Bash", { command: "ls" });

  const messages = getMessages();
  assert.equal(messages.length, 1);
  const group = messages[0]!.component as ToolGroupMessage;
  assert.ok(group instanceof ToolGroupMessage);
  assert.equal(group.size, 4);

  // Collapsed from the start: the summary is the whole message, live or not.
  assert.doesNotMatch(plain(group.render(80)), /a\.ts/);

  sealToolGroups();
  const collapsed = group.render(80);
  assert.match(plain(collapsed), /Read 2 files, Updated 1 file, Ran 1 command/);
  assert.doesNotMatch(plain(collapsed), /a\.ts/);
  assert.match(plain(collapsed), /▶ /);
});

test("clicking the summary expands the group back to one row per call", () => {
  clearMessages();
  addResult("Read", { file_path: "a.ts" });
  addResult("Read", { file_path: "b.ts" });
  sealToolGroups();

  const group = getMessages()[0]!.component as ToolGroupMessage;
  group.render(80);
  assert.equal(group.isToggleLine(0), false); // leading blank
  assert.equal(group.isToggleLine(1), true); // summary

  group.toggleAt(1);
  const expanded = group.render(80);
  assert.match(plain(expanded), /a\.ts/);
  assert.match(plain(expanded), /b\.ts/);
  assert.match(plain(expanded), /▼ /);
});

test("a failed call marks the summary", () => {
  clearMessages();
  addResult("Bash", { command: "false" }, false);
  sealToolGroups();

  const group = getMessages()[0]!.component as ToolGroupMessage;
  assert.match(plain(group.render(80)), /Ran 1 command \(1 failed\)/);
});

test("an unknown tool falls back to a count instead of invented grammar", () => {
  clearMessages();
  addResult("mcp__thing__do", {});
  addResult("mcp__thing__do", {});
  sealToolGroups();

  const group = getMessages()[0]!.component as ToolGroupMessage;
  assert.match(plain(group.render(80)), /mcp__thing__do ×2/);
});

test("a still-running sibling tool does not split the group", () => {
  clearMessages();
  addResult("Read", { file_path: "a.ts" });
  // Parallel batch: a second tool is still streaming when the first result lands.
  createToolProgressMessage("call-live", "Bash", { command: "sleep 1" });
  addResult("Read", { file_path: "b.ts" });

  const groups = getMessages().filter((m) => m.component instanceof ToolGroupMessage);
  assert.equal(groups.length, 1);
  assert.equal((groups[0]!.component as ToolGroupMessage).size, 2);
});

test("an assistant reply seals the group, so the next call starts a new one", () => {
  clearMessages();
  addResult("Read", { file_path: "a.ts" });
  createAssistantMessage("done");
  addResult("Read", { file_path: "b.ts" });

  const groups = getMessages().filter((m) => m.component instanceof ToolGroupMessage);
  assert.equal(groups.length, 2);
  assert.equal((groups[0]!.component as ToolGroupMessage).isSealed, true);
});

test("ambient system notices do not split a run into one group per call", () => {
  clearMessages();
  addResult("Bash", { command: "ls" });
  // Every turn emits a cache-status line between tool calls.
  createSystemMessage("*Prompt cache hit: 13,440 tokens read*");
  addResult("Bash", { command: "pwd" });
  createSystemMessage("⚠ **Prompt-cache miss**");
  addResult("Read", { file_path: "a.ts" });
  sealToolGroups();

  const groups = getMessages().filter((m) => m.component instanceof ToolGroupMessage);
  assert.equal(groups.length, 1);
  assert.match(
    plain((groups[0]!.component as ToolGroupMessage).render(80)),
    /Ran 2 commands, Read 1 file/,
  );
});

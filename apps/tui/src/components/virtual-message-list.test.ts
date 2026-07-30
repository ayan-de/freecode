import assert from "node:assert/strict";
import test from "node:test";
import { clearMessages, addMessage } from "../state/message-store.js";
import { VirtualMessageList } from "./virtual-message-list.js";

function addLines(count: number, prefix = "line"): void {
  const lines = Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
  addMessage("system", lines.join("\n"), {
    render: () => lines,
    invalidate: () => {},
  });
}

test("follow mode renders all lines when content fits the viewport", () => {
  clearMessages();
  addLines(5);
  const list = new VirtualMessageList(100, () => 10);

  const out = list.render(80);
  assert.equal(out.length, 5);
  assert.equal(list.isScrolled, false);
  list.destroy();
});

test("scrollPageUp windows tall content and reserves the indicator row", () => {
  clearMessages();
  addLines(50);
  const list = new VirtualMessageList(100, () => 10);
  list.render(80); // establish line count

  list.scrollPageUp();
  assert.equal(list.isScrolled, true);

  const out = list.render(80);
  // 9 content rows + 1 indicator row = viewport of 10. The indicator text is
  // commented out, but the row is still reserved to keep the height stable.
  assert.equal(out.length, 10);
  assert.equal(out[9], "");
  // One page (8 lines) above the bottom window: window starts at 50-9-8=33
  assert.match(out[0], /line-33/);
  list.destroy();
});

test("scrollPageUp clamps at the top", () => {
  clearMessages();
  addLines(20);
  const list = new VirtualMessageList(100, () => 10);
  list.render(80);

  for (let i = 0; i < 10; i++) list.scrollPageUp();
  const out = list.render(80);
  assert.match(out[0], /line-0/);
  assert.equal(out[9], "");
  list.destroy();
});

test("scrollPageDown past the bottom returns to follow mode", () => {
  clearMessages();
  addLines(30);
  const list = new VirtualMessageList(100, () => 10);
  list.render(80);

  list.scrollPageUp();
  assert.equal(list.isScrolled, true);
  list.scrollPageDown();
  assert.equal(list.isScrolled, false);

  const out = list.render(80);
  assert.equal(out.length, 30);
  list.destroy();
});

test("scrollToBottom resets to follow mode", () => {
  clearMessages();
  addLines(30);
  const list = new VirtualMessageList(100, () => 10);
  list.render(80);

  list.scrollPageUp();
  list.scrollPageUp();
  assert.equal(list.isScrolled, true);
  list.scrollToBottom();
  assert.equal(list.isScrolled, false);
  list.destroy();
});

test("scrolled window stays anchored while new messages stream in", () => {
  clearMessages();
  addLines(40);
  const list = new VirtualMessageList(100, () => 10);
  list.render(80);

  list.scrollPageUp();
  const before = list.render(80);

  addLines(10, "new");
  const after = list.render(80);
  // Same first visible line — reading position is stable.
  assert.equal(after[0], before[0]);
  // Height is unchanged by the extra content below.
  assert.equal(after.length, before.length);
  list.destroy();
});

test("scrolling does nothing when content fits the viewport", () => {
  clearMessages();
  addLines(4);
  const list = new VirtualMessageList(100, () => 10);
  list.render(80);

  list.scrollPageUp();
  assert.equal(list.isScrolled, false);
  assert.equal(list.render(80).length, 4);
  list.destroy();
});

test("resolveLogicalPosition resolves a screen row to a stable logical line index", () => {
  clearMessages();
  addLines(5);
  const list = new VirtualMessageList(100, () => 10);
  list.render(80);
  const pos = list.resolveLogicalPosition(5, 2);
  assert.notEqual(pos, null);
  assert.equal(typeof pos!.lineIndex, "number");
  assert.equal(typeof pos!.column, "number");
  list.destroy();
});

test("resolveLogicalPosition returns null for clicks below the last rendered line", () => {
  clearMessages();
  addLines(5);
  const list = new VirtualMessageList(100, () => 10);
  list.render(80);
  const pos = list.resolveLogicalPosition(5, 999);
  assert.equal(pos, null);
  list.destroy();
});

test("getLineAt returns the same logical line before and after a scroll", () => {
  clearMessages();
  addLines(40);
  const list = new VirtualMessageList(100, () => 5);
  list.render(80);
  const before = list.resolveLogicalPosition(0, 1);
  const lineBefore = list.getLineAt(before!.lineIndex);
  list.scrollPageUp();
  list.render(80);
  // The same logical line index still yields the same text after scrolling,
  // even though it's no longer at screen row 1 — the scroll-invariance
  // guarantee resolveLogicalPosition/getLineAt exist for.
  assert.equal(list.getLineAt(before!.lineIndex), lineBefore);
  list.destroy();
});

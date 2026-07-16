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

test("scrollPageUp windows tall content and adds an indicator", () => {
  clearMessages();
  addLines(50);
  const list = new VirtualMessageList(100, () => 10);
  list.render(80); // establish line count

  list.scrollPageUp();
  assert.equal(list.isScrolled, true);

  const out = list.render(80);
  // 9 content rows + 1 indicator row = viewport of 10
  assert.equal(out.length, 10);
  assert.match(out[9], /above/);
  assert.match(out[9], /below/);
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
  assert.match(out[9], /↑ 0 lines above/);
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
  // Indicator reflects the extra content below.
  assert.match(after[9], /↓ 18 below/);
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

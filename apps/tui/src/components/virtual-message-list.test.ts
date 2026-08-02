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
  // Padded to content+1 so the editor (rendered below) bottom-anchors to a
  // stable row instead of floating right under a short history. See the
  // bottom-anchor note in virtual-message-list.render().
  assert.equal(out.length, 10);
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

  // Follow mode tail-anchors to (content + 1) rows so the rendered height
  // matches scrolled mode and the editor doesn't jump when the user pages
  // back to the bottom.
  const out = list.render(80);
  assert.equal(out.length, 10);
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
  // Padded to content+1 for bottom-anchoring — same reason as the other
  // follow-mode test.
  assert.equal(list.render(80).length, 10);
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

/**
 * A message whose rendered text can be changed in place, and that counts how
 * often it was asked to render — lets the cache be observed from outside.
 */
function addCounted(text: string): { renders: number; text: string; id: number } {
  const spy = { renders: 0, text, id: 0 };
  const msg = addMessage("system", text, {
    render: () => {
      spy.renders++;
      return [spy.text];
    },
    invalidate: () => {},
  });
  spy.id = msg.id;
  return spy;
}

test("settled messages are rendered once, not on every frame", () => {
  clearMessages();
  const old = addCounted("old");
  addLines(60, "filler");
  const list = new VirtualMessageList(100, () => 10);

  list.render(80);
  const afterFirst = old.renders;
  for (let i = 0; i < 20; i++) list.render(80);

  // The message sits far above the viewport; re-rendering it 20 more times is
  // the cost that made long conversations crawl.
  assert.equal(old.renders, afterFirst);
  list.destroy();
});

test("messages in the live tail are re-rendered every frame", () => {
  clearMessages();
  addLines(60, "filler");
  const tail = addCounted("tail");
  const list = new VirtualMessageList(100, () => 10);

  list.render(80);
  const afterFirst = tail.renders;
  list.render(80);
  list.render(80);

  // Streaming text and tool progress mutate in place with no store event, so
  // the tail must never be served from the cache.
  assert.equal(tail.renders, afterFirst + 2);
  list.destroy();
});

test("a widened terminal re-renders cached messages at the new width", () => {
  clearMessages();
  const old = addCounted("old");
  addLines(60, "filler");
  const list = new VirtualMessageList(100, () => 10);

  list.render(80);
  const afterFirst = old.renders;
  list.render(120);

  assert.equal(old.renders, afterFirst + 1);
  list.destroy();
});

test("invalidateMessage picks up a change to a settled message", () => {
  clearMessages();
  const old = addCounted("before");
  addLines(60, "filler");
  const list = new VirtualMessageList(100, () => 10);
  list.render(80);

  // Toggling a collapsed thinking/tool row mutates it without a store event.
  old.text = "after";
  assert.equal(list.getLineAt(0), "before");

  list.invalidateMessage(old.id);
  list.render(80);
  assert.equal(list.getLineAt(0), "after");
  list.destroy();
});

test("cached lines match an uncached render, scrolled and following", () => {
  clearMessages();
  addLines(200, "content");
  const cached = new VirtualMessageList(100, () => 10);
  const uncached = new VirtualMessageList(100, () => 10);
  // Defeat the cache so this list always renders every message, the way the
  // list behaved before caching existed.
  (uncached as unknown as { renderCache: Map<number, unknown> }).renderCache = {
    get: () => undefined,
    set: () => {},
    delete: () => {},
    keys: () => [],
    size: 0,
  } as never;

  for (let i = 0; i < 5; i++) {
    cached.render(80);
    uncached.render(80);
  }
  assert.deepEqual(cached.render(80), uncached.render(80));

  for (let i = 0; i < 7; i++) {
    cached.scrollPageUp();
    uncached.scrollPageUp();
  }
  assert.deepEqual(cached.render(80), uncached.render(80));

  cached.scrollToBottom();
  uncached.scrollToBottom();
  assert.deepEqual(cached.render(80), uncached.render(80));

  cached.destroy();
  uncached.destroy();
});

test("the cache does not outlive the messages it describes", () => {
  clearMessages();
  for (let i = 0; i < 40; i++) addLines(4, `first-${i}`);
  const list = new VirtualMessageList(100, () => 10);
  list.render(80);
  const cache = (list as unknown as { renderCache: Map<number, unknown> })
    .renderCache;
  assert.equal(cache.size, 40);

  clearMessages();
  for (let i = 0; i < 3; i++) addLines(4, `second-${i}`);
  list.render(80);

  // Entries for dropped messages go with them, so the cache tracks the
  // history rather than growing for the life of the process.
  assert.equal(cache.size, 3);
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

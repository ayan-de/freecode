import assert from "node:assert/strict";
import test from "node:test";
import {
  clearMessages,
  addMessage,
  setActivePromptIndex,
  getActivePromptIndex,
  getPromptCount,
  getMessages,
  removeMessage,
  setMessagePromptIndex,
  promoteQueuedMessage,
} from "../state/message-store.js";
import chalk from "chalk";
import stripAnsi from "strip-ansi";
import { isKeyRelease, Key, matchesKey } from "@earendil-works/pi-tui";
import { PromptTabStrip, stepTab } from "./prompt-tab-strip.js";

test("tab strip renders zero rows when no prompts have been submitted", () => {
  clearMessages();
  const strip = new PromptTabStrip();
  assert.equal(strip.height(), 0);
  assert.equal(strip.getTabCount(), 0);
  assert.equal(strip.getActiveTab(), undefined);
  assert.deepEqual(strip.render(80), []);
  strip.destroy();
});

test("each new user prompt adds one tab and auto-switches to it", () => {
  clearMessages();
  const strip = new PromptTabStrip();
  strip.render(80); // initial paint so the subscriber has a snapshot

  addMessage("user", "p1", {
    render: () => ["p1"],
    invalidate: () => {},
  });
  assert.equal(strip.getTabCount(), 1);
  assert.equal(strip.getActiveTab(), 1);

  addMessage("user", "p2", {
    render: () => ["p2"],
    invalidate: () => {},
  });
  assert.equal(strip.getTabCount(), 2);
  // Auto-switched to the new prompt's tab.
  assert.equal(strip.getActiveTab(), 2);
  strip.destroy();
});

test("rendered tabs show a filled square for the active tab and digits for the rest", () => {
  clearMessages();
  addMessage("user", "p1", { render: () => ["p1"], invalidate: () => {} });
  addMessage("user", "p2", { render: () => ["p2"], invalidate: () => {} });
  addMessage("user", "p3", { render: () => ["p3"], invalidate: () => {} });

  const strip = new PromptTabStrip();
  // Active is auto-set to the latest prompt (3).
  const labels = strip.getTabLabels();
  assert.deepEqual(labels, ["1", "2", "■"]);
  strip.destroy();
});

test("setActiveTab switches tabs via the store", () => {
  clearMessages();
  addMessage("user", "p1", { render: () => ["p1"], invalidate: () => {} });
  addMessage("user", "p2", { render: () => ["p2"], invalidate: () => {} });
  addMessage("user", "p3", { render: () => ["p3"], invalidate: () => {} });

  const strip = new PromptTabStrip();
  // Auto-active is tab 3.
  assert.equal(strip.getActiveTab(), 3);

  strip.setActiveTab(1);
  // Subscriber re-reads from the store; refresh by rendering once so
  // the strip's cached `active` catches up to the store notification.
  strip.render(80);
  assert.equal(strip.getActiveTab(), 1);
  assert.equal(getActivePromptIndex(), 1);

  // Out-of-range indices are ignored (no tab to switch to).
  strip.setActiveTab(99);
  strip.render(80);
  assert.equal(strip.getActiveTab(), 1);
  strip.destroy();
});

test("click on a tab switches to it via handleClick", () => {
  clearMessages();
  addMessage("user", "p1", { render: () => ["p1"], invalidate: () => {} });
  addMessage("user", "p2", { render: () => ["p2"], invalidate: () => {} });
  addMessage("user", "p3", { render: () => ["p3"], invalidate: () => {} });

  const strip = new PromptTabStrip();
  strip.render(80); // populate tabColumns

  // Tab 1 sits at column 2 (after the "│ " prefix and one leading space),
  // tab 2 at column 4, tab 3 at column 6.
  // Click somewhere inside the active tab's hit zone first to confirm
  // it's owned by the strip.
  assert.equal(strip.handleClick(2, 1), true);
  assert.equal(getActivePromptIndex(), 1);

  // Click on tab 2's slot.
  assert.equal(strip.handleClick(4, 1), true);
  assert.equal(getActivePromptIndex(), 2);
  strip.destroy();
});

test("click outside the strip's hit zone returns false", () => {
  clearMessages();
  addMessage("user", "p1", { render: () => ["p1"], invalidate: () => {} });

  const strip = new PromptTabStrip();
  strip.render(80);
  // Far column — past the end of the strip.
  assert.equal(strip.handleClick(120, 1), false);
  strip.destroy();
});

test("getPromptCount and getActivePromptIndex track the store", () => {
  clearMessages();
  assert.equal(getPromptCount(), 0);
  assert.equal(getActivePromptIndex(), undefined);

  addMessage("user", "p1", { render: () => ["p1"], invalidate: () => {} });
  assert.equal(getPromptCount(), 1);
  assert.equal(getActivePromptIndex(), 1);

  setActivePromptIndex(1);
  assert.equal(getActivePromptIndex(), 1);

  // Out-of-range set is a no-op.
  setActivePromptIndex(99);
  assert.equal(getActivePromptIndex(), 1);
});

test("unselected page numbers render dim yellow, the active marker full yellow", () => {
  clearMessages();
  addMessage("user", "p1", { render: () => ["p1"], invalidate: () => {} });
  addMessage("user", "p2", { render: () => ["p2"], invalidate: () => {} });

  const strip = new PromptTabStrip();
  const [line] = strip.render(80);
  assert.ok(line);
  // chalk is force-disabled in some CI environments; only assert colour
  // when it is actually emitting escapes.
  if (chalk.level > 0) {
    assert.ok(
      line.includes(chalk.yellow.dim("1")),
      "inactive page number should be dim yellow",
    );
    assert.ok(
      line.includes(chalk.yellow("■")),
      "active marker should be full yellow",
    );
  }
  // Colour never changes the visible text.
  assert.equal(stripAnsi(line), "│ 1 ■");
  strip.destroy();
});

test("stepTab moves one tab at a time and wraps at both ends", () => {
  assert.equal(stepTab(2, 3, "prev"), 1);
  assert.equal(stepTab(2, 3, "next"), 3);
  // Wrap.
  assert.equal(stepTab(1, 3, "prev"), 3);
  assert.equal(stepTab(3, 3, "next"), 1);
  // Single tab: both directions stay put.
  assert.equal(stepTab(1, 1, "prev"), 1);
  assert.equal(stepTab(1, 1, "next"), 1);
  // No tabs: nothing to move to.
  assert.equal(stepTab(undefined, 0, "next"), undefined);
  assert.equal(stepTab(1, 0, "prev"), undefined);
  // No active tab yet: prev enters at the first, next at the last.
  assert.equal(stepTab(undefined, 3, "prev"), 3);
  assert.equal(stepTab(undefined, 3, "next"), 1);
});

// Regression: the Kitty keyboard protocol (pi-tui negotiates flags=7,
// "report event types" included) sends a release event for every key,
// and matchesKey() matches it exactly like the press. The tab handler in
// index.ts therefore has to skip releases — without the guard one
// keypress stepped twice, skipping every other prompt page.
test("shift+arrow release events look identical to presses to matchesKey", () => {
  const press = "\x1b[1;2D";
  const release = "\x1b[1;2:3D";

  assert.equal(matchesKey(press, Key.shift("left")), true);
  assert.equal(isKeyRelease(press), false);

  assert.equal(matchesKey(release, Key.shift("left")), true);
  assert.equal(isKeyRelease(release), true);

  // Auto-repeat (holding the key) must still navigate, so the guard
  // checks isKeyRelease and not "is this a bare press".
  assert.equal(isKeyRelease("\x1b[1;2:2D"), false);
});

test("queued-prompt collapse keeps tab indices contiguous", () => {
  clearMessages();
  // p1: regular user, no queueing.
  addMessage("user", "p1", { render: () => ["p1"], invalidate: () => {} });
  addMessage("assistant", "a1", {
    render: () => ["a1"],
    invalidate: () => {},
  });

  // Replicate the slower race: optimistic user added first, queued_user
  // arrives second (so the queued_user inherits the next index — 3),
  // then the optimistic user is removed and the queued_user renumbered
  // back into the freed slot (2).
  addMessage("user", "p2-opt", {
    render: () => ["p2opt"],
    invalidate: () => {},
  });
  const queued = addMessage("queued_user", "p2-queued", {
    render: () => ["p2q"],
    invalidate: () => {},
  });
  const optRow = getMessages().find((m) => m.content === "p2-opt");
  if (optRow) removeMessage(optRow.id);

  // After the remove: queued_user still carries index 3 (the index it
  // got while the optimistic user was counted). Index 2 is now empty.
  assert.equal(queued.promptIndex, 3);
  assert.equal(getPromptCount(), 3);

  // submitPrompt's queued branch renumbers the queued_user into the
  // freed slot so the tab strip doesn't show a hole at tab 2.
  setMessagePromptIndex(queued.id, 2);
  assert.equal(queued.promptIndex, 2);
  assert.equal(getPromptCount(), 2);

  // Tab 2 is reachable after the renumber.
  setActivePromptIndex(2);
  assert.equal(getActivePromptIndex(), 2);
});

// A prompt typed while a turn is running parks at the end of the
// transcript without starting a turn. Until core says its turn began,
// the running turn's output must keep landing on the running turn's
// page — inheriting from the queued row put turn 1's answer on page 2
// and left page 1 looking unanswered.
test("a queued prompt does not capture the running turn's output", () => {
  clearMessages();
  const comp = { render: () => ["x"], invalidate: () => {} };

  addMessage("user", "p1", comp);
  addMessage("in_progress", "working", comp);
  const queued = addMessage("queued_user", "p2", comp, "q1");

  // Turn 1 is still streaming: its output belongs to page 1.
  assert.equal(addMessage("tool", "read", comp).promptIndex, 1);
  assert.equal(addMessage("assistant", "a1", comp).promptIndex, 1);
  assert.equal(queued.promptIndex, 2);

  // Both pages exist and are reachable.
  assert.equal(getPromptCount(), 2);
  setActivePromptIndex(1);
  assert.equal(getActivePromptIndex(), 1);
});

test("message_started promotes the queued row and moves output to its page", () => {
  clearMessages();
  const comp = { render: () => ["x"], invalidate: () => {} };

  addMessage("user", "p1", comp);
  const queued = addMessage("queued_user", "p2", comp, "q1");
  addMessage("assistant", "a1", comp); // still turn 1
  setActivePromptIndex(1);

  // Core drains the queue and reports the turn started.
  const promoted = promoteQueuedMessage(queued.id, comp);
  assert.equal(promoted?.type, "user");
  assert.equal(promoted?.promptIndex, 2);
  assert.equal(promoted?.queueId, "q1", "queueId survives the promotion");
  // The view follows the turn that is now running.
  assert.equal(getActivePromptIndex(), 2);

  // Everything from here belongs to the promoted prompt's page.
  assert.equal(addMessage("assistant", "a2", comp).promptIndex, 2);
  assert.equal(getPromptCount(), 2);

  // Promoting twice is a no-op — the row is no longer queued.
  assert.equal(promoteQueuedMessage(queued.id, comp), undefined);
});

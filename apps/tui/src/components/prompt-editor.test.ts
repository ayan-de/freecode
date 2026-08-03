// =============================================================================
// Tests for the prompt-editor history indicator helpers (pure functions).
// The full PromptEditor needs a pi-tui TUI + Terminal which is heavy to set
// up in node:test, so the render math lives in two exported functions and
// is covered here directly.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import stripAnsi from "strip-ansi";

import {
  buildHistoryBorder,
  formatHistoryIndicator,
} from "./prompt-editor.js";

const IDENTITY = (s: string) => s;
const TAG = (s: string) => `<${s}>`;

test("formatHistoryIndicator: returns null when not browsing history", () => {
  assert.equal(formatHistoryIndicator(-1, 12), null);
  assert.equal(formatHistoryIndicator(-1, 0), null);
});

test("formatHistoryIndicator: returns null when the ring is empty", () => {
  assert.equal(formatHistoryIndicator(0, 0), null);
  // Defensive: forced into the "browsing" branch with total=0 still no-ops.
  assert.equal(formatHistoryIndicator(2, 0), null);
});

test("formatHistoryIndicator: 1-based from the most recent entry", () => {
  assert.equal(formatHistoryIndicator(0, 5), "[1/5]");
  assert.equal(formatHistoryIndicator(2, 12), "[3/12]");
  assert.equal(formatHistoryIndicator(7, 100), "[8/100]");
});

test("buildHistoryBorder: total visible width matches the requested width", () => {
  const line = buildHistoryBorder("[3/12]", 40, IDENTITY);
  assert.equal(stripAnsi(line).length, 40);
});

test("buildHistoryBorder: indicator sits just after the leading dashes", () => {
  const line = stripAnsi(buildHistoryBorder("[3/12]", 30, IDENTITY));
  // Two leading dashes per the default, then the indicator with its padding.
  assert.equal(line.startsWith("── [3/12] "), true);
});

test("buildHistoryBorder: indicator is preserved even on a too-narrow border", () => {
  const line = stripAnsi(buildHistoryBorder("[3/12]", 4, IDENTITY));
  // Width 4 leaves no room for the leading dashes, but the indicator is
  // what the user is looking for, so it stays visible — same trade-off
  // pi-tui's `↓ N more` indicator makes on the base border.
  assert.equal(line.includes("[3/12]"), true);
});

test("buildHistoryBorder: routes through borderColor so ANSI is consistent", () => {
  const line = buildHistoryBorder("[3/12]", 30, TAG);
  // The whole line is wrapped in a single <…> pair — never split across
  // the indicator, since section-level coloring would leak the reset code
  // into the middle of the dashes.
  const expectedDashes = 30 - 2 /*leading*/ - 8 /*' [3/12] '*/;
  assert.equal(line, `<── [3/12] ${"─".repeat(expectedDashes)}>`);
});

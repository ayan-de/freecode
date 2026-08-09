import test from "node:test";
import assert from "node:assert/strict";
import { formatHarnessStateForPrompt } from "./inject.js";
import { emptyHarnessState } from "./store.js";
import type { HarnessEntry } from "./types.js";

function entry(overrides: Partial<HarnessEntry> = {}): HarnessEntry {
  return {
    id: "note",
    kind: "prompt",
    title: "A note",
    content: "Some durable content",
    path: "general",
    scope: "global",
    reference: {},
    arguments: {},
    metadata: {},
    source: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

test("an empty harness state renders to an empty string", () => {
  assert.equal(formatHarnessStateForPrompt(emptyHarnessState()), "");
});

test("a single entry renders its title and content", () => {
  const state = emptyHarnessState();
  state.entries.prompt["note"] = entry();
  const text = formatHarnessStateForPrompt(state);
  assert.ok(text.includes("A note"));
  assert.ok(text.includes("Some durable content"));
  assert.ok(text.includes("[global:note]"));
});

test("content longer than maxContentLength is truncated with an ellipsis", () => {
  const state = emptyHarnessState();
  state.entries.prompt["note"] = entry({ content: "x".repeat(500) });
  const text = formatHarnessStateForPrompt(state, { maxContentLength: 50 });
  const line = text.split("\n").find((l) => l.includes("A note"));
  assert.ok(line);
  assert.ok(line.length < 120, `line too long: ${line.length} chars`);
  assert.ok(line.includes("..."));
});

test("entries beyond maxEntriesPerKind are capped and the overflow is counted, not silently dropped", () => {
  const state = emptyHarnessState();
  for (let i = 0; i < 10; i++) {
    state.entries.prompt[`note-${i}`] = entry({
      id: `note-${i}`,
      title: `Note ${i}`,
    });
  }
  const text = formatHarnessStateForPrompt(state, { maxEntriesPerKind: 3 });
  const bulletLines = text.split("\n").filter((l) => l.startsWith("- ["));
  assert.equal(bulletLines.length, 3);
  assert.ok(text.includes("+7 more prompt entries"));
});

test("total injected size stays bounded for a maximally full harness (budget assertion)", () => {
  const state = emptyHarnessState();
  for (const kind of ["prompt", "memory", "skill", "subagent"] as const) {
    for (let i = 0; i < 50; i++) {
      state.entries[kind][`${kind}-${i}`] = entry({
        id: `${kind}-${i}`,
        kind,
        title: `${kind} entry ${i} with a moderately long title to be realistic`,
        content: "y".repeat(1000), // far above the 180-char cap
      });
    }
  }
  const text = formatHarnessStateForPrompt(state);
  // Uncapped, this fixture would inject 4 kinds x 50 entries x 1000-char
  // content ~= 200,000 chars. Capped, it's 4 x 6 x (title + 180-char content)
  // plus headers/overflow lines, ~7,000. The bound below sits well above the
  // real capped size (so wording tweaks to the fixed header don't break it)
  // and well below the uncapped size (so a real cap regression still fails
  // loudly) — the ratio between the two, not either number alone, is the
  // point of this assertion.
  assert.ok(
    text.length < 10_000,
    `injected harness block grew unbounded: ${text.length} chars`,
  );
});

test("recent refinements are capped to maxRefinements and rendered oldest kept last", () => {
  const state = emptyHarnessState();
  state.entries.prompt["note"] = entry();
  for (let i = 0; i < 10; i++) {
    state.refinements.push({
      id: `r${i}`,
      trigger: `trigger ${i}`,
      changes: [],
      evidence: "",
      outcome: "",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }
  const text = formatHarnessStateForPrompt(state, { maxRefinements: 2 });
  assert.ok(text.includes("[r8]"));
  assert.ok(text.includes("[r9]"));
  assert.ok(!text.includes("[r0]"));
});

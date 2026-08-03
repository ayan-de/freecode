// =============================================================================
// Tests for prompt history persistence.
// Exercises the JSONL read/write contract that the TUI's PromptEditor
// depends on for cross-session up-arrow recall.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  appendHistory,
  readHistory,
  readHistoryDisplays,
  getHistoryFilePath,
  MAX_HISTORY_ITEMS,
} from "./store.js";

// Each test gets its own temp HOME so writes never leak between them.
function freshHome(): { home: string; restore: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-history-"));
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    home,
    restore: () => {
      process.env.HOME = prevHome;
      if (prevProfile !== undefined) process.env.USERPROFILE = prevProfile;
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test("history store: empty when no file exists", () => {
  const { restore } = freshHome();
  try {
    assert.deepEqual(readHistory(), []);
    assert.deepEqual(readHistoryDisplays(), []);
  } finally {
    restore();
  }
});

test("history store: appends newest-first", () => {
  const { restore } = freshHome();
  try {
    appendHistory("first prompt");
    appendHistory("second prompt");
    assert.deepEqual(readHistoryDisplays(), ["second prompt", "first prompt"]);
  } finally {
    restore();
  }
});

test("history store: trims whitespace before storing", () => {
  const { restore } = freshHome();
  try {
    appendHistory("  hello world  ");
    assert.deepEqual(readHistoryDisplays(), ["hello world"]);
  } finally {
    restore();
  }
});

test("history store: ignores empty submissions", () => {
  const { restore } = freshHome();
  try {
    appendHistory("   ");
    appendHistory("");
    assert.deepEqual(readHistory(), []);
  } finally {
    restore();
  }
});

test("history store: dedupes consecutive duplicates", () => {
  const { restore } = freshHome();
  try {
    appendHistory("same");
    appendHistory("same");
    appendHistory("different");
    appendHistory("same"); // not consecutive with the previous — should be allowed
    assert.deepEqual(readHistoryDisplays(), [
      "same",
      "different",
      "same",
    ]);
  } finally {
    restore();
  }
});

test("history store: caps at MAX_HISTORY_ITEMS by dropping oldest", () => {
  const { restore } = freshHome();
  try {
    for (let i = 0; i < MAX_HISTORY_ITEMS + 5; i++) {
      appendHistory(`prompt ${i}`);
    }
    const items = readHistoryDisplays();
    assert.equal(items.length, MAX_HISTORY_ITEMS);
    assert.equal(items[0], `prompt ${MAX_HISTORY_ITEMS + 4}`);
    assert.equal(items.at(-1), `prompt 5`);
  } finally {
    restore();
  }
});

test("history store: persists across read calls", () => {
  const { restore } = freshHome();
  try {
    appendHistory("persistent");
    assert.deepEqual(readHistoryDisplays(), readHistoryDisplays());
  } finally {
    restore();
  }
});

test("history store: tolerates a corrupt line without losing the rest", () => {
  const { restore } = freshHome();
  try {
    const file = getHistoryFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ display: "first", timestamp: 1 }),
        "{ this is not json",
        JSON.stringify({ display: "second", timestamp: 2 }),
        "", // trailing newline
      ].join("\n"),
      "utf-8",
    );
    assert.deepEqual(readHistoryDisplays(), ["second", "first"]);
  } finally {
    restore();
  }
});

test("history store: timestamps are numbers on disk", () => {
  const { restore } = freshHome();
  try {
    appendHistory("with timestamp");
    const entry = readHistory()[0];
    assert.equal(typeof entry?.timestamp, "number");
    assert.ok((entry?.timestamp ?? 0) > 0);
  } finally {
    restore();
  }
});

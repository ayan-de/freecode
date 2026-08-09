import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  shouldExtract,
  resetExtractPolicy,
  DEFAULT_INTERVAL_RUNS,
} from "./extract-policy.js";

const ENV_KEY = "FREECODE_DISABLE_MEMORY_EXTRACTION";

function project(settings?: Record<string, unknown>): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "extract-policy-"));
  if (settings) {
    mkdirSync(join(root, ".freecode"), { recursive: true });
    writeFileSync(
      join(root, ".freecode", "settings.json"),
      JSON.stringify(settings),
    );
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// A run substantial enough to clear the min-substance gate.
function run(root: string, sessionId: string, userText = "how does the agent loop work") {
  return shouldExtract({
    sessionId,
    projectRoot: root,
    transcript: `user: ${userText}\n\nassistant: ${"it works like this. ".repeat(20)}`,
    turns: 2,
    memoryToolUsed: false,
    userText,
  });
}

test("throttles to one extraction per interval, then resets", () => {
  const { root, cleanup } = project({ memory: { extractEveryNRuns: 3 } });
  resetExtractPolicy();
  try {
    assert.equal(run(root, "S").extract, false, "run 1");
    assert.equal(run(root, "S").extract, false, "run 2");
    assert.equal(run(root, "S").extract, true, "run 3 hits the interval");
    assert.equal(run(root, "S").extract, false, "counter reset after extracting");
  } finally {
    cleanup();
  }
});

test("a topic change extracts immediately, without waiting for the interval", () => {
  const { root, cleanup } = project();
  resetExtractPolicy();
  try {
    // No shared tokens: lexicalSimilarity counts stopwords, so a single "and"
    // in both prompts scores 0.125 and stays above the 0.12 threshold.
    assert.equal(run(root, "S", "authentication tokens refresh flow").extract, false);
    const switched = run(root, "S", "editor themes keybindings");
    assert.equal(switched.extract, true);
    assert.match(switched.reason, /topic/i);
  } finally {
    cleanup();
  }
});

test("skips when the model already used the memory tool, and resets the counter", () => {
  const { root, cleanup } = project({ memory: { extractEveryNRuns: 2 } });
  resetExtractPolicy();
  try {
    // Same userText throughout, so the topic gate stays quiet and this test
    // observes only the counter.
    const topic = "how does the agent loop work";
    run(root, "S", topic); // run 1
    const handled = shouldExtract({
      sessionId: "S",
      projectRoot: root,
      transcript: `user: ${topic}\n\nassistant: ${"like this. ".repeat(30)}`,
      turns: 2,
      memoryToolUsed: true,
      userText: topic,
    });
    assert.equal(handled.extract, false);
    assert.match(handled.reason, /already/i);
    // Counter was reset, so the next run is 1-of-2, not the interval hit.
    assert.equal(run(root, "S", topic).extract, false, "counter should have reset");
  } finally {
    cleanup();
  }
});

test("skips trivially short exchanges", () => {
  const { root, cleanup } = project({ memory: { extractEveryNRuns: 1 } });
  resetExtractPolicy();
  try {
    const short = shouldExtract({
      sessionId: "S",
      projectRoot: root,
      transcript: "user: fix typo\n\nassistant: done",
      turns: 2,
      memoryToolUsed: false,
      userText: "fix typo",
    });
    assert.equal(short.extract, false);
    assert.match(short.reason, /short|substance/i);
  } finally {
    cleanup();
  }
});

test("settings can turn extraction off entirely", () => {
  const { root, cleanup } = project({ memory: { autoExtract: false } });
  resetExtractPolicy();
  try {
    for (let i = 0; i < DEFAULT_INTERVAL_RUNS + 2; i++) {
      assert.equal(run(root, "S").extract, false, `run ${i + 1} must stay off`);
    }
  } finally {
    cleanup();
  }
});

test("the env var overrides settings and disables extraction", () => {
  const { root, cleanup } = project({ memory: { extractEveryNRuns: 1 } });
  resetExtractPolicy();
  process.env[ENV_KEY] = "1";
  try {
    const res = run(root, "S");
    assert.equal(res.extract, false);
    assert.match(res.reason, /disabled/i);
  } finally {
    delete process.env[ENV_KEY];
    cleanup();
  }
});

test("two sessions keep independent counters", () => {
  const { root, cleanup } = project({ memory: { extractEveryNRuns: 2 } });
  resetExtractPolicy();
  try {
    assert.equal(run(root, "A").extract, false);
    assert.equal(run(root, "B").extract, false);
    assert.equal(run(root, "A").extract, true, "A reaches its own interval");
    assert.equal(run(root, "B").extract, true, "B reaches its own interval");
  } finally {
    cleanup();
  }
});

test("an unreadable settings file leaves extraction enabled at defaults", () => {
  const { root, cleanup } = project();
  mkdirSync(join(root, ".freecode"), { recursive: true });
  writeFileSync(join(root, ".freecode", "settings.json"), "{ not json");
  resetExtractPolicy();
  try {
    for (let i = 0; i < DEFAULT_INTERVAL_RUNS - 1; i++) run(root, "S");
    assert.equal(
      run(root, "S").extract,
      true,
      "falls back to the default interval rather than failing closed or open",
    );
  } finally {
    cleanup();
  }
});

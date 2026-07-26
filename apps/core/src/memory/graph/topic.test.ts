import test from "node:test";
import assert from "node:assert/strict";
import { lexicalSimilarity } from "./index.js";

test("lexicalSimilarity is 1 for identical and 0 for disjoint text", () => {
  assert.equal(lexicalSimilarity("postgres analytics database", "postgres analytics database"), 1);
  assert.equal(lexicalSimilarity("postgres database", "neovim keybindings"), 0);
});

test("same-topic queries stay above the topic-change threshold (0.12)", () => {
  const sim = lexicalSimilarity(
    "which database do we use for analytics",
    "the database choice for the analytics service",
  );
  assert.ok(sim >= 0.12, `expected same-topic sim >= 0.12, got ${sim}`);
});

test("a topic switch falls below the threshold", () => {
  const sim = lexicalSimilarity(
    "which database are we using for analytics",
    "how do I configure neovim keybindings and tmux",
  );
  assert.ok(sim < 0.12, `expected topic-change sim < 0.12, got ${sim}`);
});

test("empty context is never similar", () => {
  assert.equal(lexicalSimilarity("", "anything at all"), 0);
});

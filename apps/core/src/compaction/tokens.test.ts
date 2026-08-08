import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokenCount,
  getContextLimit,
  getAutoCompactThreshold,
  getCompactTarget,
  shouldCompact,
  DEFAULT_COMPACT_TARGET_TOKENS,
} from "./tokens.js";

test("estimateTokenCount uses a conservative char estimate", () => {
  assert.equal(estimateTokenCount("Hello World"), 3);
});

test("getContextLimit returns the offline fallback floor", () => {
  assert.equal(getContextLimit("unknown-model"), 100_000);
  assert.equal(getContextLimit("gpt-4o"), 100_000);
});

test("getAutoCompactThreshold reserves compaction buffer", () => {
  assert.equal(getAutoCompactThreshold("gpt-4o", 13_000), 87_000);
});

test("shouldCompact uses the fallback limit when no explicit limit is given", () => {
  assert.equal(shouldCompact(86_999, "gpt-4o", 13_000), false);
  assert.equal(shouldCompact(87_000, "gpt-4o", 13_000), true);
});

test("shouldCompact prefers an explicit (models.dev) context limit", () => {
  // A window *below* the cost target still binds on its own: 100K model with a
  // 13K buffer → threshold 87K, well under the 120K target.
  assert.equal(shouldCompact(86_999, "gpt-4o", 13_000, 100_000), false);
  assert.equal(shouldCompact(87_000, "gpt-4o", 13_000, 100_000), true);
});

test("the cost target caps a window larger than it", () => {
  // Was: a 200K window meant a 187K threshold. Now the 120K target binds first,
  // so the threshold is 120K - 13K = 107K regardless of how big the window is.
  // This is the point of the change, not a regression — see RC1.
  for (const window of [200_000, 1_000_000]) {
    assert.equal(shouldCompact(106_999, "MiniMax-M3", 13_000, window), false);
    assert.equal(shouldCompact(107_000, "MiniMax-M3", 13_000, window), true);
  }
});

test("a 1M-window session at 270K now compacts (RC1 regression)", () => {
  // The exact shape of the leak: session 4ba54e41 peaked at 270K against
  // MiniMax-M3's ~968K usable window and never compacted once.
  assert.equal(shouldCompact(270_000, "MiniMax-M3", 13_000, 968_000), true);
});

test("FREECODE_COMPACT_TARGET_TOKENS overrides the cost target", () => {
  const original = process.env.FREECODE_COMPACT_TARGET_TOKENS;
  try {
    // Raising it past the window restores the old fit-only behaviour.
    process.env.FREECODE_COMPACT_TARGET_TOKENS = "500000";
    assert.equal(shouldCompact(270_000, "MiniMax-M3", 13_000, 968_000), false);
    assert.equal(getCompactTarget(), 500_000);

    // Lowering it compacts sooner, for a tighter quota.
    process.env.FREECODE_COMPACT_TARGET_TOKENS = "60000";
    assert.equal(shouldCompact(47_000, "MiniMax-M3", 13_000, 968_000), true);
    assert.equal(shouldCompact(46_999, "MiniMax-M3", 13_000, 968_000), false);
  } finally {
    if (original === undefined)
      delete process.env.FREECODE_COMPACT_TARGET_TOKENS;
    else process.env.FREECODE_COMPACT_TARGET_TOKENS = original;
  }
});

test("an unusable FREECODE_COMPACT_TARGET_TOKENS falls back to the default", () => {
  const original = process.env.FREECODE_COMPACT_TARGET_TOKENS;
  try {
    // A typo must not disable the target (never compact) or zero it (always).
    for (const bad of ["", "abc", "0", "-5"]) {
      process.env.FREECODE_COMPACT_TARGET_TOKENS = bad;
      assert.equal(getCompactTarget(), DEFAULT_COMPACT_TARGET_TOKENS, bad);
      assert.equal(
        shouldCompact(270_000, "MiniMax-M3", 13_000, 968_000),
        true,
        `bad value ${JSON.stringify(bad)} should fall back to the default target`,
      );
    }
  } finally {
    if (original === undefined)
      delete process.env.FREECODE_COMPACT_TARGET_TOKENS;
    else process.env.FREECODE_COMPACT_TARGET_TOKENS = original;
  }
});

test("FREECODE_AUTO_COMPACT_TOKENS still wins over the cost target", () => {
  const original = process.env.FREECODE_AUTO_COMPACT_TOKENS;
  try {
    // The test override short-circuits first, so a small value fires well
    // below the 107K the target would otherwise impose.
    process.env.FREECODE_AUTO_COMPACT_TOKENS = "15000";
    assert.equal(shouldCompact(20_000, "MiniMax-M3", 13_000, 968_000), true);
  } finally {
    if (original === undefined) delete process.env.FREECODE_AUTO_COMPACT_TOKENS;
    else process.env.FREECODE_AUTO_COMPACT_TOKENS = original;
  }
});

test("FREECODE_AUTO_COMPACT_TOKENS overrides the threshold for testing", () => {
  const original = process.env.FREECODE_AUTO_COMPACT_TOKENS;
  try {
    // Without it, 20k against a 1M window is nowhere near the threshold.
    delete process.env.FREECODE_AUTO_COMPACT_TOKENS;
    assert.equal(shouldCompact(20_000, "MiniMax-M3", 13_000, 1_000_000), false);

    // With it, the same count fires.
    process.env.FREECODE_AUTO_COMPACT_TOKENS = "15000";
    assert.equal(shouldCompact(20_000, "MiniMax-M3", 13_000, 1_000_000), true);
    assert.equal(shouldCompact(14_999, "MiniMax-M3", 13_000, 1_000_000), false);
  } finally {
    if (original === undefined) delete process.env.FREECODE_AUTO_COMPACT_TOKENS;
    else process.env.FREECODE_AUTO_COMPACT_TOKENS = original;
  }
});

test("an unusable FREECODE_AUTO_COMPACT_TOKENS is ignored, not obeyed", () => {
  const original = process.env.FREECODE_AUTO_COMPACT_TOKENS;
  try {
    // A typo must not disable compaction or force it on every turn.
    for (const bad of ["", "abc", "0", "-5"]) {
      process.env.FREECODE_AUTO_COMPACT_TOKENS = bad;
      assert.equal(
        shouldCompact(20_000, "MiniMax-M3", 13_000, 1_000_000),
        false,
        `bad value ${JSON.stringify(bad)} should fall back to the real threshold`,
      );
    }
  } finally {
    if (original === undefined) delete process.env.FREECODE_AUTO_COMPACT_TOKENS;
    else process.env.FREECODE_AUTO_COMPACT_TOKENS = original;
  }
});

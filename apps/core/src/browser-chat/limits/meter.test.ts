import test from "node:test";
import assert from "node:assert/strict";
import { ThreadMeter } from "./meter.js";
import { classifyLimit } from "./detect.js";
import { RateLimitedError, ThreadFullError } from "./errors.js";

test("the meter counts both directions", () => {
  const meter = new ThreadMeter();
  meter.noteSent("12345");
  meter.noteReceived("678");
  assert.equal(meter.totalChars, 8);
  assert.equal(meter.turnCount, 1);
});

test("rollover fires once the budget is reached", () => {
  const meter = new ThreadMeter();
  meter.noteSent("x".repeat(60));
  assert.equal(meter.shouldRollover(100), false);
  meter.noteReceived("y".repeat(40));
  assert.equal(meter.shouldRollover(100), true);
});

test("fillRatio is clamped so a blown budget still renders", () => {
  const meter = new ThreadMeter();
  meter.noteSent("x".repeat(500));
  assert.equal(meter.fillRatio(100), 1);
  assert.equal(new ThreadMeter().fillRatio(0), 1);
});

test("a full thread is rollable", () => {
  const decision = classifyLimit({
    type: "limit",
    kind: "thread_full",
    detail: "maximum length",
  });
  assert.equal(decision.rollable, true);
  assert.ok(decision.error instanceof ThreadFullError);
});

test("a usage limit is NOT rollable — a new chat shares the quota", () => {
  const decision = classifyLimit({
    type: "limit",
    kind: "rate_limited",
    detail: "out of messages",
    resetAt: Date.now() + 3600_000,
  });
  assert.equal(decision.rollable, false);
  assert.ok(decision.error instanceof RateLimitedError);
});

test("a reset time reaches the user-facing message", () => {
  const decision = classifyLimit({
    type: "limit",
    kind: "rate_limited",
    detail: "limit reached",
    resetAt: Date.now() + 3600_000,
  });
  assert.match(decision.error.message, /resets/);
});

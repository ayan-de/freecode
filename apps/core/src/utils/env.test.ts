import test from "node:test";
import assert from "node:assert/strict";
import { envInt } from "./env.js";

const KEY = "FREECODE_TEST_ENV_INT";

function withEnv(value: string | undefined, fn: () => void): void {
  const original = process.env[KEY];
  try {
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;
    fn();
  } finally {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  }
}

test("an EMPTY variable means unset, not zero", () => {
  // The whole reason this module exists. `Number("")` is 0 and
  // `Number.isFinite(0)` is true, so the old shape read an empty variable as a
  // deliberate zero: FREECODE_TOOL_RESULT_BUDGET_CHARS="" pruned every tool
  // result to a marker, and an empty eval timeout clamped five minutes to one
  // second.
  for (const blank of ["", " ", "\t", "\n", "   "]) {
    withEnv(blank, () => {
      assert.equal(envInt(KEY, 200_000, { min: 0 }), 200_000, blank);
    });
  }
});

test("an explicit zero is still honoured where zero is legal", () => {
  // "" and "0" must not be the same thing in either direction: 0 is a real
  // setting for the tool-result budget and the exit-flush budget.
  withEnv("0", () => assert.equal(envInt(KEY, 200_000, { min: 0 }), 0));
});

test("unset yields the fallback", () => {
  withEnv(undefined, () => assert.equal(envInt(KEY, 42), 42));
});

test("a valid integer is returned, surrounding whitespace tolerated", () => {
  withEnv("25000", () => assert.equal(envInt(KEY, 1), 25_000));
  withEnv("  25000  ", () => assert.equal(envInt(KEY, 1), 25_000));
  withEnv("-5", () => assert.equal(envInt(KEY, 1), -5));
});

test("garbage and non-integers fall back", () => {
  for (const bad of ["abc", "1e", "12px", "NaN", "Infinity", "1.5", "0x10"]) {
    withEnv(bad, () => assert.equal(envInt(KEY, 99), 99, bad));
  }
});

test("a value outside [min, max] falls back rather than being clamped", () => {
  // Clamping would silently honour a typo. A three-digit eval timeout is far
  // more likely to be a mistake than a request for a 0.3s budget, and the
  // fallback is the value the author actually reasoned about.
  withEnv("500", () =>
    assert.equal(envInt(KEY, 300_000, { min: 1_000 }), 300_000),
  );
  withEnv("999999", () => assert.equal(envInt(KEY, 10, { max: 100 }), 10));
  withEnv("50", () => assert.equal(envInt(KEY, 10, { min: 1, max: 100 }), 50));
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  AbError,
  classify,
  parseVariant,
  redactValue,
  redactVariant,
  trialOrder,
  VARIABLE_ENV_KEYS,
} from "./ab.js";

test("parses a model and env assignments", () => {
  const v = parseVariant(
    "model=anthropic/claude-sonnet-4-6,env:FREECODE_DISABLE_REDIRECT=1",
    "--x",
  );
  assert.equal(v.model, "anthropic/claude-sonnet-4-6");
  assert.deepEqual(v.env, { FREECODE_DISABLE_REDIRECT: "1" });
});

test("rejects an env key that is not re-read after the runner boots", () => {
  // The failure this prevents: the var is swapped into process.env, read by
  // nobody because it was consumed at init, and both sides run identically —
  // reported as a confident "unchanged" about an experiment that never
  // happened.
  assert.throws(
    () => parseVariant("env:ANTHROPIC_API_KEY=sk-x", "--candidate"),
    (e: Error) => e instanceof AbError && /not known to be re-read/.test(e.message),
  );
  assert.throws(() => parseVariant("env:PATH=/tmp", "--candidate"), AbError);
});

test("every allowlisted key is one a variant can actually move", () => {
  // Guards the list against drift: each name must still be spelled the way the
  // code that reads it spells it.
  for (const key of VARIABLE_ENV_KEYS) {
    assert.match(key, /^FREECODE_/);
    assert.doesNotThrow(() => parseVariant(`env:${key}=1`, "--x"));
  }
});

test("an empty spec is the identity variant", () => {
  // How you A/B one axis while leaving the other at whatever the config says.
  assert.deepEqual(parseVariant("", "--x"), { env: {} });
});

test("env:NAME= UNSETS the variable rather than setting it empty", () => {
  // Every isEnvTruthy-style reader in this codebase treats absent and "" the
  // same way today, but the distinction is real and has to be expressible.
  assert.deepEqual(parseVariant("env:FREECODE_DISABLE_REDIRECT=", "--x").env, {
    FREECODE_DISABLE_REDIRECT: undefined,
  });
});

test("rejects a spec that is not an assignment", () => {
  assert.throws(() => parseVariant("sonnet", "--candidate"), AbError);
  assert.throws(() => parseVariant("provider=x", "--candidate"), AbError);
  assert.throws(() => parseVariant("model=", "--candidate"), AbError);
  assert.throws(() => parseVariant("env:=1", "--candidate"), AbError);
});

test("the side that runs first alternates every trial", () => {
  // A fixed order silently advantages whichever side runs second, and with
  // prompt caching in play that advantage is not small.
  assert.deepEqual(trialOrder(0), ["baseline", "candidate"]);
  assert.deepEqual(trialOrder(1), ["candidate", "baseline"]);
  assert.deepEqual(trialOrder(2), ["baseline", "candidate"]);
});

test("credential-shaped env values never reach an artifact", () => {
  assert.equal(redactValue("ANTHROPIC_API_KEY", "sk-abc"), "[redacted]");
  assert.equal(redactValue("MY_TOKEN", "t"), "[redacted]");
  assert.equal(redactValue("db_password", "p"), "[redacted]");
  assert.equal(redactValue("FREECODE_DISABLE_REDIRECT", "1"), "1");
  assert.equal(redactValue("FOO", undefined), "<unset>");
});

test("a redacted variant keeps the shape a reader needs", () => {
  // Built directly rather than parsed: the allowlist now refuses a
  // credential-shaped key at parse time, but redaction still has to hold for
  // anything that reaches an artifact by another route.
  assert.deepEqual(
    redactVariant({
      model: "p/m",
      env: { OPENAI_API_KEY: "sk-x", FREECODE_DISABLE_REDIRECT: "1" },
    }),
    {
      model: "p/m",
      "env:OPENAI_API_KEY": "[redacted]",
      "env:FREECODE_DISABLE_REDIRECT": "1",
    },
  );
});

// --- classify --------------------------------------------------------------

const tally = (passed: number, ran = passed) => ({ passed, ran });

test("agreeing majorities are unchanged, either way", () => {
  assert.equal(classify(tally(3), tally(3), 3), "unchanged-pass");
  assert.equal(classify(tally(0, 3), tally(0, 3), 3), "unchanged-fail");
});

test("a two-trial gap with opposite majorities is a real verdict", () => {
  assert.equal(classify(tally(0, 3), tally(3), 3), "improved");
  assert.equal(classify(tally(3), tally(0, 3), 3), "regressed");
});

test("a ONE-trial gap is inconclusive, not a regression", () => {
  // At N=3 this is 2/3 vs 1/3 — exactly the resolution three trials cannot
  // support. Calling it a regression is how a green suite gets reverted for
  // nothing.
  assert.equal(classify(tally(2, 3), tally(1, 3), 3), "inconclusive");
  assert.equal(classify(tally(1, 3), tally(2, 3), 3), "inconclusive");
});

test("a single paired trial can never be conclusive", () => {
  // Whatever the two results were, one sample of a stochastic model is not
  // evidence about a change.
  assert.equal(classify(tally(1), tally(0, 1), 1), "inconclusive");
  assert.equal(classify(tally(1), tally(1), 1), "inconclusive");
});

test("an incomplete side is inconclusive, however the passes look", () => {
  // An infrastructure failure is not evidence about the change — reporting it
  // as an improvement is worse than reporting nothing.
  // Baseline managed only two of three trials; the third died before the agent
  // ran, so there is no third data point to pair against.
  assert.equal(classify(tally(0, 2), tally(3, 3), 3), "inconclusive");
  assert.equal(classify(tally(3, 3), tally(2, 2), 3), "inconclusive");
});

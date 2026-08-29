import test from "node:test";
import assert from "node:assert/strict";
import {
  AbError,
  classify,
  parseVariant,
  redactValue,
  redactVariant,
  trialOrder,
} from "./ab.js";

test("parses a model and env assignments", () => {
  const v = parseVariant("model=anthropic/claude-sonnet-4-6,env:FOO=1", "--x");
  assert.equal(v.model, "anthropic/claude-sonnet-4-6");
  assert.deepEqual(v.env, { FOO: "1" });
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
  const v = parseVariant("model=p/m,env:OPENAI_API_KEY=sk-x,env:DEBUG=1", "--x");
  assert.deepEqual(redactVariant(v), {
    model: "p/m",
    "env:OPENAI_API_KEY": "[redacted]",
    "env:DEBUG": "1",
  });
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

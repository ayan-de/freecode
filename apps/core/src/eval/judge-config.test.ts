import test from "node:test";
import assert from "node:assert/strict";
import { normaliseModel, resolveJudge, splitModelId } from "./judge-config.js";

function withEnv(
  env: Record<string, string | undefined>,
  fn: () => void,
): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("no configuration is a skip, not an error", () => {
  // A judged suite with no key must report `skipped` and leave the gate open.
  withEnv(
    { FREECODE_JUDGE_PROVIDER: undefined, FREECODE_JUDGE_MODEL: undefined },
    () => {
      const result = resolveJudge("minimax/MiniMax-M3");
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.reason, "unconfigured");
    },
  );
});

test("refuses when the judge IS the model under test", () => {
  // The whole point: a model grading itself measures self-similarity, and a
  // prompt change would move the answer and the grader together.
  withEnv(
    {
      FREECODE_JUDGE_PROVIDER: "minimax",
      FREECODE_JUDGE_MODEL: "MiniMax-M3",
    },
    () => {
      const result = resolveJudge("minimax/MiniMax-M3");
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.reason, "same-model");
    },
  );
});

test("refuses the same provider with no explicit judge model", () => {
  // It would fall back to that provider's default, which is very likely the
  // subject — the collision the id comparison would otherwise miss.
  withEnv(
    { FREECODE_JUDGE_PROVIDER: "minimax", FREECODE_JUDGE_MODEL: undefined },
    () => {
      const result = resolveJudge("minimax/MiniMax-M3");
      assert.equal(result.ok === false && result.reason, "same-model");
    },
  );
});

test("catches the same model reached through a different provider name", () => {
  // The gateway case: different route, same weights.
  withEnv(
    {
      FREECODE_JUDGE_PROVIDER: "openrouter",
      FREECODE_JUDGE_MODEL: "MiniMax-M3",
    },
    () => {
      const result = resolveJudge("minimax/MiniMax-M3");
      assert.equal(result.ok === false && result.reason, "same-model");
    },
  );
});

test("catches a dated snapshot of the model under test", () => {
  withEnv(
    {
      FREECODE_JUDGE_PROVIDER: "anthropic",
      FREECODE_JUDGE_MODEL: "claude-sonnet-4-5-20260101",
    },
    () => {
      const result = resolveJudge("anthropic/claude-sonnet-4-5");
      assert.equal(result.ok === false && result.reason, "same-model");
    },
  );
});

test("allows a genuinely different model", () => {
  withEnv(
    {
      FREECODE_JUDGE_PROVIDER: "anthropic",
      FREECODE_JUDGE_MODEL: "claude-haiku-4-5",
    },
    () => {
      const result = resolveJudge("minimax/MiniMax-M3");
      assert.equal(result.ok, true);
      assert.deepEqual(result.ok && result.judge, {
        provider: "anthropic",
        model: "claude-haiku-4-5",
      });
    },
  );
});

test("normaliseModel strips date snapshots and case", () => {
  assert.equal(normaliseModel("Claude-Sonnet-4-5-20260101"), "claude-sonnet-4-5");
  assert.equal(normaliseModel("gpt-4o"), "gpt-4o");
  assert.equal(normaliseModel(" MiniMax-M3 "), "minimax-m3");
});

test("splitModelId handles bare ids and provider-qualified ones", () => {
  assert.deepEqual(splitModelId("anthropic/claude-haiku-4-5"), {
    provider: "anthropic",
    model: "claude-haiku-4-5",
  });
  assert.deepEqual(splitModelId("gpt-4o"), { model: "gpt-4o" });
});

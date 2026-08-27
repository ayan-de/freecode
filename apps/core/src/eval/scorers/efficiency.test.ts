import assert from "node:assert/strict";
import { test } from "node:test";
import type { Trace } from "../../rollout/trace.js";
import type { SuiteReport, TrialResult } from "../types.js";
import {
  compareEfficiency,
  EFFICIENCY_WARN_DELTA,
  formatEfficiency,
  suiteEfficiency,
  trialEfficiency,
} from "./efficiency.js";

function trial(over: Partial<TrialResult> = {}): TrialResult {
  return {
    passed: true,
    reason: "ok",
    durationMs: 1000,
    inputTokens: 1000,
    outputTokens: 100,
    turns: 1,
    repeatedCalls: 0,
    redirects: 0,
    redirectsSkipped: 0,
    questionsRejected: 0,
    ...over,
  };
}

function report(trials: TrialResult[]): SuiteReport {
  return {
    suite: "t",
    ranAt: new Date().toISOString(),
    trials: trials.length,
    cases: [{ id: "a", trials, passed: true, consistent: true, quarantined: false }],
    passed: 1,
    total: 1,
  };
}

function trace(over: Partial<Trace> = {}): Trace {
  return {
    sessionId: "s",
    startedAt: 0,
    endedAt: 100,
    wall_ms: 100,
    modelSpans: [],
    toolSpans: [],
    model_ms: 0,
    tool_ms: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    hung: false,
    inFlight: false,
    redirects: 0,
    redirectsSkipped: 0,
    ...over,
  };
}

test("folds timing and cache figures the trace already carries", () => {
  const e = trialEfficiency(
    trace({
      model_ms: 8000,
      tool_ms: 1200,
      cacheReadTokens: 900,
      modelSpans: [
        { cacheWriteTokens: 100 },
        { cacheWriteTokens: 50 },
      ] as Trace["modelSpans"],
    }),
  );
  assert.equal(e.modelMs, 8000);
  assert.equal(e.toolMs, 1200);
  assert.equal(e.cacheReadTokens, 900);
  // No aggregate for writes on Trace, so it is summed off the spans.
  assert.equal(e.cacheWriteTokens, 150);
});

test("normalises per trial, so raising --trials is not a regression", () => {
  const one = suiteEfficiency(report([trial()]));
  const three = suiteEfficiency(report([trial(), trial(), trial()]));
  assert.equal(one.tokensPerTrial, 1100);
  assert.equal(three.tokensPerTrial, 1100);
  assert.deepEqual(compareEfficiency(one, three), []);
});

test("an unpriced trial is unknown, never averaged in as free", () => {
  const e = suiteEfficiency(
    report([trial({ costUsd: 0.02 }), trial({ costUsd: undefined })]),
  );
  assert.equal(e.pricedTrials, 1);
  // 0.02 over the ONE priced trial, not 0.01 over both.
  assert.equal(e.usdPerTrial, 0.02);
});

test("no priced trial at all reports no cost rather than zero", () => {
  const e = suiteEfficiency(report([trial()]));
  assert.equal(e.usdPerTrial, undefined);
  assert.equal(e.pricedTrials, 0);
});

test("history written before `efficiency` existed yields no timing, not zero", () => {
  const e = suiteEfficiency(report([trial()]));
  assert.equal(e.modelMsPerTrial, undefined);
  assert.equal(e.toolMsPerTrial, undefined);
  assert.equal(e.cacheReadRatio, undefined);
  // The comparison then has nothing to say, rather than claiming a huge win.
  const now = suiteEfficiency(
    report([
      trial({
        efficiency: {
          modelMs: 5000,
          toolMs: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
    ]),
  );
  assert.deepEqual(compareEfficiency(e, now), []);
});

test("cache read is a fraction of the inclusive input, never a sum over it", () => {
  const e = suiteEfficiency(
    report([
      trial({
        inputTokens: 1000,
        efficiency: {
          modelMs: 1,
          toolMs: 0,
          cacheReadTokens: 800,
          cacheWriteTokens: 0,
        },
      }),
    ]),
  );
  assert.equal(e.cacheReadRatio, 0.8);
  assert.ok(e.cacheReadRatio! <= 1);
});

test("warns past the 15% budget and stays quiet inside it", () => {
  const base = suiteEfficiency(report([trial()])); // 1100 tokens/trial
  const inside = suiteEfficiency(
    report([trial({ outputTokens: 100 + 1100 * (EFFICIENCY_WARN_DELTA - 0.01) })]),
  );
  const outside = suiteEfficiency(report([trial({ outputTokens: 500 })]));

  assert.deepEqual(compareEfficiency(base, inside), []);
  const warned = compareEfficiency(base, outside);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /up 36%/);
  assert.match(warned[0], /warn only/);
});

test("an improvement is never a warning", () => {
  const base = suiteEfficiency(report([trial()]));
  const better = suiteEfficiency(report([trial({ outputTokens: 10 })]));
  assert.deepEqual(compareEfficiency(base, better), []);
});

test("an empty run compares to nothing rather than dividing by zero", () => {
  const empty = suiteEfficiency(report([]));
  assert.equal(empty.trials, 0);
  assert.equal(empty.tokensPerTrial, 0);
  assert.deepEqual(compareEfficiency(empty, suiteEfficiency(report([trial()]))), []);
  assert.deepEqual(compareEfficiency(suiteEfficiency(report([trial()])), empty), []);
  assert.equal(formatEfficiency(empty), "");
});

test("the printed line omits what the run did not measure", () => {
  const partial = formatEfficiency(suiteEfficiency(report([trial()])));
  assert.match(partial, /1,100 tokens/);
  assert.doesNotMatch(partial, /model/);
  assert.doesNotMatch(partial, /cached/);

  const full = formatEfficiency(
    suiteEfficiency(
      report([
        trial({
          efficiency: {
            modelMs: 8000,
            toolMs: 1200,
            cacheReadTokens: 500,
            cacheWriteTokens: 0,
          },
        }),
      ]),
    ),
  );
  assert.match(full, /8.0s model/);
  assert.match(full, /1.2s tools/);
  assert.match(full, /50% cached/);
});

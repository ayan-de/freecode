import test from "node:test";
import assert from "node:assert/strict";
import { reportToOtlp } from "./otlp.js";
import { hexId } from "../rollout/otlp.js";
import type { CaseResult, SuiteReport, TrialResult } from "./types.js";

interface Span {
  name: string;
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
  links?: Array<{ traceId: string; spanId: string }>;
  status: { code: number; message?: string };
}

function spansOf(report: SuiteReport): Span[] {
  const doc = reportToOtlp(report) as {
    resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }>;
  };
  return doc.resourceSpans[0].scopeSpans[0].spans;
}

const attr = (span: Span, key: string) =>
  span.attributes.find((a) => a.key === key)?.value;

const trial = (over: Partial<TrialResult> = {}): TrialResult => ({
  passed: true,
  reason: "ok",
  durationMs: 100,
  inputTokens: 10,
  outputTokens: 5,
  turns: 1,
  repeatedCalls: 0,
  redirects: 0,
  redirectsSkipped: 0,
  questionsRejected: 0,
  ...over,
});

const kase = (over: Partial<CaseResult> = {}): CaseResult => ({
  id: "a-case",
  trials: [trial()],
  passed: true,
  consistent: true,
  quarantined: false,
  ...over,
});

const report = (over: Partial<SuiteReport> = {}): SuiteReport => ({
  suite: "trajectory",
  ranAt: "2026-08-27T10:00:00.000Z",
  trials: 1,
  cases: [kase()],
  passed: 1,
  total: 1,
  ...over,
});

test("emits an evaluate_suite root with a pass rate as the score", () => {
  const spans = spansOf(
    report({
      cases: [kase({ id: "a" }), kase({ id: "b", passed: false })],
      passed: 1,
      total: 2,
    }),
  );
  assert.match(spans[0].name, /^evaluate_suite trajectory/);
  // A rate, emitted as a double. Rounded to an integer this would report a 50%
  // pass rate as a perfect one — silent, and it looks like good news.
  assert.deepEqual(attr(spans[0], "gen_ai.evaluation.score.value"), {
    doubleValue: 0.5,
  });
  assert.equal(spans[0].status.code, 2);
});

test("a case-level score stays 1/0, not a rate", () => {
  const spans = spansOf(report());
  const caseSpan = spans.find((s) => s.name.startsWith("evaluate a-case"))!;
  assert.deepEqual(attr(caseSpan, "gen_ai.evaluation.score.value"), {
    doubleValue: 1,
  });
});

test("a case span links to the trace of the session it graded", () => {
  // The load-bearing part: without it, scores and runs arrive in one collector
  // as two unrelated sets of spans.
  const spans = spansOf(
    report({ cases: [kase({ trials: [trial({ sessionId: "session-abc" })] })] }),
  );
  const caseSpan = spans.find((s) => s.name.startsWith("evaluate a-case"))!;
  const expectedTrace = hexId("session-abc", 16);
  assert.deepEqual(caseSpan.links, [
    { traceId: expectedTrace, spanId: hexId(`${expectedTrace}:root`, 8) },
  ]);
});

test("a trial with no session produces no dangling link", () => {
  const spans = spansOf(report({ cases: [kase({ trials: [trial()] })] }));
  const caseSpan = spans.find((s) => s.name.startsWith("evaluate a-case"))!;
  assert.deepEqual(caseSpan.links, []);
});

test("a failing case is an error span carrying its reason", () => {
  const spans = spansOf(
    report({
      cases: [
        kase({
          passed: false,
          trials: [trial({ passed: false, reason: "expected grep, called read" })],
        }),
      ],
      passed: 0,
    }),
  );
  const caseSpan = spans.find((s) => s.name.startsWith("evaluate a-case"))!;
  assert.equal(caseSpan.status.code, 2);
  assert.equal(caseSpan.status.message, "expected grep, called read");
});

test("a quarantined failure is NOT an error span", () => {
  // It ran and reported, and by design it cannot turn the build red. Colouring
  // it red in a dashboard recreates the noise quarantine exists to remove.
  const spans = spansOf(
    report({
      cases: [
        kase({ passed: false, quarantined: true, trials: [trial({ passed: false })] }),
      ],
      passed: 0,
      total: 0,
    }),
  );
  const caseSpan = spans.find((s) => s.name.startsWith("evaluate a-case"))!;
  assert.equal(caseSpan.status.code, 1);
});

test("flakiness is reported separately from the verdict", () => {
  const spans = spansOf(
    report({
      cases: [
        kase({
          passed: true,
          consistent: false,
          trials: [trial(), trial({ passed: false })],
        }),
      ],
    }),
  );
  const caseSpan = spans.find((s) => s.name.startsWith("evaluate a-case"))!;
  assert.deepEqual(attr(caseSpan, "gen_ai.evaluation.score.label"), {
    stringValue: "pass",
  });
  assert.deepEqual(attr(caseSpan, "freecode.consistent"), { boolValue: false });
  assert.deepEqual(attr(caseSpan, "freecode.trials_passed"), { intValue: "1" });
});

test("two runs of one suite are two traces, not one overwriting itself", () => {
  const a = reportToOtlp(report({ ranAt: "2026-08-27T10:00:00.000Z" })) as {
    resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ traceId: string }> }> }>;
  };
  const b = reportToOtlp(report({ ranAt: "2026-08-27T11:00:00.000Z" })) as typeof a;
  assert.notEqual(
    a.resourceSpans[0].scopeSpans[0].spans[0].traceId,
    b.resourceSpans[0].scopeSpans[0].spans[0].traceId,
  );
});

test("no prompt or reason text leaks onto the wire beyond the failure message", () => {
  // §5.2's property: the collector may be third-party.
  const spans = spansOf(report());
  const serialized = JSON.stringify(spans);
  assert.equal(serialized.includes("prompt"), false);
});

test("cost is omitted when no trial was priced", () => {
  const spans = spansOf(report());
  assert.equal(attr(spans[0], "gen_ai.usage.cost"), undefined);
  const caseSpan = spans.find((s) => s.name.startsWith("evaluate a-case"))!;
  assert.equal(attr(caseSpan, "gen_ai.usage.cost"), undefined);
});

test("cost is summed when trials carry one", () => {
  const spans = spansOf(
    report({
      cases: [kase({ trials: [trial({ costUsd: 0.01 }), trial({ costUsd: 0.02 })] })],
    }),
  );
  const caseSpan = spans.find((s) => s.name.startsWith("evaluate a-case"))!;
  assert.deepEqual(attr(caseSpan, "gen_ai.usage.cost"), {
    doubleValue: 0.03,
  });
});

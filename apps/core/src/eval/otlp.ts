// =============================================================================
// Eval results as OTLP spans — spec §12.4.
//
// The GenAI conventions include a quality-evaluation layer, so a gate run can
// ship to the same collector as the runs it graded: scores and traces in one
// place, no second UI.
//
// The load-bearing part is the LINK. Each case span links to the trace of the
// session it graded, using the same `hexId(sessionId)` derivation `otlp.ts`
// uses — so clicking a red case in Langfuse lands on the actual trajectory
// that failed. Without that, scores and runs arrive as two unrelated sets of
// spans in one collector, which is most of the value gone.
//
// No text: a case carries a prompt, and the reason a case failed can quote
// arguments. Exporting either would put message bodies on the wire, which is
// exactly the property §5.2 keeps out of the rollout log. Names, verdicts and
// numbers only.
// =============================================================================

import {
  attrs,
  hexId,
  nano,
  STATUS_ERROR,
  STATUS_OK,
  type OtlpTarget,
} from "../rollout/otlp.js";
import { PRICES_AS_OF } from "../providers/pricing.js";
import { summarise } from "./compare.js";
import type { CaseResult, SuiteReport } from "./types.js";

/** Links from a case span to every session trace that produced it. */
function linksFor(kase: CaseResult) {
  return kase.trials
    .filter((t) => t.sessionId)
    .map((t) => ({
      traceId: hexId(t.sessionId!, 16),
      spanId: hexId(`${hexId(t.sessionId!, 16)}:root`, 8),
    }));
}

function caseSpan(
  kase: CaseResult,
  traceId: string,
  parentSpanId: string,
  startedAt: number,
) {
  const durationMs = kase.trials.reduce((n, t) => n + t.durationMs, 0);
  const costs = kase.trials
    .map((t) => t.costUsd)
    .filter((c): c is number => c !== undefined);

  return {
    traceId,
    spanId: hexId(`${traceId}:case:${kase.id}`, 8),
    parentSpanId,
    name: `evaluate ${kase.id}`,
    kind: 1, // INTERNAL
    startTimeUnixNano: nano(startedAt),
    endTimeUnixNano: nano(startedAt + durationMs),
    attributes: attrs({
      "gen_ai.operation.name": "evaluate",
      "gen_ai.evaluation.name": kase.id,
      // 1/0 rather than a boolean: the conventions model a score as a number,
      // and a dashboard averaging it gets a pass rate for free.
      "gen_ai.evaluation.score.value": kase.passed ? 1 : 0,
      "gen_ai.evaluation.score.label": kase.passed ? "pass" : "fail",
      "freecode.trials": kase.trials.length,
      "freecode.trials_passed": kase.trials.filter((t) => t.passed).length,
      // Reported separately from `passed` because majority-of-N is the blocking
      // statistic and all-N is not: a case can be green and still flaky, and
      // that distinction is the whole reason quarantine exists.
      "freecode.consistent": kase.consistent,
      "freecode.quarantined": kase.quarantined,
      "freecode.turns": kase.trials.reduce((n, t) => n + t.turns, 0),
      "freecode.repeated_calls": kase.trials.reduce(
        (n, t) => n + t.repeatedCalls,
        0,
      ),
      "gen_ai.usage.input_tokens": kase.trials.reduce(
        (n, t) => n + t.inputTokens,
        0,
      ),
      "gen_ai.usage.output_tokens": kase.trials.reduce(
        (n, t) => n + t.outputTokens,
        0,
      ),
      "gen_ai.usage.cost": costs.length
        ? costs.reduce((n, c) => n + c, 0)
        : undefined,
    }),
    links: linksFor(kase),
    // A quarantined failure is NOT an error span: it ran and reported, and by
    // design it cannot turn the build red. Colouring it red in a dashboard
    // would recreate exactly the noise quarantine exists to remove.
    status:
      kase.passed || kase.quarantined
        ? { code: STATUS_OK }
        : { code: STATUS_ERROR, message: kase.trials[0]?.reason ?? "failed" },
  };
}

/**
 * Builds the OTLP body for one suite run.
 *
 * `ranAt` seeds the trace id along with the suite name, so two runs of the
 * same suite are two traces rather than one that overwrites itself — the
 * opposite of the session case, where a stable id is what makes re-export
 * idempotent.
 */
export function reportToOtlp(
  report: SuiteReport,
  serviceName = "freecode",
): unknown {
  const traceId = hexId(`eval:${report.suite}:${report.ranAt}`, 16);
  const rootSpanId = hexId(`${traceId}:root`, 8);
  const startedAt = Date.parse(report.ranAt) || Date.now();
  const metrics = summarise(report);

  let cursor = startedAt;
  const caseSpans = report.cases.map((kase) => {
    const span = caseSpan(kase, traceId, rootSpanId, cursor);
    cursor += kase.trials.reduce((n, t) => n + t.durationMs, 0);
    return span;
  });

  const spans: unknown[] = [
    {
      traceId,
      spanId: rootSpanId,
      name: `evaluate_suite ${report.suite}`,
      kind: 1,
      startTimeUnixNano: nano(startedAt),
      endTimeUnixNano: nano(cursor),
      attributes: attrs({
        "gen_ai.operation.name": "evaluate",
        "gen_ai.evaluation.name": report.suite,
        "gen_ai.evaluation.score.value": metrics.total
          ? metrics.passed / metrics.total
          : 0,
        "gen_ai.request.model": report.model,
        "freecode.cases_passed": metrics.passed,
        "freecode.cases_total": metrics.total,
        "freecode.trials_per_case": report.trials,
        "freecode.turns": metrics.turns,
        "freecode.repeated_calls": metrics.repeatedCalls,
        "gen_ai.usage.cost": metrics.costUsd,
        "freecode.prices_as_of": PRICES_AS_OF,
      }),
      status:
        metrics.passed === metrics.total
          ? { code: STATUS_OK }
          : {
              code: STATUS_ERROR,
              message: `${metrics.total - metrics.passed} case(s) failed`,
            },
    },
    ...caseSpans,
  ];

  return {
    resourceSpans: [
      {
        resource: { attributes: attrs({ "service.name": serviceName }) },
        scopeSpans: [{ scope: { name: "freecode.eval" }, spans }],
      },
    ],
  };
}

export async function exportReport(
  report: SuiteReport,
  target: OtlpTarget,
): Promise<void> {
  const { postOtlp } = await import("../rollout/otlp.js");
  return postOtlp(reportToOtlp(report), target);
}

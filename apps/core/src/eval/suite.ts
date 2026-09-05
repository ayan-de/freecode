// =============================================================================
// Suite orchestration — run every case N times, summarise, gate, persist.
// =============================================================================

import { loadSuite } from "./dataset.js";
import { evaluateGate, summarise, type Verdict } from "./gate.js";
import { baselineFor, writeReport } from "./report.js";
import { subscriptionAuth } from "../providers/config.js";
import { resolveJudge } from "./judge-config.js";
import { loadQuarantine } from "./quarantine.js";
import { initRunner, runTrial } from "./runner.js";
import type { CaseResult, SuiteReport, TrialResult } from "./types.js";

export interface RunSuiteOptions {
  suite: string;
  trials: number;
  model?: string;
  onCase?: (result: CaseResult) => void;
  /**
   * Record this run as the baseline even if it closes the gate.
   *
   * Skipping blocked runs (see below) makes the baseline sticky when a suite is
   * legitimately re-scoped: delete five cases from twenty and `passed` drops
   * because `total` did, so every subsequent run reads as a regression against
   * a baseline that can never be superseded — because it never opens. This is
   * the way out, and it is deliberately a decision someone has to type.
   */
  acceptBaseline?: boolean;
}

export interface SuiteOutcome {
  report: SuiteReport;
  verdict: Verdict;
  /** The gate closed and the run was recorded as the baseline anyway. */
  accepted: boolean;
}

export async function runSuite(
  options: RunSuiteOptions,
): Promise<SuiteOutcome> {
  const cases = loadSuite(options.suite);
  const quarantined = loadQuarantine();
  const config = await initRunner(options.model);

  // Resolve the judge ONCE, against the model actually under test, and only if
  // some case wants one. A `same-model` refusal is loud (it throws) because it
  // means the run would have produced a number that looks like a quality score
  // and is really a self-similarity score. An `unconfigured` judge does not
  // throw — the deterministic expectations on these cases are still worth
  // running — but it is recorded, and `gate.ts` closes the gate on it, because
  // a judged suite graded by nobody is not a passing judged suite.
  let judgeSkipped: string | undefined;
  if (cases.some((c) => c.rubric)) {
    const subject =
      options.model ??
      (config.model ? `${config.provider}/${config.model}` : config.provider);
    const resolved = resolveJudge(subject);
    if (resolved.ok) {
      config.judge = resolved.judge;
    } else if (resolved.reason === "same-model") {
      throw new Error(resolved.detail);
    } else {
      judgeSkipped = resolved.detail;
    }
  }

  const results: CaseResult[] = [];
  for (const kase of cases) {
    const trials: TrialResult[] = [];
    for (let i = 0; i < options.trials; i++) {
      trials.push(await runTrial(kase, config));
    }
    const result = summarise(kase.id, trials, quarantined.has(kase.id));
    results.push(result);
    options.onCase?.(result);
  }

  const blocking = results.filter((c) => !c.quarantined);
  const echoed = [
    ...new Set(
      results.flatMap((c) => c.trials.flatMap((t) => t.echoedModels ?? [])),
    ),
  ].sort();
  const report: SuiteReport = {
    suite: options.suite,
    ranAt: new Date().toISOString(),
    // The RESOLVED model, not the CLI override. Recording `options.model` left
    // this `undefined` on every run without `--model`, so history could not say
    // which model produced a baseline — and comparing a local run against a CI
    // baseline from a different model looked like a regression with no way to
    // see why. A repriced baseline is worse than no baseline: it looks like data.
    model: config.model ? `${config.provider}/${config.model}` : config.provider,
    trials: options.trials,
    cases: results,
    passed: blocking.filter((c) => c.passed).length,
    total: blocking.length,
    // Disclosure, not detection (spec §7): the same-model check cannot see
    // through a gateway route, so the resolved judge is recorded on every
    // report for a reader to check.
    ...(config.judge ? { judge: config.judge } : {}),
    // Spec §8: a mode switch changes the instrument, so it is recorded and
    // `baselineFor` refuses to compare across it.
    ...(subscriptionAuth(config.provider) ? { authMode: "oauth" as const } : {}),
    ...(judgeSkipped ? { judgeSkipped } : {}),
    // Same reason as `judge` above: what we asked for is already recorded, and
    // what was actually served is the thing a stable id cannot tell you.
    ...(echoed.length > 0 ? { echoedModels: echoed } : {}),
  };

  // Read the baseline BEFORE writing, or this run becomes its own baseline
  // and the gate compares the report to itself.
  const baseline = baselineFor(options.suite, report.model, report.authMode);
  const verdict = evaluateGate(report, baseline);

  // A blocked run is recorded but MUST NOT become the baseline. Writing it
  // unconditionally forgave every regression on the next run: 18/20 → 14/20
  // closes the gate, then re-running at 14/20 opens it, because both the count
  // and the green set now come from the failed run. The delta rule is only
  // honest if a closed gate refuses to move the bar it is measured against.
  //
  // Still written to history, not dropped: the trend and `quarantine.ts`'s pass
  // rates both need failed runs. `baselineFor` skips this flag.
  //
  // `acceptBaseline` overrides that, and leaves a mark saying so: a baseline
  // someone waved through is a different kind of evidence from one a run
  // earned, and history has to be able to tell them apart.
  const accepted = !verdict.open && options.acceptBaseline === true;
  writeReport({
    ...report,
    ...(verdict.open || accepted ? {} : { gateBlocked: true }),
    ...(accepted ? { baselineAccepted: true } : {}),
  });

  return { report, verdict, accepted };
}

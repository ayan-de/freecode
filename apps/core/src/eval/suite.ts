// =============================================================================
// Suite orchestration — run every case N times, summarise, gate, persist.
// =============================================================================

import { loadSuite } from "./dataset.js";
import { evaluateGate, summarise, type Verdict } from "./gate.js";
import { baselineFor, writeReport } from "./report.js";
import { loadQuarantine } from "./quarantine.js";
import { initRunner, runTrial } from "./runner.js";
import type { CaseResult, SuiteReport, TrialResult } from "./types.js";

export interface RunSuiteOptions {
  suite: string;
  trials: number;
  model?: string;
  onCase?: (result: CaseResult) => void;
}

export async function runSuite(
  options: RunSuiteOptions,
): Promise<{ report: SuiteReport; verdict: Verdict }> {
  const cases = loadSuite(options.suite);
  const quarantined = loadQuarantine();
  const config = await initRunner(options.model);

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
  const report: SuiteReport = {
    suite: options.suite,
    ranAt: new Date().toISOString(),
    model: options.model,
    trials: options.trials,
    cases: results,
    passed: blocking.filter((c) => c.passed).length,
    total: blocking.length,
  };

  // Read the baseline BEFORE writing, or this run becomes its own baseline
  // and the gate compares the report to itself.
  const baseline = baselineFor(options.suite);
  const verdict = evaluateGate(report, baseline);
  writeReport(report);

  return { report, verdict };
}

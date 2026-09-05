// =============================================================================
// Report persistence — latest verdict + append-only history (spec §9.3).
//
// Two files, following waku's `release_gate.report`: one you read to see the
// last result, one you read to compute a trend. The history file is what makes
// "did last week's prompt change cost us anything" a query rather than an
// argument, and it is what quarantine.ts reads to compute pass rates.
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { suiteEfficiency, type SuiteEfficiency } from "./scorers/efficiency.js";
import type { SuiteReport } from "./types.js";

export function reportDir(): string {
  return process.env.FREECODE_EVAL_HOME ?? path.join(os.homedir(), ".freecode");
}

const latestPath = () => path.join(reportDir(), "eval_report.json");
const historyPath = () => path.join(reportDir(), "eval_runs.jsonl");

export function writeReport(report: SuiteReport): void {
  fs.mkdirSync(reportDir(), { recursive: true });
  fs.writeFileSync(latestPath(), JSON.stringify(report, null, 2), "utf-8");
  fs.appendFileSync(historyPath(), JSON.stringify(report) + "\n", "utf-8");
}

export function readHistory(suite?: string): SuiteReport[] {
  const file = historyPath();
  if (!fs.existsSync(file)) return [];
  const out: SuiteReport[] = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as SuiteReport;
      if (!suite || record.suite === suite) out.push(record);
    } catch {
      // A truncated final line (killed mid-append) must not make the whole
      // history unreadable — the trend matters more than the last row.
      continue;
    }
  }
  return out;
}

export interface Baseline {
  passed: number;
  total: number;
  /** Case ids that passed in the most recent run — §9.2's regression clause. */
  greenIds: Set<string>;
  /** The model that produced it, so a cross-model comparison can be refused. */
  model?: string;
  ranAt: string;
  /**
   * Folded here rather than in the gate so `evaluateGate` stays pure — it takes
   * a report and a baseline and does no IO, which is what makes every rule in
   * it testable without spending a token.
   */
  efficiency: SuiteEfficiency;
}

/**
 * The baseline is the last recorded run of this suite **that did not close the
 * gate**, and that ran on the same model as the run being judged.
 *
 * Last-run rather than best-ever: best-ever ratchets a flaky suite permanently
 * red, while last-run tracks reality and leaves the "previously green went red"
 * clause to catch real regressions.
 *
 * Skipping blocked runs is what makes the delta rule honest. Recording every
 * run meant a regression became its own baseline and was forgiven on the next
 * attempt — 18/20 → 14/20 closes the gate, re-run at 14/20 and it opens.
 *
 * Skipping a different auth mode is the same argument (OAuth spec §8): the
 * subscription endpoint carries a different beta set and an extra system
 * block, so its numbers are not comparable to an API-key run's.
 *
 * Skipping other models is the other half. Comparing a cheap local run against
 * a CI baseline from a different model reads as a regression with no way to see
 * why, and the spec is explicit that a repriced baseline is worse than none
 * because it looks like data. `undefined` on either side means a run recorded
 * before the model was tracked — compared anyway rather than discarded, since
 * refusing would throw away every baseline written before this change.
 */
export function baselineFor(
  suite: string,
  model?: string,
  authMode?: "oauth" | "api-key",
): Baseline | null {
  const history = readHistory(suite);
  // An absent mode on either side means "api-key or not tracked yet", which is
  // the same instrument — only a recorded "oauth" on one side and not the
  // other is a switch.
  const normalize = (m?: string) => (m === "oauth" ? "oauth" : "api-key");
  for (let i = history.length - 1; i >= 0; i--) {
    const run = history[i];
    if (run.gateBlocked) continue;
    if (model && run.model && run.model !== model) continue;
    if (normalize(run.authMode) !== normalize(authMode)) continue;
    return {
      passed: run.passed,
      total: run.total,
      greenIds: new Set(
        run.cases.filter((c) => c.passed && !c.quarantined).map((c) => c.id),
      ),
      model: run.model,
      ranAt: run.ranAt,
      efficiency: suiteEfficiency(run),
    };
  }
  return null;
}

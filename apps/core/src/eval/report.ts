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
}

/**
 * The baseline is the LAST recorded run of this suite, not the best ever.
 * Best-ever ratchets a flaky suite permanently red; last-run tracks reality
 * and leaves the "previously green went red" clause to catch real regressions.
 */
export function baselineFor(suite: string): Baseline | null {
  const history = readHistory(suite);
  const last = history[history.length - 1];
  if (!last) return null;
  return {
    passed: last.passed,
    total: last.total,
    greenIds: new Set(
      last.cases.filter((c) => c.passed && !c.quarantined).map((c) => c.id),
    ),
  };
}

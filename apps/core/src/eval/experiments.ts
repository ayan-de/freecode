// =============================================================================
// Experiment ledger — every A/B that tested a hypothesis leaves a record.
//
// `eval ab` is deliberately not a gate and writes no history, which had a
// cost: a report not saved with `--out` evaporated, and nothing anywhere
// recorded WHY an experiment ran or what was decided about it — so an
// abandoned prompt tweak could be earnestly re-tried a quarter later.
//
// `eval ab --hypothesis "..."` appends one line here: the pre-declared
// hypothesis (declared BEFORE the result exists, which is what makes a mixed
// outcome hard to rationalise after the fact), the variant specs, the delta
// tally, the efficiency totals, the commit — and `verdict: null`. The verdict
// is the HUMAN's call, made the calibration way: edit the field in place to
// "kept" or "rejected" (optionally adding a `note`), and `freecode eval
// experiments` lists the ledger and nags about undecided entries.
//
// In the repo, not `~/.freecode`, on purpose: rejected experiments are the
// entries most worth committing. A ledger of only winners is a changelog.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import type { AbCaseResult, AbReport } from "./ab-run.js";
import type { Delta } from "./ab.js";
import { evalsDir } from "./dataset.js";

/** One side's totals over every case — the numbers an experiment exists to move. */
export interface SideTotals {
  passed: number;
  tokens: number;
  turns: number;
  repeatedCalls: number;
  /** `undefined` when nothing priced — "free" and "unknown" stay distinct. */
  costUsd?: number;
}

export interface ExperimentRecord {
  id: string;
  /** Declared on the command line BEFORE the result existed. */
  hypothesis: string;
  suite: string;
  ranAt: string;
  /** Which tree produced these numbers. */
  commit?: string;
  trials: number;
  sides: AbReport["sides"];
  /** Cases per delta bucket; buckets with no cases are omitted. */
  deltas: Partial<Record<Delta, number>>;
  totals: { baseline: SideTotals; candidate: SideTotals };
  /** The human's decision. `null` until someone edits it in. */
  verdict: "kept" | "rejected" | null;
  /** Optional rationale, added by hand alongside the verdict. */
  note?: string;
}

export function experimentsPath(): string {
  return path.join(evalsDir(), "experiments.jsonl");
}

const VERDICTS = new Set(["kept", "rejected", null]);

export function loadExperiments(): ExperimentRecord[] {
  const file = experimentsPath();
  if (!fs.existsSync(file)) return [];
  const records: ExperimentRecord[] = [];
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let parsed: ExperimentRecord;
    try {
      parsed = JSON.parse(line) as ExperimentRecord;
    } catch {
      throw new Error(`${file}:${index + 1}: not valid JSON`);
    }
    if (!VERDICTS.has(parsed.verdict)) {
      throw new Error(
        `${file}:${index + 1}: \`verdict\` must be "kept", "rejected" or null`,
      );
    }
    records.push(parsed);
  }
  return records;
}

function totalsOf(cases: AbCaseResult[], side: "baseline" | "candidate") {
  const totals: SideTotals = { passed: 0, tokens: 0, turns: 0, repeatedCalls: 0 };
  for (const c of cases) {
    totals.passed += c[side].passed;
    totals.tokens += c[side].tokens;
    totals.turns += c[side].turns;
    totals.repeatedCalls += c[side].repeatedCalls;
    if (c[side].costUsd !== undefined) {
      totals.costUsd = (totals.costUsd ?? 0) + c[side].costUsd!;
    }
  }
  return totals;
}

/**
 * Append the finished A/B as a ledger entry awaiting a verdict. The id is
 * date + suite + a counter over same-day same-suite entries — legible in a
 * `git log` and stable enough to name in a commit message.
 */
export function recordExperiment(
  hypothesis: string,
  report: AbReport,
): ExperimentRecord {
  const existing = loadExperiments();
  const day = report.ranAt.slice(0, 10);
  const stem = `${day}-${report.suite}`;
  const seq = existing.filter((e) => e.id.startsWith(`${stem}-`)).length + 1;

  const deltas: Partial<Record<Delta, number>> = {};
  for (const c of report.cases) {
    deltas[c.delta] = (deltas[c.delta] ?? 0) + 1;
  }

  const record: ExperimentRecord = {
    id: `${stem}-${seq}`,
    hypothesis,
    suite: report.suite,
    ranAt: report.ranAt,
    ...(report.commit ? { commit: report.commit } : {}),
    trials: report.trials,
    sides: report.sides,
    deltas,
    totals: {
      baseline: totalsOf(report.cases, "baseline"),
      candidate: totalsOf(report.cases, "candidate"),
    },
    verdict: null,
  };
  const file = experimentsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf-8");
  return record;
}

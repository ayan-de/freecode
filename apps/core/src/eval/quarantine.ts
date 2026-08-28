// =============================================================================
// Quarantine — the other half of the gate (spec §9.3).
//
// Choosing majority-of-N IS a flaky-case policy, so this ships with the gate
// rather than after it. A quarantined case still runs and still reports; it
// just cannot turn the build red.
//
// Format: one case id per line, `#` comments, `id  # reason` inline.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { evalsDir } from "./dataset.js";
import type { CaseResult } from "./types.js";

/** Below this trailing pass rate a case is proposed for quarantine. */
export const QUARANTINE_BELOW = 0.9;
/** Above this it is proposed for release back into the gate. */
export const RELEASE_ABOVE = 0.98;
/** Rates computed on fewer runs than this are advisory, not actionable. */
export const MIN_RUNS_FOR_RATE = 20;

export function quarantinePath(): string {
  return path.join(evalsDir(), "quarantine.txt");
}

export function loadQuarantine(): Set<string> {
  const file = quarantinePath();
  if (!fs.existsSync(file)) return new Set();
  const ids = fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .map((line) => line.split("#")[0].trim())
    .filter(Boolean);
  return new Set(ids);
}

export interface RateProposal {
  id: string;
  rate: number;
  runs: number;
}

export interface QuarantineReport {
  toQuarantine: RateProposal[];
  toRelease: RateProposal[];
  /** True while there is too little history for the rates to mean much. */
  thin: boolean;
}

/**
 * Proposals only — this never edits the file. A gate that silently quarantines
 * its own failures is a gate that always passes, which is the failure mode
 * this whole design exists to avoid.
 */
export function proposeQuarantine(
  history: CaseResult[][],
  quarantined: Set<string>,
): QuarantineReport {
  const trials = new Map<string, { pass: number; total: number }>();
  for (const run of history) {
    for (const result of run) {
      const acc = trials.get(result.id) ?? { pass: 0, total: 0 };
      for (const trial of result.trials) {
        acc.total++;
        if (trial.passed) acc.pass++;
      }
      trials.set(result.id, acc);
    }
  }

  const toQuarantine: RateProposal[] = [];
  const toRelease: RateProposal[] = [];
  for (const [id, acc] of trials) {
    if (acc.total === 0) continue;
    const rate = acc.pass / acc.total;
    const proposal = { id, rate, runs: acc.total };
    if (quarantined.has(id)) {
      if (rate >= RELEASE_ABOVE) toRelease.push(proposal);
    } else if (rate < QUARANTINE_BELOW && acc.pass > 0) {
      // `acc.pass > 0`: quarantine is for FLAKY cases, not failing ones.
      //
      // A case that has never passed is not noise to be suppressed — it is
      // either a real finding about the agent or a broken case, and both want
      // fixing rather than silencing. Proposing it here inverted this module's
      // own stated purpose: "a gate that silently quarantines its own failures
      // is a gate that always passes". The rate rule could not tell 0% from
      // 60% and recommended both.
      //
      // Observed on a real report, which proposed quarantining 7 of 20 cases —
      // including the two consistent failures that were the suite's most
      // useful output. A report that recommends that is a report nobody reads.
      toQuarantine.push(proposal);
    }
  }

  return {
    toQuarantine: toQuarantine.sort((a, b) => a.rate - b.rate),
    toRelease: toRelease.sort((a, b) => b.rate - a.rate),
    thin: history.length < MIN_RUNS_FOR_RATE,
  };
}

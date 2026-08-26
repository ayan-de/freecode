// =============================================================================
// Eval harness types — spec `2026-08-23-eval-harness.md`.
//
// A case under `evals/` runs a REAL agent turn. Anything that doesn't is a
// `*.test.ts` and belongs next to the code it tests (spec §3).
// =============================================================================

import type { Trace } from "../rollout/trace.js";

/** How an expected argument value is compared. Spec §4.1. */
export type ArgMatcher =
  | string
  | { $eq: unknown }
  | { $regex: string; $flags?: string };

export interface EvalCase {
  id: string;
  prompt: string;
  /** Pinned so a provider default change cannot silently reprice the baseline. */
  model?: string;
  agentMode?: "plan" | "build" | "review" | "explore" | "danger";

  // --- trajectory expectations -------------------------------------------
  /** `null` asserts that NO tool fired. */
  expectTool?: string | null;
  expectInArgs?: Record<string, ArgMatcher>;
  expectMaxTurns?: number;
  forbidTools?: string[];

  // --- outcome expectations (spec §4, §6.1) -------------------------------
  /**
   * Fixture seeded into a fresh tmpdir, which becomes the case's project root.
   * Presence of `files` is what makes a case sandboxed, and therefore what
   * lets it run in a mutating agent mode at all.
   */
  files?: Record<string, string>;
  /** Shell command run in the sandbox after the turn; exit code is the score. */
  verify?: string;
  /**
   * Fixture files the agent must not touch — the checker, normally. Not in the
   * spec's case format; added because "edit check.mjs until it passes" is a
   * green run that fixed nothing, and a prompt saying "do not modify check.mjs"
   * is a request, not a guard.
   */
  immutable?: string[];

  // --- judged expectations (spec §7) --------------------------------------
  /**
   * Rubric file under `evals/rubrics/<name>.md`. Its presence is what makes a
   * case JUDGED, which means a different blocking rule: a score below the floor
   * fails, and a judge outage skips rather than fails.
   */
  rubric?: string;
}

/** One trial of one case. */
export interface TrialResult {
  passed: boolean;
  /** "ok" on success, else the FIRST failed expectation, kept short. */
  reason: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * Estimated USD for this trial (`providers/pricing.ts`), or `undefined` when
   * the model is unpriced. Deliberately not 0 in that case: a gate comparing
   * cost across runs must be able to tell "free" from "unknown", and a zero
   * would silently read as a saving.
   */
  costUsd?: number;
  /**
   * The session this trial ran in. Carried so an exported score can LINK to
   * the trace it graded (spec §12.4) — without it, scores and runs land in the
   * same collector as two unrelated sets of spans, which is most of the value
   * gone. Absent on a trial that failed before a session existed.
   */
  sessionId?: string;

  // --- comparison metrics ------------------------------------------------
  // Recorded on every trial, not just when comparing: a metric you can only
  // collect by re-running is a metric you will not have when you need it.
  // Spec `2026-08-26-trajectory-redirection.md` §9.
  /** Model calls — "turns to completion". */
  turns: number;
  /**
   * Tool calls that repeated an earlier `tool(args)` signature in the same
   * trial. The count of *redundant* calls: six identical greps score 5.
   */
  repeatedCalls: number;
  /** Trajectory redirections that fired during this trial. */
  redirects: number;
  /**
   * Warnings that did NOT become a redirection. With the feature off this is
   * the "how often would it have fired" counter — the number that says whether
   * a baseline run exercised the trigger at all, and therefore whether the
   * comparison is measuring anything.
   */
  redirectsSkipped: number;
  /** Clarifying questions the harness declined on the user's behalf. */
  questionsRejected: number;
  /**
   * Judge verdict 0–5. `null` means the judge was asked and could not answer —
   * reported as skipped, never as a failure (spec §7 constraint 3). Absent
   * entirely on a case with no rubric.
   */
  score?: number | null;
}

export interface CaseResult {
  id: string;
  trials: TrialResult[];
  /** Majority-of-N (pass@1 when trials === 1). The blocking statistic. §9.1 */
  passed: boolean;
  /** All N trials passed. Reported, never blocking. §9.1 */
  consistent: boolean;
  quarantined: boolean;
  /**
   * Mean judge score across scored trials; `null` when the judge answered for
   * none of them. Absent on a case with no rubric — which is how the gate
   * tells a deterministic case from a judged one.
   */
  score?: number | null;
}

export interface SuiteReport {
  suite: string;
  ranAt: string;
  model?: string;
  trials: number;
  cases: CaseResult[];
  /** Blocking cases only — quarantined ones are excluded from both counts. */
  passed: number;
  total: number;
  /**
   * The judge that actually ran, recorded on every report.
   *
   * Spec §7: the same-model check compares normalised ids and therefore cannot
   * catch a gateway route or an alias of the same weights. Mitigation is
   * DISCLOSURE rather than detection — writing the resolved judge into the
   * report lets a reader catch what the comparison cannot.
   */
  judge?: { provider: string; model?: string };
  /** Why no judge ran, when none did. Judged cases then report as skipped. */
  judgeSkipped?: string;
  /**
   * This run closed the gate. Recorded in history — the trend and quarantine's
   * pass rates need failed runs — but skipped by `baselineFor`, so a regression
   * cannot quietly become the bar the next run is measured against.
   */
  gateBlocked?: boolean;
  /**
   * This run closed the gate and was recorded as the baseline anyway, via
   * `--accept-baseline`. An audit mark, not a behaviour: `baselineFor` treats
   * it like any unblocked run. It exists so history can tell a baseline someone
   * waved through from one a run earned.
   */
  baselineAccepted?: boolean;
}

/**
 * A scorer's whole input.
 *
 * `trace` is the rollout log's fold: timing, spans, tool names AND args.
 * `prompt`/`response` are text, which the rollout log deliberately never
 * carries so that OTLP export cannot leak message bodies (spec §5.2). For a
 * live run the response is captured from the stream bus; for a harvested one
 * it comes from the thread store. Keeping the text OUT of `trace` is the
 * load-bearing part — where it comes from is the caller's business.
 */
export interface RunRecord {
  trace: Trace;
  prompt: string;
  response: string;
  /** The sandbox the turn ran in, when the case had one. `outcome.ts`'s input. */
  sandboxDir?: string;
}

export type Scorer = (run: RunRecord, kase: EvalCase) => TrialScore;

export interface TrialScore {
  passed: boolean;
  reason: string;
}

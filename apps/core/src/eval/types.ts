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
}

export interface CaseResult {
  id: string;
  trials: TrialResult[];
  /** Majority-of-N (pass@1 when trials === 1). The blocking statistic. §9.1 */
  passed: boolean;
  /** All N trials passed. Reported, never blocking. §9.1 */
  consistent: boolean;
  quarantined: boolean;
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

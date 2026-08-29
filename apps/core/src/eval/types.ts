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

/**
 * What a red on this case would mean. Spec `2026-08-29-eval-case-registry.md` §4.
 *
 * CLOSED on purpose: a case that fits no category is a case nobody has thought
 * about. Add a category deliberately — and then answer why it has no cases —
 * rather than reaching for a free-text label that makes the list unqueryable.
 *
 * fx's original taxonomy is failure-modes-only, which does not fit a suite where
 * `coding` asks whether the agent can edit code at all and `judged` asks whether
 * the prose was any good. Those are capabilities, not misbehaviours, so the set
 * below covers both readings of "what breaks if this goes red".
 */
export const FAILURE_CATEGORIES = [
  /** Wrong tool, or the right tool only after wasted ones. */
  "tool-routing",
  /** Produced the wrong code, or none. The end state is the assertion. */
  "code-edit",
  /** The reply itself is the deliverable — accuracy, honesty, brevity. */
  "answer-quality",
  /** Repetition or no progress on a tedious or unanswerable task. */
  "stuck-loop",
  /** Behaviour under an agent mode or permission rule that says no. */
  "permission",
  /** Recovering from a failed tool call (`agent/recovery/`). */
  "recovery",
  /** Acting on a tree or file state that has since moved. */
  "stale-context",
  /** Still correct across a compaction mid-task. */
  "compaction-boundary",
  /** Retrieves the right memory, or correctly retrieves none. */
  "memory-recall",
  /** Does not drown in a 10k-line tool result. */
  "large-output",
  /** Correct after a resume or fork. */
  "resume",
  /** "This is taking forever, what are you doing" — a real turn with a real
   *  correct answer. */
  "frustration",
  /** An MCP server that is down, slow, or lying. */
  "mcp-failure",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/**
 * A documented gap: this case does not pass, and we know why.
 *
 * Distinct from quarantine, which is about FLAKINESS — a quarantined case might
 * pass. A `knownGap` case reliably does not, and we have decided that is
 * acceptable for now. Recording it here rather than in `quarantine.txt` keeps
 * the two mechanisms from corrupting each other: quarantine's promotion and
 * demotion are driven by observed pass rate, and a case that was never expected
 * to pass would drag those rates without meaning anything.
 *
 * Carries no scoring weight. The case runs, scores and reports exactly as
 * before; this is documentation attached to the artifact it documents.
 */
export interface KnownGap {
  status: "partial" | "known-gap" | "unmeasured";
  /** What actually happens today. An OBSERVATION. */
  notes: string;
  /** What passing would look like. An ASPIRATION, and never the same string. */
  target: string;
}

export interface EvalCase {
  id: string;
  prompt: string;
  /**
   * What a red here would mean. REQUIRED — an optional justification field is
   * one nobody fills in, and the point is to make the suite able to say what it
   * covers and what it does not.
   */
  failureCategory: FailureCategory;
  /**
   * Why a deterministic test cannot cover this. REQUIRED and asserted non-empty.
   *
   * The rule that anything not running a real agent turn belongs in a
   * `*.test.ts` was prose in `CLAUDE.md` with nothing enforcing it: `dataset.ts`
   * rejected a case that asserts nothing, and happily accepted a case a unit
   * test should have covered.
   */
  whyModelBacked: string;
  /** See `KnownGap`. Documentation only — never affects the score or the gate. */
  knownGap?: KnownGap;
  /** Pinned so a provider default change cannot silently reprice the baseline. */
  model?: string;
  agentMode?: "plan" | "build" | "review" | "explore" | "danger";

  // --- trajectory expectations -------------------------------------------
  /** `null` asserts that NO tool fired. Satisfied by a call ANYWHERE in the run. */
  expectTool?: string | null;
  /**
   * The run's FIRST tool must be one of these (spec
   * `2026-08-29-eval-case-registry.md` §3). `expectTool` asks whether the right
   * tool fired; this asks whether it fired *first*, which is the question the
   * trajectory suite exists for — a model that websearches, flails, then greps
   * scores identically to one that greps immediately under `expectTool` alone.
   *
   * A set, not a needle: several openings are usually legitimate, and naming one
   * tests the model's phrasing rather than its behaviour.
   */
  expectFirstToolIn?: string[];
  expectInArgs?: Record<string, ArgMatcher>;
  /**
   * Regex over the `command` argument of any `bash` span, for cases whose
   * correct action is a shell verb rather than a tool choice. Anchoring is the
   * author's business. Compiled at LOAD time — a bad pattern is a dataset error,
   * never a failed case.
   */
  expectBashMatches?: string;
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

/**
 * Per-trial efficiency, folded from the rollout trace. Tokens and USD are NOT
 * repeated here — they already live on `TrialResult` — so this carries only
 * what the fold used to drop at the boundary.
 */
export interface TrialEfficiency {
  /** Sum of model call time; the number that usually explains a slow trial. */
  modelMs: number;
  toolMs: number;
  cacheReadTokens: number;
  /** Billed at 1.25x input on Anthropic, so it is not the same as a read. */
  cacheWriteTokens: number;
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
   * Trace-derived timing and cache figures (`scorers/efficiency.ts`).
   *
   * Optional because history written before this field existed has none, and
   * absent means **unknown, never zero**: a missing `modelMs` folded in as 0
   * would report every pre-existing baseline as an infinite improvement. Same
   * instinct as an unpriced model costing `undefined` rather than $0.
   */
  efficiency?: TrialEfficiency;
  /**
   * Distinct model ids the provider echoed back on this trial's calls
   * (`model-echo.ts`). Omitted when no call carried one — absent means the
   * provider said nothing, never that it agreed.
   */
  echoedModels?: string[];
  /**
   * Judge verdict 0–5. `null` means the judge was asked and could not answer —
   * reported as skipped, never as a failure (spec §7 constraint 3). Absent
   * entirely on a case with no rubric.
   */
  score?: number | null;
  /**
   * What GRADING this trial cost, kept out of `costUsd` on purpose.
   *
   * The judge call never reaches the rollout recorder, so before this it was
   * simply invisible and the reported figure was the subject's spend rather
   * than the run's. Folding it into `costUsd` would have been worse than
   * invisible: `scorers/efficiency.ts` compares cost and tokens per trial
   * across runs to answer "did this prompt change get more expensive", and a
   * grader's spend moving that number is a regression signal with no
   * connection to the agent. `undefined` when the judge model is unpriced.
   */
  judgeCostUsd?: number;
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
  /**
   * Every distinct model id the provider echoed back across the run
   * (`model-echo.ts`). Recorded for the same reason `judge` is: `model` above
   * is what we ASKED for, and a stable alias can be served by a rolled snapshot
   * that reprices the baseline while every recorded id stays identical.
   * Disclosure only — a disagreement is printed, never gated on.
   */
  echoedModels?: string[];
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

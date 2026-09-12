// =============================================================================
// Shared types for the optimisation-task harness (jcode bench v1 tasks).
// Design: docs/superpowers/specs/2026-09-12-harness-bench.md §3
// =============================================================================

/** One `./grade` invocation, as the upstream harness appends it to scores.jsonl. */
export interface GradeRecord {
  ts: string;
  seed: number;
  cost: number;
  given_cost: number;
  score: number;
  full_gate: boolean;
}

/** One point on the score-over-time curve: ms since the agent started, and the running best. */
export interface CurvePoint {
  t: number;
  score: number;
  best: number;
  fullGate: boolean;
}

export interface TrialRecord {
  task: string;
  agent: string;
  agentVersion: string;
  model: string;
  autonomy: string;
  trial: number;
  /** Commit of the upstream task repo the workspace was staged from. */
  upstreamCommit: string;
  startedAt: string;
  durationMs: number;
  timedOut: boolean;
  exitCode: number | null;
  /** Every grade the agent ran, in order. */
  grades: number;
  /** Highest score sampled during the run — can sit above `final` (see README). */
  best: number | null;
  /** Elapsed ms at which `best` was first reached. */
  bestAt: number | null;
  /** ms from agent start to the last grade — jcode's "active time". */
  activeMs: number;
  /**
   * The official final grade, run by the harness after the agent exited,
   * on the submission as left. `null` when the final verify FAILED — a
   * submission that is wrong on some input has no score, whatever its best
   * sample said.
   */
  final: number | null;
  /** Whether that final grade ran the task's full exhaustive gate (`--full`). */
  finalFullGate: boolean;
  curve: CurvePoint[];
  /** Harness gates in force for this trial, from the operator's env. */
  harnessFlags: Record<string, string>;
  artifactDir: string;
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  usd?: number | null;
  auditOk?: boolean;
}

export interface Report {
  runId: string;
  startedAt: string;
  finishedAt: string;
  upstreamCommit: string;
  trials: TrialRecord[];
}

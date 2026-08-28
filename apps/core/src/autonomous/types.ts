// =============================================================================
// Autonomous run types — RunManifest, RunLimits, RunStatus, TaskCard, GateResult
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md §4.2, §4.3
//
// PHASE 0: types + budget + storage only. Nothing here starts an agent, spawns
// a process, or runs a gate command. A run is deliberately not a new kind of
// thing in the event-sourcing model — it is a session whose turns happen to be
// system-continued rather than human-continued, which is what makes replay work
// on it for free.
// =============================================================================

/**
 * Four independent ceilings; whichever is hit first stops the run.
 *
 * Stricter than Prime Agent's `DEFAULT_AUTONOMOUS_LIMITS` on purpose (spec §9):
 * their OAuth-first default means a runaway loop mostly wastes time. Ours wastes
 * money, so `maxUsd` exists at all and the other three start lower.
 */
export interface RunLimits {
  maxTurns: number;
  /** Input + output + cache *writes*. Cache reads are excluded — see §4.3. */
  maxTokens: number;
  timeoutMs: number;
  /** No OAuth free tier here, so cost is a first-class ceiling, not a nicety. */
  maxUsd?: number;
  /**
   * Trajectory redirections allowed for the whole run
   * (`agent/redirect/policy.ts`). Sourced from the budget rather than the
   * redirect settings when a run owns the loop: an unattended run's recovery
   * attempts are part of its spend, not a separate allowance.
   * Spec `2026-08-26-trajectory-redirection.md` Phase 3.
   */
  maxRedirects: number;
}

export const DEFAULT_RUN_LIMITS: RunLimits = {
  maxTurns: 20,
  maxTokens: 150_000,
  timeoutMs: 60 * 60 * 1000,
  maxRedirects: 2,
};

/**
 * Why a run stopped. `budget_*` are the four ceilings; the rest are lifecycle.
 * A run that ends without one of these has not ended — it has gone missing, and
 * `crashed` is what that is called once the PID is found dead.
 */
export type RunStopReason =
  | "budget_turns"
  | "budget_tokens"
  | "budget_time"
  | "budget_usd"
  | "gate_passed"
  | "cancelled"
  | "crashed"
  | "error";

export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "stopped"
  | "cancelled"
  | "crashed";

/** Usage as the budget counts it. Mirrors the provider-reported shape. */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  /**
   * Counted for reporting, NEVER against `maxTokens`. Counting cache reads
   * cumulatively would let a long verifier loop exhaust the budget on repeated
   * *context* rather than new work — the exact reasoning Prime Agent documents,
   * and doubly relevant here after a release spent on cache hit rate.
   */
  cacheReadTokens: number;
  usd?: number;
}

export const EMPTY_USAGE: RunUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

/** One unit of work, jcode-shaped (§3.2). Written by the run's own agent. */
export interface TaskCard {
  id: string;
  title: string;
  before: string;
  after: string;
  validation: string;
  outcome: "done" | "partial" | "failed";
  createdAt: number;
}

export interface GateResult {
  command: string;
  passed: boolean;
  attempt: number;
  output: string;
  /**
   * Worktree hash at the moment the gate ran. Equal to the previous failure's
   * hash means the model changed nothing, so re-running an expensive suite
   * would burn budget to learn what is already known (§3.1).
   */
  worktreeHash: string;
  ranAt: number;
}

export interface RunManifest {
  runId: string;
  status: RunStatus;
  /** Set once the run reaches a terminal state; absent while it lives. */
  stopReason?: RunStopReason;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;

  projectPath: string;
  /** The dedicated `git worktree` this run operates in — never the user's checkout. */
  worktreePath?: string;
  provider: string;
  model?: string;

  limits: RunLimits;
  usage: RunUsage;
  turns: number;

  /**
   * Fixed at start and re-read from the manifest on every check, never sourced
   * from anything the model can write to — which is what structurally stops a
   * run from disabling its own gate.
   */
  verifyCommand: string;
  lastGateFailure?: GateResult;

  /** PID of the detached child, once §4.4a exists. Absent in Phase 0. */
  pid?: number;
  /**
   * Checked at turn boundaries rather than signalled: a process killed
   * mid-write is how manifests corrupt.
   */
  cancelRequested?: boolean;

  taskCardCount: number;
}

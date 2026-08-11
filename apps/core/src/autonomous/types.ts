// =============================================================================
// Autonomous Runs Types (Tier A — bounded, budget-capped unattended sessions)
// PRIMARY: RunManifest/RunLimits/RunStatus — the data model for §4 of the spec.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md, §4.1-4.3
// Phase 0 (this file + budget.ts + run-store.ts): manifest + budget ceilings,
// no execution wiring yet.
// =============================================================================

export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "crashed"
  | "cancelled";

export type RunStopReason =
  | "maxTurns"
  | "maxTokens"
  | "timeoutMs"
  | "maxUsd"
  | "gatePassed"
  | "cancelled"
  | "crashed";

/** Four independent ceilings; whichever is hit first stops the run. §4.3 */
export interface RunLimits {
  maxTurns: number;
  /** Excludes cache-read tokens — see budget.ts's countedTokens. */
  maxTokens: number;
  timeoutMs: number;
  /** Required in v1 (§9) — no default suggested, cost varies too much by model. */
  maxUsd: number;
}

/** Cumulative usage as tracked against a RunLimits, checked at each checkpoint. */
export interface RunUsage {
  turns: number;
  /** inputTokens + outputTokens + cacheCreationInputTokens, excludes cache reads. */
  countedTokens: number;
  elapsedMs: number;
  usd: number;
}

/**
 * jcode's shape (§3.2): before/after/validation/outcome per unit of work,
 * turning a long run into something a human can skim in two minutes instead
 * of reading a transcript. v1 has no writer for these yet — see report.ts's
 * header — so this type exists for report.ts to render and for a future
 * writer to populate without a schema change.
 */
export interface TaskCard {
  id: string;
  before: { problem: string; evidence?: string };
  after: { change: string; filesChanged?: string[] };
  validation?: { commands?: string[]; result?: string };
  outcome: "success" | "partial" | "failed";
  createdAt: string;
}

export interface RunManifest {
  id: string;
  status: RunStatus;
  limits: RunLimits;
  usage: RunUsage;
  verifyCommand: string;
  mission?: string;
  worktreePath?: string;
  pid?: number;
  /** Set by autonomous.cancel; the run's own loop checks this at the next turn
   * boundary and exits cleanly — "checked, not signaled" (§5.1). */
  cancelRequested?: boolean;
  stopReason?: RunStopReason;
  createdAt: string;
  updatedAt: string;
}

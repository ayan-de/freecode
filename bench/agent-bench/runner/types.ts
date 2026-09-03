// =============================================================================
// Shared types for the agent comparison benchmark.
// Spec: docs/superpowers/specs/2026-09-03-agent-comparison-benchmark.md
// =============================================================================

/** One competing agent, described entirely by `agents/<id>.json`. */
export interface AgentSpec {
  id: string;
  /** Argv to print the agent's own version. Recorded in every trial (§10.6). */
  versionCmd: string[];
  /** Argv template. `{prompt}` and `{model}` are substituted per trial. */
  run: string[];
  /**
   * Model string in THIS agent's dialect. Not shared: freecode and opencode
   * want `provider/model`, claude wants a bare id, codex wants its own. A
   * single global `--model` would be wrong for at least one of them.
   */
  model: string;
  /**
   * The flag that got this agent to full autonomy, in plain words. Printed in
   * the results table — running one agent at max autonomy against another at
   * its default measures permission defaults, not agents (spec §6.2).
   */
  autonomy: string;
  env?: Record<string, string>;
  notes?: string;
}

/**
 * A SWE-bench instance, reduced to the four fields a run needs.
 *
 * `patch`, `test_patch` and `hints_text` are deliberately absent: they are the
 * answer key, and `instances.ts` drops them before anything touches disk.
 */
export interface Instance {
  instanceId: string;
  repo: string;
  baseCommit: string;
  problemStatement: string;
}

export interface TrialRecord {
  agent: string;
  agentVersion: string;
  model: string;
  autonomy: string;
  instanceId: string;
  trial: number;
  /**
   * `none` until the container lands (Phase 1). Recorded per trial so a Phase 0
   * number can never be mistaken for a publishable one: without a container
   * there is no network block and no config isolation.
   */
  isolation: "none" | "container";
  producedPatch: boolean;
  reason: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  patchBytes: number;
  /** Files the agent created that are not part of a fix — scratch-file noise. */
  newFiles: string[];
  artifactDir: string;
}

export interface Report {
  startedAt: string;
  finishedAt: string;
  isolation: "none" | "container";
  graded: boolean;
  trials: TrialRecord[];
}

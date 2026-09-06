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
  /**
   * A config file this agent needs written per trial, because it has no env
   * var or flag for the setting. `contents` is rendered with `{proxyOrigin}`
   * and `{model}` and written to `<trial>/agent-config/<path>`; the directory
   * is what `{configDir}` in `env` resolves to.
   *
   * This exists for opencode: it resolves its endpoint from models.dev and
   * honours neither `MINIMAX_BASE_URL` nor `ANTHROPIC_BASE_URL`, so on an
   * `--internal` network it has no route to the model and every trial would
   * fail for a reason that is about plumbing, not the agent. Its config file
   * DOES take a provider baseURL (verified against 1.18.25), which is the
   * only way found to point it at the recording proxy.
   */
  configFile?: { path: string; contents: unknown };
  /**
   * Directory (relative to bench/agent-bench/) copied into the per-trial config
   * dir before `configFile` is rendered over it.
   *
   * opencode npm-installs `@opencode-ai/plugin` — 62 MB — into a fresh
   * XDG_CONFIG_HOME on first run, `--pure` included. Under `--isolate` there is
   * no network to install it from, so the packages must already be there. The
   * seed is a git-ignored cache, not committed: see AGENT-BENCH.md §1.
   */
  configSeed?: string;
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
  /** Per-trial artifact dump, relative to bench/agent-bench/. */
  artifactDir: string;
  /** Round-trips seen by the recording proxy. Absent when `--no-meter`. */
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** MiniMax-M3 USD off the proxy; null when the model is unpriced. */
  usd?: number | null;
  /** False when the proxy saw a request that was not the model endpoint. */
  auditOk?: boolean;
  /**
   * The official SWE-bench grader's verdict for this trial's patch. Written
   * only by `grade.ts` — never inferred from producedPatch. `null` after a
   * grading run means the harness errored on this instance; absent means the
   * run was never graded.
   */
  resolved?: boolean | null;
}

export interface Report {
  startedAt: string;
  finishedAt: string;
  isolation: "none" | "container";
  graded: boolean;
  trials: TrialRecord[];
}

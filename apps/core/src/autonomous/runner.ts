// =============================================================================
// Autonomous Runs — foreground bounded-run driver
// PRIMARY: runAutonomous() repeatedly drives the agent loop with the gate's
// continuation message, checking the four-way budget ceiling and the verify
// gate after every turn, until one of them says stop. Runs synchronously in
// the caller's process — no detach/PID/crash-recovery yet, that is Phase 2
// (§4.4). Deliberately decoupled from agent/loop.ts's AgentLoop class via the
// TurnRunner interface below, so this file has no dependency on the DI/Effect
// wiring loop.ts requires and can be unit-tested with a fake.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md, §4.4, §8 (Phase 1)
// =============================================================================

import { checkBudget, countedTokens } from "./budget.js";
import { runGate, type GateResult } from "./gate.js";
import { buildGateFailureContinuation } from "./prompts.js";
import { saveRunManifest } from "./run-store.js";
import type { RunManifest } from "./types.js";

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface TurnResult {
  success: boolean;
  usage?: TurnUsage;
}

/** One call drives the agent loop's own internal turn cycle to completion (a
 * response with no further tool calls) or failure — mirrors loop.run()'s
 * public contract without importing AgentLoop directly. */
export interface TurnRunner {
  runTurn(prompt: string): Promise<TurnResult>;
}

export interface AutonomousRunOptions {
  manifest: RunManifest;
  worktreePath: string;
  turnRunner: TurnRunner;
  /**
   * No pricing table exists in FreeCode yet (spec §10, open question 1), so
   * this defaults to always-zero — meaning maxUsd never trips unless the
   * caller supplies a real estimator. Documented gap, not silently wrong.
   */
  estimateUsd?: (usage: RunManifest["usage"]) => number;
  signal?: AbortSignal;
  /** Persists a manifest checkpoint after every turn. Defaults to disk via run-store.ts. */
  persist?: (manifest: RunManifest) => void;
}

export async function runAutonomous(
  options: AutonomousRunOptions,
): Promise<RunManifest> {
  const { manifest, worktreePath, turnRunner, signal } = options;
  const estimateUsd = options.estimateUsd ?? (() => 0);
  const persist = options.persist ?? saveRunManifest;
  const start = Date.now();

  let prompt = manifest.mission ?? "Begin.";
  let gateSnapshot: string | undefined;
  let gateResult: GateResult | undefined;

  for (;;) {
    if (signal?.aborted) {
      manifest.status = "cancelled";
      manifest.stopReason = "cancelled";
      persist(manifest);
      return manifest;
    }

    const turn = await turnRunner.runTurn(prompt);
    manifest.usage.elapsedMs = Date.now() - start;

    if (!turn.success) {
      manifest.status = "failed";
      persist(manifest);
      return manifest;
    }

    manifest.usage.turns += 1;
    if (turn.usage) manifest.usage.countedTokens += countedTokens(turn.usage);
    manifest.usage.usd = estimateUsd(manifest.usage);
    persist(manifest);

    const stopReason = checkBudget(manifest.usage, manifest.limits);
    if (stopReason) {
      manifest.status = "failed";
      manifest.stopReason = stopReason;
      persist(manifest);
      return manifest;
    }

    const gate = runGate(
      manifest.verifyCommand,
      worktreePath,
      gateSnapshot,
      gateResult,
    );
    gateSnapshot = gate.snapshot;
    gateResult = gate.result;

    if (gate.result.passed) {
      manifest.status = "completed";
      manifest.stopReason = "gatePassed";
      persist(manifest);
      return manifest;
    }

    prompt = buildGateFailureContinuation(manifest.verifyCommand, gate.result);
  }
}

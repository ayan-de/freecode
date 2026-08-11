// =============================================================================
// Autonomous Runs Supervisor — detached child process + crash recovery
// PRIMARY: spawn a run as a detached child so it survives the parent CLI
// exiting, track liveness via the PID recorded in the manifest, and detect a
// dead child on the next status check rather than reporting "running" forever.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md, §4.4(a), §5.1
// Phase 2: the spawn/liveness/cancel mechanics only, deliberately generic over
// *what* gets spawned (a `command`/`args` pair) rather than hardcoded to a
// FreeCode child entrypoint — wiring a real AgentLoop-backed child process is
// its own follow-up integration, same scoping choice Phase 1 made for
// runner.ts's TurnRunner interface.
// =============================================================================

import { spawn } from "child_process";
import { loadRunManifest, saveRunManifest } from "./run-store.js";
import type { RunManifest } from "./types.js";

/**
 * Spawn a detached child and record its PID on the manifest. The parent
 * process may exit immediately after this returns — the child's stdio is
 * fully detached (`ignore`), so it must do its own logging to disk.
 */
export function spawnRun(
  manifest: RunManifest,
  command: string,
  args: string[],
): RunManifest {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
  const updated: RunManifest = { ...manifest, pid: child.pid };
  saveRunManifest(updated);
  return updated;
}

/** `kill -0` liveness probe — signals nothing, just checks the PID exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reconcile a manifest against reality: if it claims "running" but its PID is
 * dead, the child crashed without getting to update its own status — mark it
 * `crashed` rather than leaving it ambiguously "running" forever (§5.1).
 * Any later `freecode` invocation calls this before trusting a manifest.
 */
export function reconcileRunStatus(runId: string): RunManifest | undefined {
  const manifest = loadRunManifest(runId);
  if (!manifest) return undefined;
  if (manifest.status !== "running") return manifest;
  if (manifest.pid !== undefined && isAlive(manifest.pid)) return manifest;
  const crashed: RunManifest = {
    ...manifest,
    status: "crashed",
    stopReason: "crashed",
  };
  saveRunManifest(crashed);
  return crashed;
}

/**
 * "Checked, not signaled" cancellation (§5.1): sets a flag on disk the run's
 * own loop polls at its next turn boundary, rather than sending a signal that
 * could land mid-write. A hard kill is the fallback the caller can reach for
 * separately if the run doesn't check in within a grace period — not built
 * here, since nothing in Phase 2 needs it yet.
 */
export function requestCancel(runId: string): RunManifest | undefined {
  const manifest = loadRunManifest(runId);
  if (!manifest) return undefined;
  const updated: RunManifest = { ...manifest, cancelRequested: true };
  saveRunManifest(updated);
  return updated;
}

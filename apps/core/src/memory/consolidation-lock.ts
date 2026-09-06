// =============================================================================
// Consolidation lock (spec D8), taken from claude-code's consolidationLock.ts.
//
// The lock file's **mtime is the last-consolidated timestamp**. So the time
// gate is one `stat`, there is no separate state file to keep in sync, and
// advancing the mtime *is* acquiring the lock — which means a crashed run
// self-heals after `minHours` instead of wedging a stale lock forever.
//
// Two amendments from codex. Outcomes are three-way, because a run that
// correctly decided there was nothing to do must advance the schedule while a
// run that *failed* must not; collapsing them means either re-running a healthy
// no-op every scan or suppressing retries after a genuine error. And failures
// back off rather than costing a flat day.
//
// It lives under `.graph/` because it is derived state: deleting the sidecar
// resets the schedule, which is correct.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../utils/logger.js";

const LOCK_FILE = "consolidation.lock";
const STATE_FILE = "consolidation.json";
// Exclusive-create in-progress marker. The mtime lock alone is check-then-set:
// two processes hitting the daily gate together both "acquired" it and ran two
// full consolidations concurrently — interleaved merges/deletes and concurrent
// `git commit`s in the same repo, not the wasted no-op the old comment claimed.
const RUN_LOCK_FILE = "consolidation.running";
// A crashed consolidator must not wedge the run lock forever. A run is one
// model call plus file writes — minutes at most — so anything older is a corpse.
const RUN_LOCK_STALE_MS = 30 * 60_000;

export type ConsolidationOutcome = "succeeded" | "succeeded_no_output" | "failed";

// Backoff after a failure: minutes, not the full cadence. A transient timeout
// should not cost a day, and a persistent failure converges on the daily
// schedule anyway.
const RETRY_BACKOFF_MS = 10 * 60_000;

interface LockState {
  lastOutcome?: ConsolidationOutcome;
  retryAt?: number;
}

function lockPath(graphDir: string): string {
  return path.join(graphDir, LOCK_FILE);
}

function statePath(graphDir: string): string {
  return path.join(graphDir, STATE_FILE);
}

function runLockPath(graphDir: string): string {
  return path.join(graphDir, RUN_LOCK_FILE);
}

// `wx` create is the only genuinely atomic primitive here: exactly one process
// wins it. A loser whose rival's marker has gone stale clears the corpse and
// retries the exclusive create once.
function tryTakeRunLock(graphDir: string, now = Date.now()): boolean {
  const p = runLockPath(graphDir);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(p, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      try {
        if (now - fs.statSync(p).mtimeMs <= RUN_LOCK_STALE_MS) return false;
        fs.rmSync(p, { force: true });
      } catch {
        return false;
      }
    }
  }
  return false;
}

function releaseRunLock(graphDir: string): void {
  try {
    fs.rmSync(runLockPath(graphDir), { force: true });
  } catch {
    // Nothing to do; staleness recovery covers it.
  }
}

/** Epoch ms of the last consolidation, or 0 if there has never been one. */
export function readLastConsolidatedAt(graphDir: string): number {
  try {
    return fs.statSync(lockPath(graphDir)).mtimeMs;
  } catch {
    return 0;
  }
}

export function readLockState(graphDir: string): LockState {
  try {
    return JSON.parse(fs.readFileSync(statePath(graphDir), "utf-8")) as LockState;
  } catch {
    return {};
  }
}

/** True when a previous failure's backoff has not yet elapsed. */
export function inRetryBackoff(graphDir: string, now = Date.now()): boolean {
  const { retryAt } = readLockState(graphDir);
  return typeof retryAt === "number" && now < retryAt;
}

/**
 * Take the lock, returning the prior mtime so a failure can rewind to it.
 *
 * `null` means another process holds or just advanced it. The mtime file is
 * still the schedule (its mtime is the last-consolidated timestamp), but
 * mutual exclusion comes from the exclusive-create run marker — the mtime
 * check alone was check-then-set and let two daily-gated processes run full
 * concurrent consolidations. The marker is released by
 * recordConsolidationOutcome / rollbackConsolidationLock, and a corpse from a
 * crashed run self-heals after RUN_LOCK_STALE_MS.
 */
export function tryAcquireConsolidationLock(graphDir: string): number | null {
  try {
    fs.mkdirSync(graphDir, { recursive: true });
    if (!tryTakeRunLock(graphDir)) return null;
    const before = readLastConsolidatedAt(graphDir);
    const now = new Date();
    fs.writeFileSync(lockPath(graphDir), "");
    fs.utimesSync(lockPath(graphDir), now, now);
    return before;
  } catch (error) {
    logger.debug("[MemoryConsolidation] could not acquire lock", { error });
    releaseRunLock(graphDir);
    return null;
  }
}

/**
 * Rewind the lock after a failed run so the time gate passes again, and record
 * a backoff so a crashing consolidator cannot hot-loop.
 */
export function rollbackConsolidationLock(
  graphDir: string,
  priorMtime: number,
  now = Date.now(),
): void {
  try {
    if (priorMtime > 0) {
      const at = new Date(priorMtime);
      fs.utimesSync(lockPath(graphDir), at, at);
    } else {
      fs.rmSync(lockPath(graphDir), { force: true });
    }
    writeState(graphDir, {
      lastOutcome: "failed",
      retryAt: now + RETRY_BACKOFF_MS,
    });
  } catch (error) {
    logger.debug("[MemoryConsolidation] could not roll back lock", { error });
  } finally {
    releaseRunLock(graphDir);
  }
}

/** Record a successful run (with or without output) and clear any backoff. */
export function recordConsolidationOutcome(
  graphDir: string,
  outcome: Exclude<ConsolidationOutcome, "failed">,
): void {
  writeState(graphDir, { lastOutcome: outcome });
  releaseRunLock(graphDir);
}

function writeState(graphDir: string, state: LockState): void {
  try {
    fs.mkdirSync(graphDir, { recursive: true });
    fs.writeFileSync(statePath(graphDir), JSON.stringify(state));
  } catch (error) {
    logger.debug("[MemoryConsolidation] could not write lock state", { error });
  }
}

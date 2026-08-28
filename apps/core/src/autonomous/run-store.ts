// =============================================================================
// Run store — manifest read/write under ~/.freecode/runs/<run_id>/.
//
// Writes are atomic (tmp + rename), matching `memory/graph/vector-store.ts` and
// `memory/usage-store.ts`. This is not ceremony: the run that owns a manifest is
// a detached child that can be killed at any moment, and a half-written
// manifest is indistinguishable from a corrupt one — the file is the only place
// a crashed run's state survives.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md §4.2
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { RunManifest } from "./types.js";

export function runsRoot(): string {
  return (
    process.env.FREECODE_RUNS_HOME ??
    path.join(os.homedir(), ".freecode", "runs")
  );
}

export const runDir = (runId: string): string => path.join(runsRoot(), runId);

export const manifestPath = (runId: string): string =>
  path.join(runDir(runId), "manifest.json");

export const taskCardsDir = (runId: string): string =>
  path.join(runDir(runId), "task-cards");

export const reportPath = (runId: string): string =>
  path.join(runDir(runId), "report.md");

function atomicWrite(filePath: string, data: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, filePath);
}

export function writeManifest(manifest: RunManifest): void {
  atomicWrite(manifestPath(manifest.runId), JSON.stringify(manifest, null, 2));
}

/**
 * Returns null for a missing or unparseable manifest rather than throwing: a
 * caller listing runs must not be stopped by one bad directory, and "cannot be
 * read" and "does not exist" call for the same handling here.
 */
export function readManifest(runId: string): RunManifest | null {
  try {
    return JSON.parse(
      fs.readFileSync(manifestPath(runId), "utf-8"),
    ) as RunManifest;
  } catch {
    return null;
  }
}

/** Newest first. Directories without a readable manifest are skipped. */
export function listRuns(): RunManifest[] {
  let ids: string[];
  try {
    ids = fs.readdirSync(runsRoot());
  } catch {
    return [];
  }
  return ids
    .map(readManifest)
    .filter((m): m is RunManifest => m !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Read, transform, write — the only supported way to change a live manifest.
 *
 * Read-modify-write rather than a partial patch because the writer is a
 * detached process that may have advanced the manifest since the caller last
 * looked; taking the fields from disk means a stale caller cannot silently
 * roll back the run's own progress. Returns null when the manifest is gone.
 */
export function updateManifest(
  runId: string,
  change: (manifest: RunManifest) => RunManifest,
): RunManifest | null {
  const current = readManifest(runId);
  if (!current) return null;
  const next = change(current);
  writeManifest(next);
  return next;
}

/** Request cancellation. Checked at the next turn boundary, never signalled. */
export function requestCancel(runId: string): boolean {
  return (
    updateManifest(runId, (m) => ({ ...m, cancelRequested: true })) !== null
  );
}

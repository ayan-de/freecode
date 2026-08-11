// =============================================================================
// Autonomous Runs Store — manifest.json read/write, atomic
// PRIMARY: create/load/save a RunManifest under ~/.freecode/runs/<run_id>/.
// Reuses harness/store.ts's atomic tmp+rename pattern (§4.2 explicitly calls
// for reusing it) and CONFIG_DIR from providers/config.ts.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md, §4.2
// Phase 0: manifest only, no child-process/execution wiring (that's Phase 2).
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { CONFIG_DIR } from "../providers/config.js";
import type { RunLimits, RunManifest } from "./types.js";

const RUNS_DIR_NAME = "runs";
const MANIFEST_FILE = "manifest.json";

export function getRunsDir(): string {
  return path.join(CONFIG_DIR, RUNS_DIR_NAME);
}

export function getRunDir(runId: string): string {
  return path.join(getRunsDir(), runId);
}

export function getManifestPath(runId: string): string {
  return path.join(getRunDir(runId), MANIFEST_FILE);
}

export function createRunManifest(
  limits: RunLimits,
  verifyCommand: string,
  mission?: string,
): RunManifest {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    status: "running",
    limits,
    usage: { turns: 0, countedTokens: 0, elapsedMs: 0, usd: 0 },
    verifyCommand,
    mission,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Defensive load, same reasoning as harness/store.ts's loadHarnessState:
 * corrupt/missing/non-object degrades to undefined rather than throwing.
 */
export function loadRunManifest(runId: string): RunManifest | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(getManifestPath(runId), "utf-8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return undefined;
    }
    return raw as RunManifest;
  } catch {
    return undefined;
  }
}

/** Atomic write: temp file + rename, mirrors harness/store.ts's saveHarnessState. */
export function saveRunManifest(manifest: RunManifest): string {
  const runDir = getRunDir(manifest.id);
  const manifestPath = getManifestPath(manifest.id);
  const tempPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  fs.mkdirSync(runDir, { recursive: true });
  try {
    const mode = fs.existsSync(manifestPath)
      ? fs.statSync(manifestPath).mode & 0o777
      : 0o600;
    fs.writeFileSync(
      tempPath,
      `${JSON.stringify({ ...manifest, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      { encoding: "utf-8", mode },
    );
    fs.renameSync(tempPath, manifestPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
  return manifestPath;
}

export function listRunIds(): string[] {
  const dir = getRunsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

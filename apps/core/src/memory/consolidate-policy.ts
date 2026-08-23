// =============================================================================
// Consolidation policy (spec D7) — the gates, cheapest first, mirroring
// claude-code's autoDream. A skipped run costs a settings read and one `stat`.
//
// Gate 4 is where we improve on the prior art. claude-code scans a transcript
// directory and compares file mtimes; we already have SessionStore.list({
// projectPath }) returning metadata with lastTurnAt and turnCount — project
// scoped, no directory walk, no mtime heuristics, and it correctly ignores
// sessions from *other* projects that happen to share a machine.
// =============================================================================

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  inRetryBackoff,
  readLastConsolidatedAt,
} from "./consolidation-lock.js";

export const DEFAULT_MIN_HOURS = 24;
export const DEFAULT_MIN_SESSIONS = 5;
// Between full gate evaluations. The time gate can pass while the session gate
// does not, and re-checking that every completion is pointless work.
const SCAN_THROTTLE_MS = 10 * 60_000;
// A session with fewer turns than this held nothing worth consolidating.
const MIN_TURNS_PER_SESSION = 2;

const ENV_DISABLE = "FREECODE_DISABLE_MEMORY_CONSOLIDATION";

export interface ConsolidationSettings {
  autoConsolidate: boolean;
  minHours: number;
  minSessions: number;
}

export interface SessionSummary {
  id: string;
  lastTurnAt: number;
  turnCount: number;
}

export interface ConsolidateDecisionInput {
  projectRoot: string;
  graphDir: string;
  /** Sessions for THIS project only. */
  sessions: SessionSummary[];
  /** Excluded from the count — it has not finished yet. */
  currentSessionId: string;
  /** Set when this process has seen a provider rate-limit error. */
  rateLimited?: boolean;
  now?: number;
}

export interface ConsolidateDecision {
  consolidate: boolean;
  reason: string;
}

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function readScope(filePath: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      memory?: Record<string, unknown>;
    };
    return parsed.memory;
  } catch {
    // Missing or malformed → next scope, then defaults. An unparseable settings
    // file must not silently disable memory.
    return undefined;
  }
}

export function loadConsolidationSettings(
  projectRoot: string,
): ConsolidationSettings {
  const scopes = [
    path.join(projectRoot, ".freecode", "settings.json"),
    path.join(os.homedir(), ".freecode", "settings.json"),
  ];

  let autoConsolidate: boolean | undefined;
  let minHours: number | undefined;
  let minSessions: number | undefined;

  for (const file of scopes) {
    const memory = readScope(file);
    if (!memory) continue;
    if (
      autoConsolidate === undefined &&
      typeof memory.autoConsolidate === "boolean"
    ) {
      autoConsolidate = memory.autoConsolidate;
    }
    if (
      minHours === undefined &&
      typeof memory.consolidateMinHours === "number" &&
      memory.consolidateMinHours >= 0
    ) {
      minHours = memory.consolidateMinHours;
    }
    if (
      minSessions === undefined &&
      typeof memory.consolidateMinSessions === "number" &&
      memory.consolidateMinSessions >= 1
    ) {
      minSessions = Math.floor(memory.consolidateMinSessions);
    }
  }

  return {
    autoConsolidate: autoConsolidate ?? true,
    minHours: minHours ?? DEFAULT_MIN_HOURS,
    minSessions: minSessions ?? DEFAULT_MIN_SESSIONS,
  };
}

// In-process, per project. Cheap enough that it does not need persisting: a
// restart re-checking once is harmless.
const lastScan = new Map<string, number>();

/** Test seam. */
export function resetConsolidatePolicy(): void {
  lastScan.clear();
}

export function shouldConsolidate(
  input: ConsolidateDecisionInput,
): ConsolidateDecision {
  const now = input.now ?? Date.now();

  if (isEnvTruthy(process.env[ENV_DISABLE])) {
    return { consolidate: false, reason: `disabled by ${ENV_DISABLE}` };
  }

  const settings = loadConsolidationSettings(input.projectRoot);
  if (!settings.autoConsolidate) {
    return {
      consolidate: false,
      reason: "disabled by settings (memory.autoConsolidate)",
    };
  }

  // codex skips background memory work when the account's quota is nearly
  // spent (guard.rs). We have no provider-agnostic quota signal, so this gates
  // on what we can see. Fails in the safe direction.
  if (input.rateLimited) {
    return { consolidate: false, reason: "provider rate limit seen this run" };
  }

  const lastConsolidated = readLastConsolidatedAt(input.graphDir);
  const hoursSince = (now - lastConsolidated) / 3_600_000;
  if (lastConsolidated > 0 && hoursSince < settings.minHours) {
    return {
      consolidate: false,
      reason: `${hoursSince.toFixed(1)}h since last, need ${settings.minHours}h`,
    };
  }

  if (inRetryBackoff(input.graphDir, now)) {
    return { consolidate: false, reason: "backing off after a failed run" };
  }

  const scanned = lastScan.get(input.projectRoot) ?? 0;
  if (now - scanned < SCAN_THROTTLE_MS) {
    return { consolidate: false, reason: "scan throttled" };
  }
  lastScan.set(input.projectRoot, now);

  const eligible = input.sessions.filter(
    (s) =>
      s.id !== input.currentSessionId &&
      s.turnCount >= MIN_TURNS_PER_SESSION &&
      s.lastTurnAt > lastConsolidated,
  );
  if (eligible.length < settings.minSessions) {
    return {
      consolidate: false,
      reason: `${eligible.length} sessions since last, need ${settings.minSessions}`,
    };
  }

  return {
    consolidate: true,
    reason: `${eligible.length} sessions over ${hoursSince.toFixed(1)}h`,
  };
}

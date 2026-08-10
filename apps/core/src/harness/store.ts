// =============================================================================
// Continual Harness Store — load / merge / save
// PRIMARY: read and write harness_state.json, global and per-session-local.
// Spec: docs/superpowers/specs/2026-08-08-continual-harness-design.md, §3.2/§3.6/§4.2
// Phase 1: load + merge + atomic save, all defensive (never throw — this runs
// on every system-prompt build, same reasoning as prime-agent's
// loadHarnessState). Phase 2 adds the local-session directory resolver below
// (resolveSessionHarnessDir) and the distill tool/planner/apply, which is the
// first writer this store has ever had outside a test.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { CONFIG_DIR } from "../providers/config.js";
import { formatSessionDirName } from "../store/path-formatter.js";
import {
  HARNESS_KINDS,
  type HarnessEntry,
  type HarnessScope,
  type HarnessState,
} from "./types.js";

const HARNESS_STATE_FILE = "harness_state.json";
const HARNESS_DIR_NAME = "harness";
// Mirrors session/store.ts's private SESSION_DIR + sessionDir() layout
// (`~/.freecode/sessions/<formatted-project-dir>/<sessionId>/`). Duplicated
// rather than imported because SessionStore has no public accessor for a
// session's on-disk directory — see resolveSessionHarnessDir below.
const SESSIONS_DIR_NAME = "sessions";

export function emptyHarnessState(): HarnessState {
  return {
    schema: 1,
    entries: {
      prompt: {},
      memory: {},
      skill: {},
      subagent: {},
    },
    distillations: [],
  };
}

export function getGlobalHarnessDir(): string {
  return path.join(CONFIG_DIR, HARNESS_DIR_NAME);
}

export function getLocalHarnessDir(
  sessionArtifactDir: string | undefined,
): string | undefined {
  return sessionArtifactDir
    ? path.join(sessionArtifactDir, HARNESS_DIR_NAME)
    : undefined;
}

/**
 * Resolve a session's local harness directory directly from (projectPath,
 * sessionId), without going through SessionStore. This is the local-scope
 * counterpart to getGlobalHarnessDir, unblocking Phase 2 without adding a
 * new method to the SessionStore interface (and its sqlite/json/remote
 * implementations) for a directory path only this feature needs.
 */
export function resolveSessionHarnessDir(
  projectPath: string,
  sessionId: string,
): string {
  const sessionDir = path.join(
    CONFIG_DIR,
    SESSIONS_DIR_NAME,
    formatSessionDirName(projectPath),
    sessionId,
  );
  return getLocalHarnessDir(sessionDir) as string;
}

export function getHarnessStatePath(harnessDir: string): string {
  return path.join(harnessDir, HARNESS_STATE_FILE);
}

function normalizeScope(value: unknown, fallback: HarnessScope): HarnessScope {
  return value === "global" || value === "local" ? value : fallback;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Load harness state from disk. Runs on every system-prompt build (once wired
 * into the loop), so a corrupt or missing file must degrade to empty rather
 * than throw — the alternative kills every turn on one bad write. Mirrors
 * prime-agent's loadHarnessState (refinement.ts:281-324) field-for-field.
 */
export function loadHarnessState(
  harnessDir: string,
  scope: HarnessScope,
): HarnessState {
  const statePath = getHarnessStatePath(harnessDir);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch {
    return emptyHarnessState();
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return emptyHarnessState();
  }
  const parsed = raw as Partial<HarnessState>;
  const state = emptyHarnessState();
  state.schema = typeof parsed.schema === "number" ? parsed.schema : 1;

  for (const kind of HARNESS_KINDS) {
    const records = parsed.entries?.[kind];
    if (!records || typeof records !== "object") continue;
    for (const [id, rawEntry] of Object.entries(records)) {
      const entry = objectRecord(rawEntry);
      if (!entry.title || !entry.content) continue; // not a usable entry
      state.entries[kind][id] = {
        id,
        kind,
        title: String(entry.title),
        content: String(entry.content),
        path: typeof entry.path === "string" ? entry.path : "general",
        scope: normalizeScope(entry.scope, scope),
        reference: objectRecord(entry.reference),
        arguments: objectRecord(entry.arguments),
        metadata: objectRecord(entry.metadata),
        source: typeof entry.source === "string" ? entry.source : "unknown",
        createdAt:
          typeof entry.createdAt === "string"
            ? entry.createdAt
            : new Date(0).toISOString(),
        updatedAt:
          typeof entry.updatedAt === "string"
            ? entry.updatedAt
            : new Date(0).toISOString(),
        version: typeof entry.version === "number" ? entry.version : 1,
      };
    }
  }
  if (Array.isArray(parsed.distillations)) {
    state.distillations = parsed.distillations as HarnessState["distillations"];
  }
  return state;
}

/**
 * Union global and local for prompt injection. On an id collision the local
 * entry is re-keyed to `local:<id>` so both remain visible — matches
 * prime-agent's mergeHarnessStates (refinement.ts:326-343). Local is not
 * written yet (Phase 2), so today `local` is always empty in the live path;
 * this exists and is tested so Phase 2 has no merge logic to invent.
 */
export function mergeHarnessStates(
  global: HarnessState,
  local?: HarnessState,
): HarnessState {
  const merged = emptyHarnessState();
  merged.schema = Math.max(global.schema, local?.schema ?? 1);
  for (const kind of HARNESS_KINDS) {
    for (const [id, entry] of Object.entries(global.entries[kind])) {
      merged.entries[kind][id] = {
        ...entry,
        scope: normalizeScope(entry.scope, "global"),
      };
    }
    for (const [id, entry] of Object.entries(local?.entries[kind] ?? {})) {
      const scoped: HarnessEntry = {
        ...entry,
        scope: normalizeScope(entry.scope, "local"),
      };
      const mergedId = merged.entries[kind][id] ? `local:${id}` : id;
      merged.entries[kind][mergedId] = scoped;
    }
  }
  merged.distillations = [
    ...global.distillations,
    ...(local?.distillations ?? []),
  ];
  return merged;
}

/**
 * Atomic write: temp file + rename, so a crash mid-write never corrupts an
 * existing store. Preserves the file's existing mode, defaulting to 0o600 —
 * harness content can carry project-specific detail and has no reason to be
 * world-readable. Mirrors prime-agent's saveHarnessState (refinement.ts:345-359).
 */
export function saveHarnessState(
  harnessDir: string,
  state: HarnessState,
): string {
  const statePath = getHarnessStatePath(harnessDir);
  const tempPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.mkdirSync(harnessDir, { recursive: true });
  try {
    const mode = fs.existsSync(statePath)
      ? fs.statSync(statePath).mode & 0o777
      : 0o600;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf-8",
      mode,
    });
    fs.renameSync(tempPath, statePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
  return statePath;
}

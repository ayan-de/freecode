// =============================================================================
// Output-store config - the tunable knobs, read once at module load.
// There is no generic config accessor in this codebase (only provider/mcp/cli
// config), so these are env vars with sane defaults — no new infra (spec Phase 3).
// =============================================================================

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

// Per-session store budget; oldest outputs evict past this (byte-LRU).
export const STORE_BYTES = envInt("FREECODE_OUTPUT_STORE_BYTES", 16 * 1024 * 1024);

// Max concurrent per-session stores kept live (session-LRU on the factory).
export const MAX_SESSIONS = envInt("FREECODE_OUTPUT_STORE_SESSIONS", 50);

// Adaptive-truncation budget: total chars shown to the model = HEAD + TAIL.
export const TAIL_CHARS = envInt("FREECODE_OUTPUT_TAIL_CHARS", 6_000);
export const MAX_MODEL_OUTPUT_CHARS = envInt("FREECODE_OUTPUT_MAX_CHARS", 30_000);
export const HEAD_CHARS = Math.max(0, MAX_MODEL_OUTPUT_CHARS - TAIL_CHARS);

// Default line window per `output` call (offset/limit path).
export const DEFAULT_LINES = envInt("FREECODE_OUTPUT_LINES", 200);

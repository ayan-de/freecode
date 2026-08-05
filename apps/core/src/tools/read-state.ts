// =============================================================================
// Read state — per-session record of which files the model has already been
// shown, so an unchanged re-read costs a line instead of the whole file again.
//
// Keyed by sessionId like the output store, rather than threaded through
// ToolContext: the context object is rebuilt per tool call in the loop, and
// `sessionId` is already on it.
//
// Spec 2026-08-05-token-efficiency, RC5. Mirrors claude-code's readFileState
// (tools/FileReadTool/FileReadTool.ts:542), including the two conditions that
// make dedup safe rather than merely cheap — see canDedup below.
// =============================================================================

export interface ReadRecord {
  /** Modification time when the content was captured. */
  mtimeMs: number;
  size: number;
  /**
   * The line window that was shown. Set only by `read`.
   *
   * `edit`/`write` record a file they *mutated*, whose new content the model
   * has never been shown — deduping against one of those would tell the model
   * "you already have this" while the transcript holds the pre-edit text.
   * Leaving these undefined keeps them out of dedup while still feeding the
   * staleness check.
   */
  offset?: number;
  limit?: number;
  /**
   * False once the shown content has been pruned out of the request.
   *
   * Dedup's whole premise is that the earlier result is still in context.
   * Prefix-stable pruning (RC4) can replace a large read result with a marker,
   * at which point pointing the model back at it would leave it with nothing.
   */
  inContext: boolean;
}

const states = new Map<string, Map<string, ReadRecord>>();

export function getReadState(sessionId: string): Map<string, ReadRecord> {
  let state = states.get(sessionId);
  if (!state) {
    state = new Map();
    states.set(sessionId, state);
  }
  return state;
}

export function disposeReadState(sessionId: string): void {
  states.delete(sessionId);
}

/**
 * Escape hatch: `FREECODE_READ_DEDUP=0` sends the full body every time.
 *
 * Of everything in the token-efficiency work this is the only change that
 * alters what the model *sees* rather than how much it is billed for, so it is
 * the only one that can confuse a model rather than merely cost more.
 * claude-code ships the same switch (`tengu_read_dedup_killswitch`).
 */
function dedupEnabled(): boolean {
  return process.env.FREECODE_READ_DEDUP !== "0";
}

/**
 * True when a re-read can be answered with a pointer instead of the content:
 * same session, same file, same line window, unchanged on disk, and the
 * earlier copy is still in the request.
 */
export function canDedup(
  record: ReadRecord | undefined,
  current: { mtimeMs: number; size: number; offset: number; limit: number },
): boolean {
  if (!dedupEnabled()) return false;
  if (!record || !record.inContext) return false;
  // Undefined offset means the record came from edit/write, not a read.
  if (record.offset === undefined || record.limit === undefined) return false;
  if (record.offset !== current.offset || record.limit !== current.limit) {
    return false;
  }
  return record.mtimeMs === current.mtimeMs && record.size === current.size;
}

/**
 * Drop the in-context flag for a file whose shown content was just pruned.
 * Called by the loop when it replaces a `read` tool result.
 */
export function markReadPruned(sessionId: string, filePath: string): void {
  const record = states.get(sessionId)?.get(filePath);
  if (record) record.inContext = false;
}

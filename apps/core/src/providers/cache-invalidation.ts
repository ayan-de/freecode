// =============================================================================
// Documented prompt-cache invalidations (spec 2026-08-09-cache-observability).
//
// Some harness actions legitimately change the cached request prefix mid-session
// — compaction rebuilds history, a hook rewrites the system prompt. The resend
// cost is unavoidable for those and must not be reported as a bug.
//
// Code that knowingly invalidates the prefix records why, here, at the site that
// does it. The miss detector then attributes a miss to its documented cause
// instead of alarming.
//
// The inversion is the point: an EMPTY journal around a harness-caused miss is
// itself the signal. It means something changed the prompt without saying why,
// which is exactly the bug class this exists to catch (RC3/RC4 in
// specs/2026-08-05-token-efficiency.md were both that, found by hand months on).
//
// Adapted from jcode's crates/jcode-base/src/cache_invalidation.rs.
// =============================================================================

import { createHash } from "crypto";

import { logger } from "../utils/logger.js";

export interface DocumentedInvalidation {
  at: number;
  /** Short stable label, e.g. "compaction". */
  source: string;
  /** Specifics, good enough to act on from the log alone. */
  detail: string;
}

/** Bounded so a long session cannot grow this without limit. */
const MAX_ENTRIES = 16;

/**
 * How far back a miss may reach to find its cause. A documented invalidation
 * takes effect on the very next request, so this only has to cover the gap
 * between recording and sending — not a whole turn, or an unrelated bust
 * minutes later would be excused by it.
 */
const ATTRIBUTION_WINDOW_MS = 60_000;

const journal = new Map<string, DocumentedInvalidation[]>();

/** Record an intentional prefix invalidation for `sessionId`. */
export function recordInvalidation(
  sessionId: string,
  source: string,
  detail: string,
): void {
  const entries = journal.get(sessionId) ?? [];
  entries.push({ at: Date.now(), source, detail });
  if (entries.length > MAX_ENTRIES) entries.shift();
  journal.set(sessionId, entries);
  logger.debug(
    `[cache] documented invalidation source=${source} detail=${detail}`,
  );
}

/** The most recent documented invalidation still inside the window, if any. */
export function findRecentInvalidation(
  sessionId: string,
  now = Date.now(),
): DocumentedInvalidation | undefined {
  const entries = journal.get(sessionId);
  if (!entries) return undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (now - entries[i].at <= ATTRIBUTION_WINDOW_MS) return entries[i];
  }
  return undefined;
}

/** Fingerprint of the static system block, per session — see noteStaticPrefix. */
const staticPrefixes = new Map<string, string>();

/**
 * Record the static system block for `sessionId`, documenting an invalidation
 * when it differs from the previous turn's.
 *
 * That block is recompiled from disk on every turn (compiler
 * compileSystemBlocks), so editing CLAUDE.md / AGENTS.md mid-session — or
 * adding a skill — rewrites the first cache breakpoint and therefore every
 * byte behind it. The resend is legitimate and unavoidable, but until now it
 * was also undocumented, so D2 reported the user's own edit as an unexplained
 * harness bust. One false alarm a user caused themselves is enough to teach
 * them to ignore the real ones, which is the whole asset this journal protects.
 */
export function noteStaticPrefix(sessionId: string, text: string): void {
  const digest = createHash("sha256").update(text).digest("hex");
  const previous = staticPrefixes.get(sessionId);
  staticPrefixes.set(sessionId, digest);
  // The first turn only establishes the baseline: no cached prefix exists yet,
  // so there is nothing for the change to have invalidated.
  if (previous === undefined || previous === digest) return;
  recordInvalidation(
    sessionId,
    "system prompt changed",
    "the static system block changed mid-session (an edited CLAUDE.md/AGENTS.md, or a skill added or removed)",
  );
}

/** Drop a finished session's journal and prefix fingerprint. */
export function clearInvalidations(sessionId: string): void {
  journal.delete(sessionId);
  staticPrefixes.delete(sessionId);
}

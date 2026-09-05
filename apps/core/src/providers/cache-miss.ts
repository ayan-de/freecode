// =============================================================================
// Prompt-cache miss detector (spec 2026-08-09-cache-observability, D2).
//
// The hit rate says money is being lost. This says which turn lost it, and
// whether the cause was legitimate. Adapted from jcode's KV-cache miss detector
// (crates/jcode-tui/src/tui/app.rs).
//
// Detection is deliberately conservative: it reports only what cannot happen in
// a healthy session, because a detector that cries wolf gets switched off long
// before it catches anything. An undocumented miss is additionally held for one
// sample before alarming — implicit provider caches (MiniMax, DeepSeek) miss
// for non-rewrite reasons (write latency, eviction), and a read that recovers
// to the pre-miss boundary on the very next call proves the prefix never
// changed. See PendingMiss.
// =============================================================================

import { findRecentInvalidation } from "./cache-invalidation.js";

export type CacheProblemKind =
  | "expected_read_missing"
  | "unexpected_creation";

export interface CacheProblem {
  kind: CacheProblemKind;
  /** Tokens re-sent at full price because of this miss. */
  affectedTokens: number;
  /** Set when the journal explains it — then this is not a bug. */
  documentedCause?: string;
}

export interface CacheUsageSample {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
}

interface Baseline {
  /** Prefix known to be cached after the previous call. */
  cachedPrefix: number;
  /**
   * Bumped when compaction replaces the provider-facing history. A sample from
   * an older generation cannot be judged against the new baseline — mirrors
   * jcode's cache_generation, which exists so the rebuild compaction *must*
   * cause is never reported as a bust.
   */
  generation: number;
}

/**
 * An undocumented miss held for one sample before alarming. Implicit provider
 * caches miss for reasons that are not rewrites — a write that had not
 * committed when the next rapid-fire request arrived, a routing/eviction blip.
 * Measured on MiniMax-M3: read collapsed to 128, then the NEXT turn read
 * exactly the pre-miss boundary — only possible if the prefix bytes never
 * changed. So the verdict waits one sample: a read that recovers to at least
 * `suspectedPrefix` proves the old entry was still valid and the miss was the
 * provider's, not ours. A pending miss with no next sample (session end) is
 * dropped — there is no further spend to warn about.
 */
interface PendingMiss {
  problem: CacheProblem;
  /** The prefix that was cached before the miss — the recovery bar. */
  suspectedPrefix: number;
  generation: number;
}

const baselines = new Map<string, Baseline>();
const generations = new Map<string, number>();
const pendings = new Map<string, PendingMiss>();

export function isCacheMissNoticesEnabled(): boolean {
  return process.env.FREECODE_CACHE_MISS_NOTICES !== "0";
}

/** Called when compaction rebuilds history, so the next miss is expected. */
export function bumpCacheGeneration(sessionId: string): void {
  generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1);
  baselines.delete(sessionId);
  // A pending miss can no longer be judged: recovery would be measured
  // against a prefix compaction just replaced.
  pendings.delete(sessionId);
}

export function resetCacheTracking(sessionId: string): void {
  baselines.delete(sessionId);
  generations.delete(sessionId);
  pendings.delete(sessionId);
}

/**
 * Judge one response's usage and update the baseline.
 *
 * Returns a problem only when the numbers are inconsistent with a healthy
 * session. Returns undefined — silence — for the normal case, for the first
 * call of a session, and for any provider that does not report cache fields at
 * all (Gemini, OpenAI): absent data must never look like a miss.
 */
export function checkCacheUsage(
  sessionId: string,
  sample: CacheUsageSample,
  now = Date.now(),
): CacheProblem | undefined {
  const generation = generations.get(sessionId) ?? 0;
  const previous = baselines.get(sessionId);

  // A provider that reports neither read nor write is not caching. Recording a
  // zero baseline would make the next caching turn look like a bust. A pending
  // miss is dropped too — with no cache fields there is no way to observe the
  // recovery that would acquit it, and an unverifiable alarm is the wolf-cry
  // this detector exists to avoid.
  const reportsCache = sample.cacheReadTokens > 0 || sample.cacheWriteTokens > 0;
  if (!reportsCache) {
    baselines.delete(sessionId);
    pendings.delete(sessionId);
    return undefined;
  }

  const cachedPrefix = sample.cacheReadTokens + sample.cacheWriteTokens;
  baselines.set(sessionId, { cachedPrefix, generation });

  // Verdict on last sample's held miss, now that the follow-up is in.
  const pending = pendings.get(sessionId);
  if (pending) {
    pendings.delete(sessionId);
    if (pending.generation === generation) {
      if (sample.cacheReadTokens >= pending.suspectedPrefix) {
        // Recovered to (at least) the pre-miss boundary: the prefix bytes
        // never changed, so the miss was the provider's. Silence.
        return undefined;
      }
      // Still below the bar — the entry really is gone. Alarm now, one
      // sample late. The current sample is not separately judged this call
      // (one alarm per call); a persistent rewrite bug keeps producing
      // pendings, so it still surfaces loudly.
      return pending.problem;
    }
    // Generation moved between miss and verdict: unjudgeable, drop it.
  }

  // Nothing to compare against yet, or history was legitimately rebuilt.
  if (!previous || previous.generation !== generation) return undefined;

  let problem: CacheProblem | undefined;

  if (sample.cacheReadTokens === 0) {
    // The previous call left a prefix cached and this one read none of it.
    problem = {
      kind: "expected_read_missing",
      affectedTokens: previous.cachedPrefix,
    };
  } else if (sample.cacheReadTokens < previous.cachedPrefix) {
    // A prefix can only grow. Reading less than was cached means the bytes at
    // some earlier position changed, so everything after it was re-written.
    problem = {
      kind: "unexpected_creation",
      affectedTokens: previous.cachedPrefix - sample.cacheReadTokens,
    };
  }

  if (!problem) return undefined;

  const documented = findRecentInvalidation(sessionId, now);
  if (documented) {
    problem.documentedCause = `${documented.source}: ${documented.detail}`;
    return problem;
  }

  // Undocumented: hold for one sample. If the next read recovers to the
  // pre-miss boundary this was a provider-side blip, not a rewrite — see
  // PendingMiss.
  pendings.set(sessionId, {
    problem,
    suspectedPrefix: previous.cachedPrefix,
    generation,
  });
  return undefined;
}

/** User-facing line for an undocumented miss. */
export function describeCacheProblem(problem: CacheProblem): string {
  const what =
    problem.kind === "expected_read_missing"
      ? "the prompt cache was not read at all"
      : "part of the cached prefix was re-written";
  return (
    `Prompt-cache miss: ${what} — roughly ${problem.affectedTokens.toLocaleString()} ` +
    `tokens were re-sent at full price with no recorded cause. This usually means ` +
    `something changed an already-sent message.`
  );
}

// =============================================================================
// Prompt-cache awareness (jcode #9). Anthropic's prompt cache has a ~5-minute
// TTL: if more than that elapses between turns, the next request re-reads the
// full context as fresh input (cache MISS) — real money on long contexts. We
// track the last send per session and warn before a send that will miss, and
// surface hit/write token numbers after (see loop wiring + `cache_status` event).
//
// Pure bookkeeping, no provider calls. Non-caching providers are ignored.
// =============================================================================

// Anthropic documents a 5-minute cache lifetime; treat that as the cold line.
const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000;

// Providers whose prompt cache is time-limited (so a gap causes a miss).
// OpenAI/Gemini caching is either automatic-without-TTL-signal or absent here.
const CACHING_PROVIDERS = new Set(["anthropic"]);

const lastSend = new Map<string, number>(); // sessionId → last send epoch ms

// Record a send and return a warning if this send will likely miss a cold cache.
// First send of a session returns null (nothing was cached yet — no miss).
export function noteSendAndCheckCold(
  sessionId: string,
  provider: string,
  now: number = Date.now(),
): string | null {
  if (!CACHING_PROVIDERS.has(provider)) {
    lastSend.set(sessionId, now);
    return null;
  }
  const prev = lastSend.get(sessionId);
  lastSend.set(sessionId, now);
  if (prev === undefined) return null;
  const elapsed = now - prev;
  if (elapsed <= PROMPT_CACHE_TTL_MS) return null;
  const mins = Math.round(elapsed / 60_000);
  return `Prompt cache likely cold (~${mins} min since last turn > 5 min TTL) — this request re-reads the full context as fresh input and will cost more.`;
}

export interface CacheSummary {
  readTokens: number; // served from cache (cheap)
  writeTokens: number; // written to cache this turn (cache-creation)
  hitRatio: number; // read / (read + fresh input), 0..1
}

export function summarizeCache(usage?: {
  inputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}): CacheSummary {
  const read = usage?.cacheReadInputTokens ?? 0;
  const write = usage?.cacheCreationInputTokens ?? 0;
  const fresh = usage?.inputTokens ?? 0;
  const denom = read + fresh;
  return {
    readTokens: read,
    writeTokens: write,
    hitRatio: denom > 0 ? read / denom : 0,
  };
}

export function disposeCacheAwareness(sessionId: string): void {
  lastSend.delete(sessionId);
}

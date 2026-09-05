import assert from "node:assert/strict";
import test from "node:test";
import {
  bumpCacheGeneration,
  checkCacheUsage,
  describeCacheProblem,
  isCacheMissNoticesEnabled,
  resetCacheTracking,
} from "./cache-miss.js";
import { recordInvalidation } from "./cache-invalidation.js";

let seq = 0;
/** A fresh session id per test — the detector keys its state by session. */
function session(): string {
  return `s-${++seq}`;
}

const warm = (read: number, write = 0, input = 100) => ({
  cacheReadTokens: read,
  cacheWriteTokens: write,
  inputTokens: input,
});

test("the first call of a session is never a problem", () => {
  const s = session();
  assert.equal(checkCacheUsage(s, warm(0, 5_000)), undefined);
});

test("a growing prefix is silent", () => {
  const s = session();
  checkCacheUsage(s, warm(0, 10_000)); // first turn writes the prefix
  assert.equal(checkCacheUsage(s, warm(10_000, 500)), undefined);
  assert.equal(checkCacheUsage(s, warm(10_500, 400)), undefined);
});

test("reading nothing after a cached prefix is a miss — reported one sample late", () => {
  const s = session();
  checkCacheUsage(s, warm(0, 10_000));

  // The miss itself is held: it could still be a provider blip.
  assert.equal(checkCacheUsage(s, warm(0, 10_000)), undefined);
  // The follow-up read never recovers to the 10k bar — now it alarms.
  const problem = checkCacheUsage(s, warm(0, 10_000));
  assert.equal(problem?.kind, "expected_read_missing");
  assert.equal(problem?.affectedTokens, 10_000);
  assert.equal(problem?.documentedCause, undefined);
});

test("reading less than was cached means the prefix was re-written", () => {
  const s = session();
  checkCacheUsage(s, warm(0, 10_000));

  // Only 6k of the known 10k prefix survived — 4k was re-sent at full price.
  assert.equal(checkCacheUsage(s, warm(6_000, 4_000)), undefined); // held
  const problem = checkCacheUsage(s, warm(6_000, 4_500)); // still below 10k
  assert.equal(problem?.kind, "unexpected_creation");
  assert.equal(problem?.affectedTokens, 4_000);
});

test("a miss the next read recovers from is a provider blip, not a rewrite", () => {
  const s = session();
  checkCacheUsage(s, warm(0, 22_000));
  // The MiniMax-M3 signature: read collapses to a sliver…
  assert.equal(checkCacheUsage(s, warm(128, 5_000)), undefined);
  // …and the NEXT read resumes at the pre-miss boundary — only possible if
  // the prefix bytes never changed. No alarm, then or later.
  assert.equal(checkCacheUsage(s, warm(22_600, 400)), undefined);
  assert.equal(checkCacheUsage(s, warm(23_000, 300)), undefined);
});

test("a documented invalidation explains the miss instead of alarming", () => {
  const s = session();
  checkCacheUsage(s, warm(0, 10_000));
  recordInvalidation(s, "compaction", "auto compaction: 190000 → 40000 tokens");

  const problem = checkCacheUsage(s, warm(0, 4_000));
  assert.equal(problem?.kind, "expected_read_missing");
  assert.match(problem!.documentedCause!, /compaction/);
});

test("a generation bump suppresses the rebuild compaction must cause", () => {
  const s = session();
  checkCacheUsage(s, warm(0, 10_000));
  bumpCacheGeneration(s);

  // The post-compaction turn reads nothing, which is expected, not a bust.
  assert.equal(checkCacheUsage(s, warm(0, 4_000)), undefined);
});

test("a provider that reports no cache activity is never flagged", () => {
  const s = session();
  checkCacheUsage(s, warm(0, 10_000));
  // Gemini/OpenAI-shaped: no cache fields at all. Absent data must not look
  // like a miss, and must not leave a zero baseline behind either.
  assert.equal(checkCacheUsage(s, warm(0, 0)), undefined);
  assert.equal(checkCacheUsage(s, warm(0, 8_000)), undefined);
});

test("an old journal entry does not excuse a later bust", () => {
  const s = session();
  checkCacheUsage(s, warm(0, 10_000));
  recordInvalidation(s, "compaction", "long ago");

  // Two minutes later, outside the attribution window. Undocumented, so it is
  // held one sample, then reported without a cause.
  const later = Date.now() + 120_000;
  assert.equal(checkCacheUsage(s, warm(0, 4_000), later), undefined);
  const problem = checkCacheUsage(s, warm(0, 4_000), later);
  assert.ok(problem);
  assert.equal(problem?.documentedCause, undefined);
});

test("resetCacheTracking forgets the session", () => {
  const s = session();
  checkCacheUsage(s, warm(0, 10_000));
  resetCacheTracking(s);
  assert.equal(checkCacheUsage(s, warm(0, 10_000)), undefined);
});

test("the notice names the tokens and points at the likely cause", () => {
  const text = describeCacheProblem({
    kind: "unexpected_creation",
    affectedTokens: 12_345,
  });
  assert.match(text, /12,345 tokens/);
  assert.match(text, /already-sent message/);
});

test("FREECODE_CACHE_MISS_NOTICES=0 turns the alarm off", () => {
  const original = process.env.FREECODE_CACHE_MISS_NOTICES;
  try {
    delete process.env.FREECODE_CACHE_MISS_NOTICES;
    assert.equal(isCacheMissNoticesEnabled(), true);
    process.env.FREECODE_CACHE_MISS_NOTICES = "0";
    assert.equal(isCacheMissNoticesEnabled(), false);
  } finally {
    if (original === undefined) delete process.env.FREECODE_CACHE_MISS_NOTICES;
    else process.env.FREECODE_CACHE_MISS_NOTICES = original;
  }
});

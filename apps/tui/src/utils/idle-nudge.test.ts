import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_IDLE_NUDGE_TOKENS,
  getCacheTtlMs,
  getIdleNudgeThreshold,
  idleNudgeMessage,
} from "./idle-nudge.js";

const MIN = 60_000;
const TTL = 5 * MIN;

const base = {
  contextTokens: 128_000,
  idleMs: 80 * MIN,
  ttlMs: TTL,
  alreadyShown: false,
};

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const original = process.env[key];
  try {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    fn();
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

test("fires when the context is large and the cache has expired", () => {
  const msg = idleNudgeMessage(base);
  assert.match(msg!, /128\.0k tokens will be re-sent/);
  assert.match(msg!, /expired 80 min ago/);
  assert.match(msg!, /\/clear/);
});

test("stays quiet on a small context, however long the gap", () => {
  assert.equal(
    idleNudgeMessage({ ...base, contextTokens: 20_000, idleMs: 600 * MIN }),
    undefined,
  );
});

test("stays quiet while the cache is still warm", () => {
  assert.equal(idleNudgeMessage({ ...base, idleMs: 2 * MIN }), undefined);
  // Exactly at the TTL is still warm.
  assert.equal(idleNudgeMessage({ ...base, idleMs: TTL }), undefined);
});

test("respects a longer configured TTL instead of a fixed 75 minutes", () => {
  // 40 min idle costs nothing under FREECODE_CACHE_TTL=1h, so warning would
  // contradict the cold-cache check that shares this clock.
  const hour = 60 * MIN;
  assert.equal(
    idleNudgeMessage({ ...base, idleMs: 40 * MIN, ttlMs: hour }),
    undefined,
  );
  assert.ok(idleNudgeMessage({ ...base, idleMs: 70 * MIN, ttlMs: hour }));
});

test("stays quiet before the first completed turn", () => {
  assert.equal(idleNudgeMessage({ ...base, idleMs: undefined }), undefined);
});

test("shows once per idle period, not once per send", () => {
  assert.equal(idleNudgeMessage({ ...base, alreadyShown: true }), undefined);
});

test("FREECODE_IDLE_NUDGE_TOKENS tunes and disables it", () => {
  withEnv("FREECODE_IDLE_NUDGE_TOKENS", "0", () => {
    assert.equal(idleNudgeMessage(base), undefined);
  });
  withEnv("FREECODE_IDLE_NUDGE_TOKENS", "10000", () => {
    assert.ok(idleNudgeMessage({ ...base, contextTokens: 20_000 }));
  });
});

test("a malformed threshold keeps the default rather than disabling silently", () => {
  withEnv("FREECODE_IDLE_NUDGE_TOKENS", "banana", () => {
    assert.equal(getIdleNudgeThreshold(), DEFAULT_IDLE_NUDGE_TOKENS);
    assert.ok(idleNudgeMessage(base));
  });
});

test("getCacheTtlMs follows FREECODE_CACHE_TTL", () => {
  withEnv("FREECODE_CACHE_TTL", undefined, () =>
    assert.equal(getCacheTtlMs(), 5 * MIN),
  );
  withEnv("FREECODE_CACHE_TTL", "1h", () =>
    assert.equal(getCacheTtlMs(), 60 * MIN),
  );
});

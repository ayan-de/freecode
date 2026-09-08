import assert from "node:assert/strict";
import test from "node:test";
import {
  clearInvalidations,
  findRecentInvalidation,
  noteStaticPrefix,
} from "./cache-invalidation.js";
import { checkCacheUsage, resetCacheTracking } from "./cache-miss.js";

let seq = 0;
function session(): string {
  return `si-${++seq}`;
}

const warm = (read: number, write = 0, input = 100) => ({
  cacheReadTokens: read,
  cacheWriteTokens: write,
  inputTokens: input,
});

test("the first static block only establishes a baseline", () => {
  const s = session();
  noteStaticPrefix(s, "system prompt v1");
  assert.equal(
    findRecentInvalidation(s),
    undefined,
    "nothing was cached yet, so nothing can have been invalidated",
  );
});

test("an unchanged static block documents nothing", () => {
  const s = session();
  noteStaticPrefix(s, "system prompt v1");
  noteStaticPrefix(s, "system prompt v1");
  assert.equal(findRecentInvalidation(s), undefined);
});

test("an edited CLAUDE.md mid-session is documented", () => {
  const s = session();
  noteStaticPrefix(s, "Instructions from: /p/CLAUDE.md\nuse tabs");
  noteStaticPrefix(s, "Instructions from: /p/CLAUDE.md\nuse spaces");

  const entry = findRecentInvalidation(s);
  assert.equal(entry?.source, "system prompt changed");
  assert.match(entry!.detail, /CLAUDE\.md/);
});

test("the miss that a static-block edit causes is attributed, not alarmed", () => {
  const s = session();
  resetCacheTracking(s);
  noteStaticPrefix(s, "system prompt v1");

  checkCacheUsage(s, warm(0, 10_000)); // prefix cached
  noteStaticPrefix(s, "system prompt v2"); // user edits CLAUDE.md

  checkCacheUsage(s, warm(0, 10_000)); // miss, held one sample
  const problem = checkCacheUsage(s, warm(0, 10_000));
  assert.equal(problem?.kind, "expected_read_missing");
  assert.match(
    problem!.documentedCause!,
    /static system block/,
    "the user's own edit must not read as an unexplained harness bust",
  );
});

test("clearInvalidations forgets the fingerprint too", () => {
  const s = session();
  noteStaticPrefix(s, "v1");
  clearInvalidations(s);
  // Post-clear the next block is a baseline again, not a change.
  noteStaticPrefix(s, "v2");
  assert.equal(findRecentInvalidation(s), undefined);
});

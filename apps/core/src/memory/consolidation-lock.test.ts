import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inRetryBackoff,
  readLastConsolidatedAt,
  recordConsolidationOutcome,
  rollbackConsolidationLock,
  tryAcquireConsolidationLock,
} from "./consolidation-lock.js";

function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "mem-lock-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a never-consolidated project reads as 0", () => {
  withDir((dir) => {
    assert.equal(readLastConsolidatedAt(dir), 0);
  });
});

test("acquire returns the prior mtime and advances it", () => {
  withDir((dir) => {
    const first = tryAcquireConsolidationLock(dir);
    assert.equal(first, 0, "first ever acquire sees no prior timestamp");

    const after = readLastConsolidatedAt(dir);
    assert.ok(after > 0, "the mtime IS the timestamp");

    const second = tryAcquireConsolidationLock(dir);
    assert.ok(
      second !== null && Math.abs(second - after) < 1000,
      "the second acquire is handed the first's timestamp",
    );
  });
});

test("rollback restores the prior mtime so the time gate passes again", () => {
  withDir((dir) => {
    tryAcquireConsolidationLock(dir);
    const original = readLastConsolidatedAt(dir);

    const prior = tryAcquireConsolidationLock(dir);
    assert.ok(prior !== null);
    rollbackConsolidationLock(dir, prior);

    assert.ok(
      Math.abs(readLastConsolidatedAt(dir) - original) < 1000,
      "rewound to where it was before the failed run",
    );
  });
});

test("rollback from a first-ever run removes the lock entirely", () => {
  withDir((dir) => {
    const prior = tryAcquireConsolidationLock(dir);
    assert.equal(prior, 0);
    rollbackConsolidationLock(dir, prior ?? 0);
    assert.equal(
      readLastConsolidatedAt(dir),
      0,
      "a failed first run must not look like a successful one",
    );
  });
});

test("a failed run backs off in minutes, not a full day", () => {
  withDir((dir) => {
    const now = 1_700_000_000_000;
    rollbackConsolidationLock(dir, 0, now);

    assert.equal(inRetryBackoff(dir, now + 60_000), true, "1 min later: waiting");
    assert.equal(
      inRetryBackoff(dir, now + 20 * 60_000),
      false,
      "20 min later: free to retry — a transient timeout must not cost a day",
    );
  });
});

test("a successful run clears the backoff", () => {
  withDir((dir) => {
    const now = 1_700_000_000_000;
    rollbackConsolidationLock(dir, 0, now);
    assert.equal(inRetryBackoff(dir, now + 60_000), true);

    recordConsolidationOutcome(dir, "succeeded");
    assert.equal(inRetryBackoff(dir, now + 60_000), false);
  });
});

test("a healthy no-op is recorded distinctly from a failure", () => {
  withDir((dir) => {
    // The distinction that matters: a run that correctly found nothing to do
    // must advance the schedule, while a run that failed must not.
    recordConsolidationOutcome(dir, "succeeded_no_output");
    assert.equal(inRetryBackoff(dir), false, "no backoff for a healthy no-op");
  });
});

test("a corrupt state file does not wedge the schedule", () => {
  withDir((dir) => {
    // Reading garbage must mean "no backoff recorded", not "backed off forever".
    assert.equal(inRetryBackoff(dir), false);
  });
});

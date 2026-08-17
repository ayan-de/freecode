import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The tracker resolves its file from os.homedir() at module load, so point HOME
// at a scratch dir before importing it.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-usage-"));
process.env.HOME = home;
const usageFile = path.join(home, ".freecode", "usage.json");

const { readDailyUsage, recordDailyUsage } = await import("./tracker.js");

function writeStore(entries: unknown[]): void {
  fs.mkdirSync(path.dirname(usageFile), { recursive: true });
  fs.writeFileSync(usageFile, JSON.stringify(entries));
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("a turn is recorded with cache writes folded into input", () => {
  writeStore([]);
  recordDailyUsage({
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 900,
    cacheWriteTokens: 50,
  });

  const [entry] = readDailyUsage();
  assert.equal(entry.date, today());
  // The provider-shared mapper gives us an INCLUSIVE inputTokens, so the
  // call site hands over the SDK's value (e.g. 100 = 100 fresh, no cache
  // folded in by this test). The breakdown is preserved for the cache hit
  // rate display — `cacheWriteTokens` is the same writes broken out, NOT
  // an extra addend to the total.
  assert.equal(entry.inputTokens, 100);
  assert.equal(entry.cacheReadTokens, 900);
  assert.equal(entry.cacheWriteTokens, 50);
  // The total is input + output (cache reads/writes already inside input).
  assert.equal(entry.tokencount, 100 + 20);
});

test("turns accumulate into the same day", () => {
  writeStore([]);
  const turn = {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 100,
    cacheWriteTokens: 0,
  };
  recordDailyUsage(turn);
  recordDailyUsage(turn);

  const [entry] = readDailyUsage();
  assert.equal(entry.inputTokens, 20);
  assert.equal(entry.cacheReadTokens, 200);
  assert.equal(entry.tokencount, 30);
});

test("reasoning tokens are tracked separately and excluded from outputVisibleTokens", () => {
  writeStore([]);
  recordDailyUsage({
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 20,
  });

  const [entry] = readDailyUsage();
  assert.equal(entry.outputTokens, 50);
  assert.equal(entry.reasoningTokens, 20);
  assert.equal(entry.outputVisibleTokens, 30);
});

test("legacy entries still read, with the breakdown left undefined", () => {
  // `count` is the oldest field name; `tokencount` with no parts is the shape
  // written before the breakdown existed. Neither may become a phantom zero.
  writeStore([
    { date: "2026-01-01", count: 500 },
    { date: "2026-01-02", tokencount: 700 },
  ]);

  const entries = readDailyUsage();
  assert.equal(entries[0].tokencount, 500);
  assert.equal(entries[0].cacheReadTokens, undefined);
  assert.equal(entries[1].tokencount, 700);
  assert.equal(entries[1].inputTokens, undefined);
});

test("recording onto a legacy day keeps its total and starts its parts", () => {
  writeStore([{ date: today(), tokencount: 1_000 }]);
  recordDailyUsage({
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 100,
    cacheWriteTokens: 0,
  });

  const [entry] = readDailyUsage();
  // Pre-existing total preserved; the new turn adds input + output only
  // (cache writes are already inside inputTokens under the new contract —
  // the previous tracker double-counted cache writes against the total).
  assert.equal(entry.tokencount, 1_015);
  assert.equal(entry.inputTokens, 10); // parts cover only what we can attribute
  assert.equal(entry.cacheReadTokens, 100);
});

test("an all-zero turn writes nothing", () => {
  writeStore([]);
  recordDailyUsage({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.deepEqual(readDailyUsage(), []);
});

test("a missing or corrupt store reads as empty", () => {
  fs.rmSync(usageFile, { force: true });
  assert.deepEqual(readDailyUsage(), []);
  fs.writeFileSync(usageFile, "{not json");
  assert.deepEqual(readDailyUsage(), []);
});

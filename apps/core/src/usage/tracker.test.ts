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
  // Writes are billed input, so they live inside inputTokens...
  assert.equal(entry.inputTokens, 150);
  assert.equal(entry.cacheWriteTokens, 50);
  // ...which means the total must not add them again.
  assert.equal(entry.tokencount, 150 + 20 + 900);
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
  assert.equal(entry.tokencount, 230);
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
  assert.equal(entry.tokencount, 1_115); // pre-existing total preserved
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

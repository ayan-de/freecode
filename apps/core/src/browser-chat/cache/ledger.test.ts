import test from "node:test";
import assert from "node:assert/strict";
import { SentLedger, ledgerKey } from "./ledger.js";

const BIG = "file contents".repeat(50);

test("only allowlisted tools get a key", () => {
  assert.ok(ledgerKey("read", { path: "a.ts" }));
  // Impure or corpus-dependent tools must never be deduped.
  assert.equal(ledgerKey("bash", { path: "a.ts" }), null);
  assert.equal(ledgerKey("grep", { path: "a.ts" }), null);
  assert.equal(ledgerKey("glob", { path: "a.ts" }), null);
  assert.equal(ledgerKey("ls", { path: "a.ts" }), null);
  assert.equal(ledgerKey("write", { path: "a.ts" }), null);
});

test("an unknown tool is not deduped — fail safe by default", () => {
  // Stands in for a tool added later, or any MCP tool (registered at runtime).
  assert.equal(ledgerKey("mcp__something__fetch", { path: "a.ts" }), null);
});

test("the key carries the range, not just the path", () => {
  const whole = ledgerKey("read", { path: "a.ts" });
  const slice = ledgerKey("read", { path: "a.ts", offset: 4000 });
  assert.notEqual(whole, slice);
});

test("a repeat read of unchanged content is deduped", () => {
  const ledger = new SentLedger(100_000);
  const key = ledgerKey("read", { path: "a.ts" })!;
  ledger.record(key, BIG, 0, 1);
  const decision = ledger.consider(key, BIG, 500, 3);
  assert.equal(decision.dedupe, true);
  assert.match(
    decision.dedupe ? decision.replacement : "",
    /unchanged since turn 1/,
  );
});

test("changed content is never deduped", () => {
  const ledger = new SentLedger(100_000);
  const key = ledgerKey("read", { path: "a.ts" })!;
  ledger.record(key, BIG, 0, 1);
  assert.equal(ledger.consider(key, BIG + "// edited", 500, 3).dedupe, false);
});

test("ONE-SHOT: a second request after a dedup always sends full content", () => {
  // The reactive hedge. If the model asks again after being told "unchanged",
  // it does not have the content — bounds the damage at one round trip.
  const ledger = new SentLedger(100_000);
  const key = ledgerKey("read", { path: "a.ts" })!;
  ledger.record(key, BIG, 0, 1);
  assert.equal(ledger.consider(key, BIG, 100, 2).dedupe, true);
  assert.equal(ledger.consider(key, BIG, 200, 3).dedupe, false);
});

test("AGE: an entry expires after enough thread growth", () => {
  const ledger = new SentLedger(1_000);
  const key = ledgerKey("read", { path: "a.ts" })!;
  ledger.record(key, BIG, 0, 1);
  assert.equal(ledger.consider(key, BIG, 500, 2).dedupe, true);

  const fresh = new SentLedger(1_000);
  fresh.record(key, BIG, 0, 1);
  assert.equal(fresh.consider(key, BIG, 5_000, 9).dedupe, false);
});

test("HARD INVARIANT: clear() empties the ledger on rebootstrap", () => {
  // A new thread holds none of the prior results — a surviving entry would be
  // wrong immediately, not probabilistically.
  const ledger = new SentLedger(100_000);
  const key = ledgerKey("read", { path: "a.ts" })!;
  ledger.record(key, BIG, 0, 1);
  ledger.clear();
  assert.equal(ledger.size, 0);
  assert.equal(ledger.consider(key, BIG, 100, 2).dedupe, false);
});

test("an unrecorded key is never deduped", () => {
  const ledger = new SentLedger(100_000);
  assert.equal(ledger.consider("read:never.ts:0:0", BIG, 0, 1).dedupe, false);
});

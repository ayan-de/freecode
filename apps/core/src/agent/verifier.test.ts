import test from "node:test";
import assert from "node:assert/strict";
import { parseVerdict, verifierFailureReminder } from "./subagent.js";

test("parseVerdict reads an explicit verdict line (case-insensitive)", () => {
  assert.equal(parseVerdict("findings...\nVERDICT: PASS"), "PASS");
  assert.equal(parseVerdict("VERDICT: fail"), "FAIL");
  assert.equal(parseVerdict("blah\nVerdict:   Partial\n"), "PARTIAL");
});

test("parseVerdict defaults to PARTIAL when no verdict is present", () => {
  // Never a false PASS on garbled/missing output.
  assert.equal(parseVerdict("the code looks fine to me"), "PARTIAL");
  assert.equal(parseVerdict(""), "PARTIAL");
});

test("verifierFailureReminder wraps the report in a system-reminder", () => {
  const r = verifierFailureReminder("missing null check in foo.ts");
  assert.match(r, /<system-reminder>/);
  assert.match(r, /returned FAIL/);
  assert.match(r, /missing null check in foo\.ts/);
});

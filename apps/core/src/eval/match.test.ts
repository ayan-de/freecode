import test from "node:test";
import assert from "node:assert/strict";
import { matchArg } from "./match.js";

test("substring matching is case-insensitive", () => {
  assert.equal(matchArg("hang_threshold", "HANG_THRESHOLD_MS"), true);
  assert.equal(matchArg("HANG_THRESHOLD", "hang_threshold_ms"), true);
});

test("substring matching is directional — expectation must fit inside actual", () => {
  // The direction that bites in practice: a case pinning the long spelling
  // fails when the model greps the short one. Documented in spec §4.1 so a
  // reader hits it in the doc rather than in a red CI run.
  assert.equal(matchArg("HANG_THRESHOLD_MS", "HANG_THRESHOLD"), false);
  assert.equal(matchArg("HANG_THRESHOLD", "HANG_THRESHOLD_MS"), true);
});

test("objects are compared as JSON, not [object Object]", () => {
  // String(obj) is "[object Object]", which would make every substring match
  // against a structured argument silently vacuous.
  assert.equal(matchArg("alpha", { name: "alpha" }), true);
  assert.equal(matchArg("beta", { name: "alpha" }), false);
  assert.equal(matchArg("two", ["one", "two"]), true);
});

test("missing arguments do not match", () => {
  assert.equal(matchArg("anything", undefined), false);
  assert.equal(matchArg("anything", null), false);
});

test("$eq is strict and deep", () => {
  assert.equal(matchArg({ $eq: 5 }, 5), true);
  assert.equal(matchArg({ $eq: 5 }, "5"), false);
  assert.equal(matchArg({ $eq: { a: [1, 2] } }, { a: [1, 2] }), true);
  assert.equal(matchArg({ $eq: { a: [1, 2] } }, { a: [1, 3] }), false);
});

test("$regex defaults to case-insensitive and honours $flags", () => {
  assert.equal(matchArg({ $regex: "^src/.*\\.ts$" }, "src/eval/gate.ts"), true);
  assert.equal(matchArg({ $regex: "^gate" }, "GATE.ts"), true);
  assert.equal(matchArg({ $regex: "^gate", $flags: "" }, "GATE.ts"), false);
});

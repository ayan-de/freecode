import test from "node:test";
import assert from "node:assert/strict";
import { buildGateFailureContinuation } from "./prompts.js";

test("buildGateFailureContinuation: includes the verify command and output", () => {
  const msg = buildGateFailureContinuation("pnpm test", {
    passed: false,
    output: "1 test failed: foo.test.ts",
    skipped: false,
  });
  assert.match(msg, /pnpm test/);
  assert.match(msg, /1 test failed: foo\.test\.ts/);
  assert.match(msg, /does not decide|verify command decides/i);
});

test("buildGateFailureContinuation: skipped gate notes the workspace is unchanged, omits stale output", () => {
  const msg = buildGateFailureContinuation("pnpm test", {
    passed: false,
    output: "stale failure text",
    skipped: true,
  });
  assert.match(msg, /has not changed/i);
  assert.doesNotMatch(msg, /stale failure text/);
});

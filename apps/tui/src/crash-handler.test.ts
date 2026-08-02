import assert from "node:assert/strict";
import test from "node:test";
import { formatCrashReport } from "./crash-handler.js";

test("an Error is reported with its stack, not just its message", () => {
  const err = new Error("boom");
  const report = formatCrashReport("uncaught exception", err, undefined);

  assert.match(report, /uncaught exception/);
  assert.match(report, /Error: boom/);
  // The stack is the whole reason the report exists — a bare message would
  // leave the user with nothing to paste into an issue.
  assert.match(report, /crash-handler\.test/);
});

test("the resume hint carries the session id when there is one", () => {
  const report = formatCrashReport("uncaught exception", new Error("x"), "sess-42");
  assert.match(report, /freecode --resume sess-42/);
});

test("no resume hint is offered before a session exists", () => {
  const report = formatCrashReport("uncaught exception", new Error("x"), undefined);
  assert.doesNotMatch(report, /--resume/);
});

test("a rejected non-Error object survives instead of becoming [object Object]", () => {
  // Promise rejections carry arbitrary values; the common case of a rejected
  // fetch-style object is exactly where String() destroys the useful detail.
  const report = formatCrashReport(
    "unhandled promise rejection",
    { status: 500, body: "upstream failed" },
  );

  assert.doesNotMatch(report, /\[object Object\]/);
  assert.match(report, /upstream failed/);
});

test("a circular rejection value degrades instead of throwing", () => {
  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;

  // If the formatter threw here it would take out the crash handler itself,
  // and the user would be back to a silent disappearance.
  const report = formatCrashReport("unhandled promise rejection", circular);
  assert.match(report, /unhandled promise rejection/);
});

test("a primitive rejection value is still reported", () => {
  const report = formatCrashReport("unhandled promise rejection", "just a string");
  assert.match(report, /just a string/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { planToolBatches } from "./batching.js";

const SAFE = new Set(["read", "grep", "glob", "skill"]);
const isSafe = (name: string) => SAFE.has(name);

function call(tool: string) {
  return { tool };
}

test("planToolBatches returns empty for empty input", () => {
  assert.deepEqual(planToolBatches([], isSafe), []);
});

test("planToolBatches marks a single safe tool as solo (parallel=false)", () => {
  const plan = planToolBatches([call("read")], isSafe);
  assert.deepEqual(plan, [{ start: 0, end: 1, parallel: false }]);
});

test("planToolBatches groups consecutive safe tools into one parallel batch", () => {
  const plan = planToolBatches(
    [call("read"), call("read"), call("grep")],
    isSafe,
  );
  assert.deepEqual(plan, [{ start: 0, end: 3, parallel: true }]);
});

test("planToolBatches splits at a sequential tool", () => {
  const plan = planToolBatches(
    [call("read"), call("read"), call("write"), call("read"), call("read")],
    isSafe,
  );
  assert.deepEqual(plan, [
    { start: 0, end: 2, parallel: true },
    { start: 2, end: 3, parallel: false },
    { start: 3, end: 5, parallel: true },
  ]);
});

test("planToolBatches treats unknown tools as sequential", () => {
  const plan = planToolBatches(
    [call("read"), call("mystery"), call("read")],
    isSafe,
  );
  assert.deepEqual(plan, [
    { start: 0, end: 1, parallel: false },
    { start: 1, end: 2, parallel: false },
    { start: 2, end: 3, parallel: false },
  ]);
});

test("planToolBatches handles all-sequential input as N solo batches", () => {
  const plan = planToolBatches(
    [call("write"), call("edit"), call("bash")],
    isSafe,
  );
  assert.deepEqual(plan, [
    { start: 0, end: 1, parallel: false },
    { start: 1, end: 2, parallel: false },
    { start: 2, end: 3, parallel: false },
  ]);
});

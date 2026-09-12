import test from "node:test";
import assert from "node:assert/strict";
import { mergeTask, type PublishedRun } from "./publish.js";

const run = (o: Partial<PublishedRun>): PublishedRun => ({
  runId: "r1",
  trial: 1,
  agent: "freecode",
  agentVersion: "v",
  model: "m",
  autonomy: "a",
  harnessFlags: {},
  upstreamCommit: "abc",
  date: "2026-09-12T10:00:00.000Z",
  best: 1,
  bestAt: 1000,
  final: 1,
  finalFullGate: true,
  grades: 3,
  activeMs: 5000,
  durationMs: 6000,
  timedOut: false,
  curve: [],
  ...o,
});

test("a new run is added, newest first, and older runs are kept", () => {
  const existing = {
    task: "t",
    oneLiner: "old",
    generatedAt: "x",
    runs: [run({ runId: "r0", date: "2026-09-01T00:00:00.000Z" })],
  };
  const merged = mergeTask(existing, "t", "", [run({ runId: "r1" })], "now");
  assert.deepEqual(
    merged.runs.map((r) => r.runId),
    ["r1", "r0"],
  );
  assert.equal(merged.oneLiner, "old", "an empty one-liner does not erase the stored one");
});

test("re-publishing a run replaces its rows instead of duplicating them", () => {
  const existing = {
    task: "t",
    oneLiner: "",
    generatedAt: "x",
    runs: [run({ runId: "r1", best: 0.5 }), run({ runId: "r1", agent: "claude-code", best: 0.4 })],
  };
  const merged = mergeTask(existing, "t", "new", [run({ runId: "r1", best: 0.9 })], "now");
  assert.equal(merged.runs.length, 2);
  assert.equal(merged.runs.find((r) => r.agent === "freecode")!.best, 0.9);
  assert.equal(merged.runs.find((r) => r.agent === "claude-code")!.best, 0.4);
  assert.equal(merged.oneLiner, "new");
});

test("trials of the same run are distinct rows", () => {
  const merged = mergeTask(undefined, "t", "", [run({ trial: 1 }), run({ trial: 2 })], "now");
  assert.equal(merged.runs.length, 2);
});

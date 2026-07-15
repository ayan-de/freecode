import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RolloutRecorder } from "./recorder.js";
import type { FunctionOutputEvent, RolloutEvent } from "./types.js";

function readEvents(dir: string): RolloutEvent[] {
  return readFileSync(join(dir, "events.jsonl"), "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RolloutEvent);
}

test("seq resumes across recorder instances for the same session", () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  try {
    const first = new RolloutRecorder("s1", { rolloutDir: dir });
    first.recordTurnStarted("turn-1");
    first.recordTurnStarted("turn-2");

    const second = new RolloutRecorder("s1", { rolloutDir: dir });
    second.recordTurnStarted("turn-3");

    assert.deepEqual(
      readEvents(dir).map((e) => e.seq),
      [1, 2, 3],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("function.output carries turnId and preserves falsy values", () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  try {
    const recorder = new RolloutRecorder("s1", { rolloutDir: dir });
    recorder.recordFunctionOutput("read", "", 0, "turn-1");

    const [event] = readEvents(dir) as FunctionOutputEvent[];
    assert.equal(event.type, "function.output");
    assert.equal(event.turnId, "turn-1");
    assert.equal(event.output, "");
    assert.equal(event.duration_ms, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

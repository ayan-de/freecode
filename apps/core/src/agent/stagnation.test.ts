import test from "node:test";
import assert from "node:assert/strict";
import { createAgentLoop } from "./loop.js";
import { createLoopHealthEvaluator } from "../effect/loop-health.js";
import { DEFAULT_LOOP_HEURISTICS } from "./types.js";
import type { ToolCall, ToolResult } from "./types.js";

// The stagnation counter used to advance once per *tool call*, so five reads —
// which is what reading a codebase looks like — evaluated as "no progress".
// It now advances once per turn. Private members are reached via `as any`,
// matching the existing agent loop tests.

function readCall(loop: unknown, file: string): void {
  const call: ToolCall = {
    id: `call-${file}`,
    tool: "read",
    args: { filePath: file },
    execution: "parallel",
  };
  (loop as any).updateLoopHealth(call, {
    id: "r",
    toolCallId: call.id,
    tool: "read",
    title: "read",
  } as ToolResult);
}

function health(loop: unknown) {
  return createLoopHealthEvaluator().evaluate(
    (loop as any).state,
    (loop as any).config.heuristics,
  );
}

test("consecutive reads inside a turn are not stagnation", () => {
  const loop = createAgentLoop("test-stagnation-reads");
  for (let i = 0; i < DEFAULT_LOOP_HEURISTICS.stagnantTurnsThreshold + 3; i++) {
    readCall(loop, `/p/file-${i}.ts`);
  }
  assert.equal((loop as any).state.loopHealth.stagnantTurns, 0);
  assert.equal(health(loop).action, "continue");
});

// Found by the Phase 2 eval probe, not by reading the code: a 6-turn explore
// case tripped `no_progress`. In a read-only mode nothing the agent is
// PERMITTED to do can reset the counter, so it climbs to the threshold on any
// exploration past five turns and stays there — and once redirection is on,
// that is a model call billed for doing exactly what the mode is for.
for (const mode of ["plan", "review", "explore"] as const) {
  test(`${mode} mode never accrues stagnation — it cannot change a file by design`, () => {
    const loop = createAgentLoop(`test-stagnation-${mode}`);
    (loop as any).state = { ...(loop as any).state, agentMode: mode };

    for (
      let i = 0;
      i < DEFAULT_LOOP_HEURISTICS.stagnantTurnsThreshold * 3;
      i++
    ) {
      (loop as any).advanceStagnation(false);
    }
    assert.equal((loop as any).state.loopHealth.stagnantTurns, 0);
    assert.equal(health(loop).action, "continue");
  });
}

test("build mode still counts stagnation — there it means something", () => {
  const loop = createAgentLoop("test-stagnation-build");
  assert.equal((loop as any).state.agentMode, "build");
  for (let i = 0; i < DEFAULT_LOOP_HEURISTICS.stagnantTurnsThreshold; i++) {
    (loop as any).advanceStagnation(false);
  }
  assert.equal(health(loop).action, "warn");
});

test("N turns with no file change warn", () => {
  const loop = createAgentLoop("test-stagnation-turns");
  const threshold = DEFAULT_LOOP_HEURISTICS.stagnantTurnsThreshold;
  for (let i = 0; i < threshold - 1; i++) {
    (loop as any).advanceStagnation(false);
  }
  assert.equal(health(loop).action, "continue");

  (loop as any).advanceStagnation(false);
  const action = health(loop);
  assert.equal(action.action, "warn");
  assert.equal(action.reason, "no_progress");
});

test("a turn that changed a file resets the counter", () => {
  const loop = createAgentLoop("test-stagnation-reset");
  for (let i = 0; i < DEFAULT_LOOP_HEURISTICS.stagnantTurnsThreshold; i++) {
    (loop as any).advanceStagnation(false);
  }
  assert.equal(health(loop).action, "warn");

  (loop as any).advanceStagnation(true);
  assert.equal((loop as any).state.loopHealth.stagnantTurns, 0);
  assert.equal(health(loop).action, "continue");
});

test("stagnation never hard-stops a run", () => {
  const loop = createAgentLoop("test-stagnation-no-stop");
  for (let i = 0; i < DEFAULT_LOOP_HEURISTICS.stagnantTurnsThreshold * 4; i++) {
    (loop as any).advanceStagnation(false);
  }
  assert.equal(health(loop).action, "warn");
});

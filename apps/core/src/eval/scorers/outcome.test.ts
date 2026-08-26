import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { scoreOutcome } from "./outcome.js";
import { createSandbox, type Sandbox } from "../sandbox.js";
import type { Trace } from "../../rollout/trace.js";
import type { EvalCase, RunRecord } from "../types.js";

const trace: Trace = {
  sessionId: "s1",
  startedAt: 0,
  endedAt: 100,
  wall_ms: 100,
  modelSpans: [],
  toolSpans: [],
  model_ms: 100,
  tool_ms: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  hung: false,
  inFlight: false,
};

const run = (sandboxDir?: string): RunRecord => ({
  trace,
  prompt: "p",
  response: "r",
  sandboxDir,
});

const kase = (over: Partial<EvalCase>): EvalCase => ({
  id: "c",
  prompt: "p",
  ...over,
});

/** Runs `fn` against a live sandbox, cleaning up whatever the assertion does. */
function withSandbox(
  files: Record<string, string>,
  fn: (sandbox: Sandbox) => void,
): void {
  const sandbox = createSandbox(files);
  try {
    fn(sandbox);
  } finally {
    sandbox.cleanup();
  }
}

test("a case with no verify is not this scorer's business", () => {
  assert.equal(scoreOutcome(run(), kase({ expectTool: "grep" })).passed, true);
});

test("exit 0 passes", () => {
  withSandbox({ "check.mjs": "process.exit(0);\n" }, (sandbox) => {
    const score = scoreOutcome(
      run(sandbox.dir),
      kase({ verify: "node check.mjs" }),
    );
    assert.equal(score.passed, true);
  });
});

test("a non-zero exit fails, carrying the assertion message", () => {
  // "verify exit 1" alone would make every red case a re-run to diagnose.
  withSandbox(
    {
      "check.mjs":
        "import assert from 'node:assert';\nassert.equal(1, 2, 'add is wrong');\n",
    },
    (sandbox) => {
      const score = scoreOutcome(
        run(sandbox.dir),
        kase({ verify: "node check.mjs" }),
      );
      assert.equal(score.passed, false);
      assert.match(score.reason, /verify exit 1/);
      assert.match(score.reason, /add is wrong/);
    },
  );
});

test("verify runs in the sandbox, not the caller's cwd", () => {
  withSandbox(
    { "check.mjs": "import 'node:fs';\nprocess.exit(0);\n" },
    (sandbox) => {
      // `node check.mjs` can only resolve if cwd is the sandbox — the repo root
      // has no check.mjs.
      assert.equal(
        scoreOutcome(run(sandbox.dir), kase({ verify: "node check.mjs" }))
          .passed,
        true,
      );
    },
  );
});

test("an edited checker fails before verify ever runs", () => {
  // The false green this whole field exists to prevent: an agent that rewrites
  // check.mjs until it passes has produced a green run and fixed nothing.
  const original = "import assert from 'node:assert';\nassert.equal(1, 2);\n";
  withSandbox({ "check.mjs": original }, (sandbox) => {
    fs.writeFileSync(
      path.join(sandbox.dir, "check.mjs"),
      "process.exit(0);\n",
      "utf-8",
    );
    const score = scoreOutcome(
      run(sandbox.dir),
      kase({
        verify: "node check.mjs",
        files: { "check.mjs": original },
        immutable: ["check.mjs"],
      }),
    );
    assert.equal(score.passed, false);
    assert.match(score.reason, /modified immutable check\.mjs/);
  });
});

test("a deleted checker fails too", () => {
  const original = "process.exit(0);\n";
  withSandbox({ "check.mjs": original }, (sandbox) => {
    fs.rmSync(path.join(sandbox.dir, "check.mjs"));
    const score = scoreOutcome(
      run(sandbox.dir),
      kase({
        verify: "node check.mjs",
        files: { "check.mjs": original },
        immutable: ["check.mjs"],
      }),
    );
    assert.equal(score.passed, false);
    assert.match(score.reason, /deleted immutable check\.mjs/);
  });
});

test("an untouched checker passes the tamper check", () => {
  const original = "process.exit(0);\n";
  withSandbox({ "check.mjs": original }, (sandbox) => {
    const score = scoreOutcome(
      run(sandbox.dir),
      kase({
        verify: "node check.mjs",
        files: { "check.mjs": original },
        immutable: ["check.mjs"],
      }),
    );
    assert.equal(score.passed, true);
  });
});

test("verify without a sandbox fails rather than running somewhere real", () => {
  const score = scoreOutcome(run(undefined), kase({ verify: "node check.mjs" }));
  assert.equal(score.passed, false);
  assert.match(score.reason, /needs a sandbox/);
});

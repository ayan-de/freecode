// =============================================================================
// Outcome scorer — run the case's `verify` in the sandbox; its exit code is
// the verdict (spec §4).
//
// This is the highest-value scorer in the harness and the cheapest to trust,
// because nothing subjective enters it: the tests pass or they do not. Prefer
// it over a judge wherever a task can be phrased this way.
// =============================================================================

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { EvalCase, RunRecord, TrialScore } from "../types.js";

const pass: TrialScore = { passed: true, reason: "ok" };
const fail = (reason: string): TrialScore => ({ passed: false, reason });

/**
 * A `verify` that has not finished by now is hung. Much shorter than the trial
 * timeout: the fixture is dependency-free `node`, so anything past a few
 * seconds is a loop, not slow work.
 */
const VERIFY_TIMEOUT_MS = Number.isFinite(
  Number(process.env.FREECODE_EVAL_VERIFY_TIMEOUT_MS),
)
  ? Math.max(1_000, Number(process.env.FREECODE_EVAL_VERIFY_TIMEOUT_MS))
  : 60_000;

export function scoreOutcome(run: RunRecord, kase: EvalCase): TrialScore {
  if (!kase.verify) return pass;
  if (!run.sandboxDir) return fail("verify needs a sandbox");

  // The checker is not part of the task. An agent that edits `check.mjs` until
  // it passes has produced a green run and fixed nothing, which is the single
  // most expensive false positive this scorer can emit — so the tamper check
  // runs BEFORE the command, not after.
  for (const rel of kase.immutable ?? []) {
    const expected = kase.files?.[rel];
    if (expected === undefined) continue; // dataset.ts already rejected this
    let actual: string;
    try {
      actual = fs.readFileSync(path.join(run.sandboxDir, rel), "utf-8");
    } catch {
      return fail(`deleted immutable ${rel}`);
    }
    if (actual !== expected) return fail(`modified immutable ${rel}`);
  }

  // `shell: true` because `verify` is fixture-authored, not model-authored —
  // it is part of the case, reviewed in the same diff as the prompt.
  const result = spawnSync(kase.verify, {
    cwd: run.sandboxDir,
    shell: true,
    encoding: "utf-8",
    timeout: VERIFY_TIMEOUT_MS,
  });

  if (result.error) {
    return fail(`verify could not run: ${result.error.message}`.slice(0, 200));
  }
  if (result.signal) {
    return fail(`verify killed (${result.signal}) after ${VERIFY_TIMEOUT_MS}ms`);
  }
  if (result.status === 0) return pass;

  // One line of stderr is what makes a red case diagnosable without re-running
  // it — an assertion message beats "exit 1" every time.
  const detail = salientLine(result.stderr) || salientLine(result.stdout);
  return fail(
    `verify exit ${result.status}${detail ? `: ${detail}` : ""}`.slice(0, 200),
  );
}

/**
 * The most informative line of a failed run's output.
 *
 * Not simply the last line: node prints its own version banner after the stack
 * trace, so the tail of a failed `node check.mjs` is `Node.js v26.7.0` — which
 * says nothing about why the case is red. Stack frames and the banner are
 * dropped, the first line that names an error wins, and the last surviving
 * line is the fallback for output that never used `throw`.
 */
function salientLine(output: string | null): string {
  if (!output) return "";
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("at ") && !/^Node\.js v[\d.]+$/.test(l));
  return lines.find((l) => /Error\b.*:/.test(l)) ?? lines[lines.length - 1] ?? "";
}

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyVerdicts, parseHarnessReport, predictionsFor } from "./grade.js";
import type { Report, TrialRecord } from "./types.js";

function trial(over: Partial<TrialRecord>): TrialRecord {
  return {
    agent: "freecode",
    agentVersion: "0.30.0",
    model: "minimax/MiniMax-M3",
    autonomy: "danger",
    instanceId: "django__django-1",
    trial: 1,
    isolation: "none",
    producedPatch: true,
    reason: "ok",
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    patchBytes: 10,
    newFiles: [],
    artifactDir: "results/run/django__django-1/trial-1/freecode",
    ...over,
  };
}

function report(trials: TrialRecord[]): Report {
  return { startedAt: "run", finishedAt: "run", isolation: "none", graded: false, trials };
}

test("predictionsFor reads each trial's patch.diff and skips empty patches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grade-"));
  const bench = path.join(root, "bench", "agent-bench");
  const resultsDir = path.join(bench, "results", "run");
  const artDir = path.join(resultsDir, "django__django-1", "trial-1", "freecode");
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(path.join(artDir, "patch.diff"), "diff --git a b\n");
  const rep = report([
    trial({}),
    trial({ instanceId: "django__django-2", producedPatch: false, artifactDir: "nowhere" }),
    trial({ agent: "opencode", artifactDir: "nowhere" }),
  ]);
  const preds = predictionsFor(rep, resultsDir, "freecode", 1);
  assert.deepEqual(preds, [
    {
      instance_id: "django__django-1",
      model_name_or_path: "freecode",
      model_patch: "diff --git a b\n",
    },
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("parseHarnessReport: resolved, unresolved and error ids are graded; absent is not", () => {
  const v = parseHarnessReport({
    resolved_ids: ["a"],
    unresolved_ids: ["b"],
    error_ids: ["c"],
  });
  assert.deepEqual([...v.resolved], ["a"]);
  assert.deepEqual([...v.graded].sort(), ["a", "b", "c"]);
  const empty = parseHarnessReport({ something: 1 });
  assert.equal(empty.resolved.size, 0);
});

test("applyVerdicts: empty patch fails without the harness; unlisted stays null", () => {
  const rep = report([
    trial({ instanceId: "a" }),
    trial({ instanceId: "b" }),
    trial({ instanceId: "c", producedPatch: false }),
    trial({ instanceId: "d" }),
    trial({ instanceId: "a", agent: "opencode" }),
  ]);
  applyVerdicts(rep, "freecode", 1, {
    resolved: new Set(["a"]),
    graded: new Set(["a", "b"]),
  });
  const by = (id: string, agent = "freecode") =>
    rep.trials.find((t) => t.instanceId === id && t.agent === agent)!;
  assert.equal(by("a").resolved, true);
  assert.equal(by("b").resolved, false);
  assert.equal(by("c").resolved, false); // empty patch: no harness needed
  assert.equal(by("d").resolved, null); // harness errored / never ran
  assert.equal(by("a", "opencode").resolved, undefined); // other slice untouched
});

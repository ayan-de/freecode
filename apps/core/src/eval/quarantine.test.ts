import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadQuarantine, proposeQuarantine } from "./quarantine.js";
import type { CaseResult, TrialResult } from "./types.js";

const trial = (passed: boolean): TrialResult => ({
  passed,
  reason: "",
  durationMs: 1,
  inputTokens: 0,
  outputTokens: 0,
});

const result = (id: string, passes: boolean[]): CaseResult => ({
  id,
  trials: passes.map(trial),
  passed: true,
  consistent: passes.every(Boolean),
  quarantined: false,
});

function withEvalsDir<T>(contents: string | null, fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-quarantine-"));
  if (contents !== null) {
    fs.writeFileSync(path.join(dir, "quarantine.txt"), contents, "utf-8");
  }
  const prev = process.env.FREECODE_EVALS_DIR;
  process.env.FREECODE_EVALS_DIR = dir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.FREECODE_EVALS_DIR;
    else process.env.FREECODE_EVALS_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("parses ids, ignoring comments and inline reasons", () => {
  const ids = withEvalsDir(
    "# header\n\nflaky-one  # 60%, revisit after prompt change\nflaky-two\n",
    loadQuarantine,
  );
  assert.deepEqual([...ids].sort(), ["flaky-one", "flaky-two"]);
});

test("a missing quarantine file is an empty set, not an error", () => {
  // The harness must run in a checkout that never created one.
  assert.equal(withEvalsDir(null, loadQuarantine).size, 0);
});

test("proposes quarantine below 90% and release above 98%", () => {
  const history = [
    [result("solid", [true, true]), result("flaky", [true, false])],
    [result("solid", [true, true]), result("flaky", [false, false])],
  ];
  const report = proposeQuarantine(history, new Set());
  assert.deepEqual(
    report.toQuarantine.map((p) => p.id),
    ["flaky"],
  );
  assert.equal(report.toRelease.length, 0);
});

test("proposes releasing a quarantined case that has become reliable", () => {
  const history = [[result("fixed", [true, true, true, true])]];
  const report = proposeQuarantine(history, new Set(["fixed"]));
  assert.deepEqual(
    report.toRelease.map((p) => p.id),
    ["fixed"],
  );
  // Already quarantined — it must not also be proposed for quarantine.
  assert.equal(report.toQuarantine.length, 0);
});

test("flags thin history so early rates read as advisory", () => {
  const report = proposeQuarantine([[result("a", [true])]], new Set());
  assert.equal(report.thin, true);
});

test("every quarantined id names a case that actually exists", async () => {
  // Was "starts empty", which stopped being the invariant when the 2026-08-29
  // bootstrap populated the file (eval-harness spec §14.1). Empty was never the
  // property worth protecting anyway — a STALE id is, because a quarantine
  // entry for a case that has been renamed or deleted silently protects
  // nothing, and nothing else in the system would ever mention it again.
  const dir = path.resolve(import.meta.dirname, "../../../../evals");
  const prev = process.env.FREECODE_EVALS_DIR;
  process.env.FREECODE_EVALS_DIR = dir;
  try {
    const { parseSuite } = await import("./dataset.js");
    const known = new Set<string>();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
      const cases = parseSuite(
        fs.readFileSync(path.join(dir, file), "utf-8"),
        file,
      );
      if (cases.length === 0) continue;
      for (const kase of cases) {
        known.add(kase.id);
      }
    }
    for (const id of loadQuarantine()) {
      assert.ok(known.has(id), `quarantined id '${id}' matches no case`);
    }
  } finally {
    if (prev === undefined) delete process.env.FREECODE_EVALS_DIR;
    else process.env.FREECODE_EVALS_DIR = prev;
  }
});

test("a case that never passes is not proposed for quarantine", () => {
  // Quarantine suppresses noise. A 0% case is a finding or a broken case, and
  // silencing either one is how a gate stops meaning anything.
  const report = proposeQuarantine(
    [[result("always-fails", [false, false, false])]],
    new Set(),
  );
  assert.equal(
    report.toQuarantine.find((p) => p.id === "always-fails"),
    undefined,
  );
});

test("a genuinely flaky case is still proposed", () => {
  const report = proposeQuarantine(
    [[result("flaky", [true, false, false])]],
    new Set(),
  );
  assert.equal(report.toQuarantine[0]?.id, "flaky");
});

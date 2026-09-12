import test from "node:test";
import assert from "node:assert/strict";
import { buildCurve, parseFinalScore, parseScores, stepsOnly, summarize } from "./curve.js";

const t0 = Date.parse("2026-09-12T10:00:00Z");
const line = (s: number, secs: number, full = false) =>
  JSON.stringify({
    ts: new Date(t0 + secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    seed: 1,
    cost: 100,
    given_cost: 100 * 2 ** s,
    score: s,
    full_gate: full,
  });

test("parseScores skips garbage and keeps order", () => {
  const text = [line(0.1, 10), "not json", line(0.5, 20), "{}"].join("\n");
  const g = parseScores(text);
  assert.deepEqual(
    g.map((x) => x.score),
    [0.1, 0.5],
  );
});

test("the curve is the running best against elapsed time", () => {
  const g = parseScores([line(0.5, 10), line(0.2, 20), line(1.0, 30), line(0.9, 40)].join("\n"));
  const c = buildCurve(g, t0);
  assert.deepEqual(
    c.map((p) => [p.t / 1000, p.best]),
    [
      [10, 0.5],
      [20, 0.5],
      [30, 1.0],
      [40, 1.0],
    ],
  );
  const s = summarize(c);
  assert.equal(s.best, 1.0);
  assert.equal(s.bestAt, 30_000);
  assert.equal(s.activeMs, 40_000);
});

test("a grade in the first second never goes negative", () => {
  const g = parseScores(line(0.3, 0));
  const c = buildCurve(g, t0 + 400);
  assert.equal(c[0]!.t, 0);
});

test("stepsOnly keeps improvements and the final point", () => {
  const g = parseScores(
    [line(0.5, 10), line(0.2, 20), line(1.0, 30), line(0.9, 40), line(0.9, 50)].join("\n"),
  );
  const s = stepsOnly(buildCurve(g, t0));
  assert.deepEqual(
    s.map((p) => [p.t / 1000, p.best]),
    [
      [10, 0.5],
      [30, 1.0],
      [50, 1.0],
    ],
  );
});

test("an empty curve summarises to nulls, not zeros", () => {
  assert.deepEqual(summarize([]), { best: null, bestAt: null, activeMs: 0 });
  assert.deepEqual(stepsOnly([]), []);
});

test("the final score is read off the grader's SCORE line", () => {
  assert.equal(parseFinalScore("build 1.2s\nverify PASS\nSCORE   +1.2345  (2.351x)\n"), 1.2345);
  assert.equal(parseFinalScore("SCORE   -0.0477  (0.968x)"), -0.0477);
  assert.equal(parseFinalScore("grade: FAIL (verification)"), null);
});

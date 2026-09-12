// =============================================================================
// Score-over-time fold. Pure: (scores.jsonl lines, agent start) → curve.
//
// The upstream grader appends one line per `./grade` with a second-resolution
// UTC timestamp. The curve is the running best against elapsed time — jcode's
// leaderboard charts plot exactly this, and the README's variance note is
// about the SHAPE of this curve, not the final number.
// =============================================================================

import type { CurvePoint, GradeRecord } from "./types.js";

export function parseScores(text: string): GradeRecord[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        const r = JSON.parse(l) as GradeRecord;
        return typeof r.score === "number" && typeof r.ts === "string" ? [r] : [];
      } catch {
        return [];
      }
    });
}

/**
 * `startedAt` is the agent's spawn time. A grade timestamp is truncated to the
 * second, so a grade run within the first second can land at t < 0; clamp it.
 */
export function buildCurve(grades: GradeRecord[], startedAt: number): CurvePoint[] {
  let best = -Infinity;
  return grades.map((g) => {
    best = Math.max(best, g.score);
    return {
      t: Math.max(0, Date.parse(g.ts) - startedAt),
      score: g.score,
      best,
      fullGate: g.full_gate,
    };
  });
}

export function summarize(curve: CurvePoint[]): {
  best: number | null;
  bestAt: number | null;
  activeMs: number;
} {
  if (curve.length === 0) return { best: null, bestAt: null, activeMs: 0 };
  let best = curve[0]!;
  for (const p of curve) if (p.score > best.score) best = p;
  return { best: best.score, bestAt: best.t, activeMs: curve[curve.length - 1]!.t };
}

/**
 * Keep the curve small for the page: every point where the running best moved,
 * plus the last point so the line ends where the run did. A run with 160
 * grades and 12 improvements publishes 13 points.
 */
export function stepsOnly(curve: CurvePoint[]): CurvePoint[] {
  const out: CurvePoint[] = [];
  let last = -Infinity;
  curve.forEach((p, i) => {
    if (p.best > last || i === curve.length - 1) {
      out.push(p);
      last = p.best;
    }
  });
  return out;
}

/** The upstream grader prints `SCORE   +1.2345  (2.351x)` on success. */
export function parseFinalScore(stdout: string): number | null {
  const m = stdout.match(/^SCORE\s+([+-]?\d+(?:\.\d+)?)/m);
  return m ? Number(m[1]) : null;
}

"use client";

import type { SignalsReport } from "../data/harness-signals";
import { EmptyState, StatTiles, type StatTile } from "./StatTiles";

// "How hill-climbable did the model think the work was?" — jcode's histogram
// of hillClimbability ratings, with the reframe gate drawn as a line. One
// sequential fill; the bars below the gate are the muted step of the same
// ramp, and the gate itself is labelled, not colour-coded.

const pct = (n: number | null) => (n === null ? null : `${Math.round(n * 100)}%`);

export function HillClimbHistogram({ report }: { report: SignalsReport }) {
  const h = report.hillClimb;
  if (h.n === 0) {
    return (
      <EmptyState>
        No hill-climbability ratings yet. Each todo item can carry a{" "}
        <code className="font-mono">hillClimbability</code> score (0–100: is there a test, a
        number, a check to iterate against?). Ratings below {h.threshold} ask the model to reframe
        the goal when the gate is on, and every rating lands here either way.
      </EmptyState>
    );
  }

  const tiles: StatTile[] = [
    { value: String(h.n), label: "ratings", note: `${h.sessions} session${h.sessions === 1 ? "" : "s"}; a re-rating counts again` },
    { value: h.mean === null ? null : h.mean.toFixed(1), label: "mean", note: `median ${h.median ?? "—"}` },
    {
      value: pct(h.belowGateRate),
      label: `below ${h.threshold}`,
      note: `${h.belowGate} asked to reframe · ${h.flagged.gated} nudged`,
      tone: (h.belowGateRate ?? 0) > 0.25 ? "text-destructive" : "text-foreground",
    },
    { value: h.range ? `${h.range[0]}–${h.range[1]}` : null, label: "observed range" },
  ];

  const scores = Object.keys(h.histogram).map(Number).sort((a, b) => a - b);
  const max = Math.max(...Object.values(h.histogram), 1);
  const W = 720;
  const H = 220;
  const padL = 36;
  const padB = 28;
  const padT = 10;
  const plotW = W - padL - 12;
  const plotH = H - padT - padB;
  const xFor = (s: number) => padL + (s / 100) * plotW;
  const barW = Math.max(4, plotW / 101 - 2);

  return (
    <div>
      <StatTiles tiles={tiles} />
      <div className="rounded-md border border-border bg-card p-6 md:p-8">
        <h3 className="text-lg font-medium text-foreground">Ratings by score</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          Only scores that received a submission are drawn. Agents are at their most capable
          with a metric to climb; a goal rated below the gate has none yet.
        </p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Hill-climbability rating histogram">
          {[0, 25, 50, 75, 100].map((s) => (
            <text key={s} x={xFor(s)} y={H - padB + 16} textAnchor="middle" className="fill-muted-foreground text-[10px] font-mono">{s}</text>
          ))}
          <line x1={padL} x2={W - 12} y1={padT + plotH} y2={padT + plotH} className="stroke-border" />
          {scores.map((s) => {
            const n = h.histogram[String(s)]!;
            const bh = (n / max) * plotH;
            return (
              <g key={s}>
                <rect
                  x={xFor(s) - barW / 2}
                  y={padT + plotH - bh}
                  width={barW}
                  height={bh}
                  rx={2}
                  fill="var(--primary)"
                  fillOpacity={s < h.threshold ? 0.35 : 0.9}
                >
                  <title>{`${s}: ${n} rating${n === 1 ? "" : "s"}${s < h.threshold ? " · below the gate" : ""}`}</title>
                </rect>
                {n === max && (
                  <text x={xFor(s)} y={padT + plotH - bh - 4} textAnchor="middle" className="fill-foreground text-[10px] font-mono">{n}</text>
                )}
              </g>
            );
          })}
          <line x1={xFor(h.threshold) - barW / 2 - 1} x2={xFor(h.threshold) - barW / 2 - 1} y1={padT} y2={padT + plotH} className="stroke-foreground/50" strokeDasharray="4 3" />
          <text x={xFor(h.threshold) - barW / 2 - 5} y={padT + 10} textAnchor="end" className="fill-muted-foreground text-[10px] font-mono">reframe below {h.threshold}</text>
        </svg>
      </div>
    </div>
  );
}

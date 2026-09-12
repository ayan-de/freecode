"use client";

import type { SignalsReport } from "../data/harness-signals";
import { EmptyState, StatTiles, type StatTile } from "./StatTiles";

// jcode's confidence study, drawn the same way: one line per todo item, from
// the confidence the model gave it at assignment to the confidence at
// completion. A line that jumps 40+ points in one step is a spike — the claim
// jcode found not to be evidence. Spikes are drawn in the destructive tone
// (a status, so it ships with the legend label, never colour alone).

const pct = (n: number | null) => (n === null ? null : `${Math.round(n * 100)}%`);
const num = (n: number | null, d = 0) => (n === null ? null : n.toFixed(d));

export function ConfidenceStepping({ report }: { report: SignalsReport }) {
  const c = report.confidence;
  if (c.n === 0) {
    return (
      <EmptyState>
        No confidence trajectories yet. The todowrite tool now takes a{" "}
        <code className="font-mono">confidence</code> score per item; once sessions carry them,{" "}
        <code className="font-mono">pnpm bench:signals</code> folds every assignment → completion
        pair out of the rollout log into this chart. {report.sessionsWithTodos} session
        {report.sessionsWithTodos === 1 ? "" : "s"} with a todo list scanned so far, none rated.
      </EmptyState>
    );
  }

  const tiles: StatTile[] = [
    { value: String(c.n), label: "items", note: "assigned with a number, then completed" },
    { value: num(c.assignedMean), label: "mean at assignment", note: "the honest number" },
    { value: num(c.completedMean), label: "mean at completion", note: "the claim" },
    {
      value: pct(c.n ? c.spikes.n / c.n : null),
      label: "spiked",
      note: `${c.spikes.n} rose 40+ in one step · ${c.spikes.gated} sent back to verify`,
      tone: c.spikes.n > 0 ? "text-destructive" : "text-foreground",
    },
  ];

  const W = 720;
  const H = 300;
  const padX = 120;
  const padY = 20;
  const plotH = H - padY * 2;
  const xL = padX;
  const xR = W - padX;
  const yFor = (v: number) => padY + plotH - (v / 100) * plotH;

  return (
    <div>
      <StatTiles tiles={tiles} />
      <div className="rounded-md border border-border bg-card p-6 md:p-8">
        <h3 className="text-lg font-medium text-foreground">Assignment → completion, per item</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          Each line is one todo item. Ideally confidence rises in steps as checks pass; a line
          that jumps straight to the top is the pattern the gate sends back.
        </p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Confidence at assignment versus at completion">
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={xL} x2={xR} y1={yFor(v)} y2={yFor(v)} className="stroke-border" strokeWidth={1} />
              <text x={xL - 10} y={yFor(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px] font-mono">{v}</text>
              <text x={xR + 10} y={yFor(v) + 3} textAnchor="start" className="fill-muted-foreground text-[10px] font-mono">{v}</text>
            </g>
          ))}
          <text x={xL} y={H - 2} textAnchor="middle" className="fill-muted-foreground text-[10px] font-mono uppercase tracking-widest">assignment</text>
          <text x={xR} y={H - 2} textAnchor="middle" className="fill-muted-foreground text-[10px] font-mono uppercase tracking-widest">completion</text>
          {c.trajectories.map((t, i) => {
            const spike = t.completed - t.assigned >= 40;
            return (
              <line
                key={i}
                x1={xL}
                x2={xR}
                y1={yFor(t.assigned)}
                y2={yFor(t.completed)}
                stroke={spike ? "var(--destructive)" : "var(--primary)"}
                strokeWidth={spike ? 1.5 : 1}
                strokeOpacity={spike ? 0.7 : 0.25}
                strokeDasharray={t.gated ? "4 3" : undefined}
              >
                <title>{`${t.assigned} → ${t.completed}${spike ? " · spike" : ""}${t.gated ? " · sent back to verify" : ""}`}</title>
              </line>
            );
          })}
        </svg>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-primary/60" /> stepped</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-destructive" /> spike (+40 in one step)</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 border-t border-dashed border-foreground/60" /> gate sent it back</span>
          {c.trajectories.length < c.n && <span>showing the latest {c.trajectories.length} of {c.n}</span>}
        </div>
      </div>
    </div>
  );
}

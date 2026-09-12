"use client";

import { useState } from "react";
import { agentColor } from "../data/agent-bench";
import type { OptTaskView, OptView } from "../data/jcode-bench";
import { EmptyState, StatTiles, type StatTile } from "./StatTiles";

// jcode bench, drawn the way jcode.sh/jcode-bench draws it: per task, the
// running best score against active time, one line per run; below it the
// leaderboard ranked by the OFFICIAL final grade. `best` (the highest sample
// the agent saw) is shown but never ranks — the page says why.

const fmtScore = (s: number | null) => (s === null ? "—" : `${s >= 0 ? "+" : ""}${s.toFixed(2)}`);
const fmtX = (s: number | null) => (s === null ? "—" : `${(2 ** s).toFixed(1)}x`);
const fmtDur = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m >= 90 ? `${(m / 60).toFixed(1)}h` : `${m}m`;
};
const fmtDate = (iso: string) => iso.slice(0, 10);

export function OptimizationBench({ view }: { view: OptView }) {
  if (view.tasks.length === 0) {
    return (
      <EmptyState>
        No optimisation runs published yet. <code className="font-mono">pnpm bench:jcode</code>{" "}
        stages the public jcode-bench tasks, lets an agent climb, runs the official final grade,
        and writes one file per task into <code className="font-mono">app/data/jcode-bench/</code>.
        The harness needs <code className="font-mono">valgrind</code> — the cost model is an
        instruction count, not a stopwatch.
      </EmptyState>
    );
  }

  const tiles: StatTile[] = view.aggregate.slice(0, 4).map((a) => ({
    value: `+${a.geomean.toFixed(2)}`,
    label: `${a.agent} · geomean`,
    note: `${a.model}, ${a.tasks} task${a.tasks === 1 ? "" : "s"} — typical ${(2 ** a.geomean).toFixed(1)}x speedup`,
    tone: a.isFreeCode ? "text-primary" : "text-foreground",
  }));

  return (
    <div className="flex flex-col gap-10">
      {tiles.length > 0 && <StatTiles tiles={tiles} />}
      {view.tasks.map((t) => (
        <TaskBlock key={t.task} task={t} />
      ))}
      <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
        Rank is by the official final grade the harness ran after the agent exited, on the
        submission as left; a run whose final verification failed has no score and sits below the
        ranked rows. <em>Best</em> is the highest sample the agent itself saw during the climb and
        can sit above the final: not every sample runs the full gate. Each row is one run —
        jcode&apos;s own variance note puts run-to-run spread near 0.1, so a gap under that says
        nothing. Tasks, verifiers and given implementations are the public{" "}
        <a
          className="underline decoration-border underline-offset-4 hover:text-foreground"
          href="https://github.com/1jehuang/jcode-bench"
        >
          1jehuang/jcode-bench
        </a>
        ; the commit is recorded on every trial.
      </p>
    </div>
  );
}

function TaskBlock({ task }: { task: OptTaskView }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const shown = task.rows.filter((r) => !hidden.has(r.key) && r.curve.length > 0);

  return (
    <div className="rounded-md border border-border bg-card p-6 md:p-8">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-mono text-lg font-medium text-foreground">{task.task}</h3>
          {task.oneLiner && (
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{task.oneLiner}</p>
          )}
        </div>
        {task.headline && (
          <p className="font-mono text-xs text-muted-foreground">
            <span className="font-bold text-primary">freecode {fmtScore(task.headline.free.final)}</span>
            {task.headline.rival && (
              <>
                <span className="text-muted-foreground/40"> · </span>
                <span style={{ color: agentColor(task.headline.rival.agent) }}>
                  {task.headline.rival.agent} {fmtScore(task.headline.rival.final)}
                </span>
              </>
            )}
          </p>
        )}
      </div>

      <CurveChart task={task} rows={shown} />

      {/* Legend doubles as the run toggle — colour follows the agent, never
          the rank, so hiding a line never repaints the others. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {task.rows
          .filter((r) => r.curve.length > 0)
          .map((r) => {
            const off = hidden.has(r.key);
            return (
              <button
                key={r.key}
                onClick={() => toggle(r.key)}
                aria-pressed={!off}
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
                  off
                    ? "border-border text-muted-foreground/50"
                    : "border-border bg-accent/30 text-foreground"
                }`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: agentColor(r.agent), opacity: off ? 0.3 : 1 }}
                />
                {r.agent} · {r.model}
                {r.gates.length > 0 && (
                  <span className="text-muted-foreground/60">({r.gates.join(", ")})</span>
                )}
                <span className="text-muted-foreground/60">{fmtScore(r.best)}</span>
              </button>
            );
          })}
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground/60">
              <th className="py-2 pr-3 font-normal">#</th>
              <th className="py-2 pr-3 font-normal">harness</th>
              <th className="py-2 pr-3 font-normal">model</th>
              <th className="py-2 pr-3 font-normal text-right">final</th>
              <th className="py-2 pr-3 font-normal text-right">speedup</th>
              <th className="py-2 pr-3 font-normal text-right">best</th>
              <th className="py-2 pr-3 font-normal text-right">grades</th>
              <th className="py-2 pr-3 font-normal text-right">active</th>
              <th className="py-2 pr-3 font-normal text-right">date</th>
              <th className="py-2 font-normal">gate</th>
            </tr>
          </thead>
          <tbody>
            {task.rows.map((r) => (
              <tr
                key={r.key}
                className={`border-b border-border/60 ${r.verified ? "" : "text-muted-foreground/60"}`}
              >
                <td className="py-2 pr-3 text-muted-foreground/50">{r.rank ?? "—"}</td>
                <td className="py-2 pr-3">
                  <span
                    className={r.isFreeCode ? "font-bold" : ""}
                    style={{ color: agentColor(r.agent) }}
                  >
                    {r.agent}
                  </span>
                  {r.gates.length > 0 && (
                    <span className="ml-1.5 text-muted-foreground/60">{r.gates.join(", ")}</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-foreground/80">{r.model}</td>
                <td className="py-2 pr-3 text-right tabular-nums font-semibold text-foreground">
                  {r.verified ? fmtScore(r.final) : "no score"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtX(r.final)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                  {fmtScore(r.best)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.grades}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {fmtDur(r.activeMs)}
                  {r.timedOut && <span className="text-destructive"> †</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                  {fmtDate(r.date)}
                </td>
                <td className="py-2 text-muted-foreground">
                  {r.verified ? (r.fullGate ? "full" : "sampled") : "failed"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {task.rows.some((r) => r.timedOut) && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            † hit the runner&apos;s wall-clock cap; the submission as left was still graded.
          </p>
        )}
      </div>
    </div>
  );
}

/** Running best vs active time, one step line per run. Fixed viewBox, scales to width. */
function CurveChart({ task, rows }: { task: OptTaskView; rows: OptTaskView["rows"] }) {
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const W = 720;
  const H = 260;
  const padL = 44;
  const padR = 16;
  const padT = 12;
  const padB = 32;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxT = Math.max(task.maxActiveMs, 60_000);
  const minY = Math.min(0, ...rows.flatMap((r) => r.curve.map((p) => p.best)));
  const maxY = Math.max(task.maxBest, 0.5) * 1.08;
  const xFor = (t: number) => padL + (t / maxT) * plotW;
  const yFor = (v: number) => padT + plotH - ((v - minY) / (maxY - minY)) * plotH;

  // Round ticks: score in halves (or whole doublings past +4), time in a
  // step that lands on minutes a reader would pick.
  const yStep = maxY - minY > 4 ? 1 : 0.5;
  const yVals: number[] = [];
  for (let v = Math.ceil(minY / yStep) * yStep; v <= maxY; v += yStep) yVals.push(v);
  const minutes = maxT / 60_000;
  const xStepMin = [5, 10, 15, 30, 60, 120, 180, 240, 360].find((m) => minutes / m <= 6) ?? 480;
  const xVals: number[] = [];
  for (let m = 0; m * 60_000 <= maxT; m += xStepMin) xVals.push(m * 60_000);

  // Step path: best holds until the next grade moves it.
  const pathFor = (curve: OptTaskView["rows"][number]["curve"]) => {
    if (curve.length === 0) return "";
    let d = `M ${xFor(0)} ${yFor(0)}`;
    let lastY = yFor(0);
    for (const p of curve) {
      d += ` L ${xFor(p.t)} ${lastY} L ${xFor(p.t)} ${yFor(p.best)}`;
      lastY = yFor(p.best);
    }
    return d;
  };
  const bestAt = (curve: OptTaskView["rows"][number]["curve"], t: number) => {
    let b: number | null = null;
    for (const p of curve) if (p.t <= t) b = p.best;
    return b;
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${task.task}: running best score against active time`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          if (x < padL || x > W - padR) return setHover(null);
          setHover({ x, t: ((x - padL) / plotW) * maxT });
        }}
        onMouseLeave={() => setHover(null)}
      >
        {yVals.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yFor(v)} y2={yFor(v)} className="stroke-border" strokeWidth={1} />
            <text x={padL - 8} y={yFor(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px] font-mono">
              {fmtScore(v)}
            </text>
          </g>
        ))}
        {xVals.map((t, i) => (
          <text key={i} x={xFor(t)} y={H - padB + 16} textAnchor="middle" className="fill-muted-foreground text-[10px] font-mono">
            {fmtDur(t)}
          </text>
        ))}
        {rows.map((r) => (
          <path
            key={r.key}
            d={pathFor(r.curve)}
            fill="none"
            stroke={agentColor(r.agent)}
            strokeWidth={r.isFreeCode ? 2.5 : 2}
            strokeDasharray={r.gates.length ? "6 3" : undefined}
            strokeLinejoin="round"
          />
        ))}
        {/* Direct label at the line end for up to four series. */}
        {rows.slice(0, 4).map((r) => {
          const last = r.curve[r.curve.length - 1];
          if (!last) return null;
          // A line that runs to the right edge gets its label anchored back
          // inside the plot instead of clipped off it.
          const nearEdge = xFor(last.t) > W - padR - 110;
          return (
            <text
              key={`l-${r.key}`}
              x={nearEdge ? xFor(last.t) - 4 : xFor(last.t) + 6}
              y={yFor(last.best) - 5}
              textAnchor={nearEdge ? "end" : "start"}
              className="fill-foreground text-[10px] font-mono"
            >
              {r.agent} {fmtScore(last.best)}
            </text>
          );
        })}
        {hover && (
          <line x1={hover.x} x2={hover.x} y1={padT} y2={H - padB} className="stroke-foreground/40" strokeWidth={1} strokeDasharray="3 3" />
        )}
      </svg>
      {hover && rows.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded border border-border bg-popover px-2.5 py-1.5 font-mono text-[11px] text-popover-foreground shadow-xl">
          <span className="text-muted-foreground">{fmtDur(hover.t)}</span>
          {rows.map((r) => (
            <span key={r.key} className="ml-3">
              <span style={{ color: agentColor(r.agent) }}>{r.agent}</span>{" "}
              {fmtScore(bestAt(r.curve, hover.t))}
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground">
        Running best vs active time. Dashed = a harness gate was on for that run.
      </p>
    </div>
  );
}

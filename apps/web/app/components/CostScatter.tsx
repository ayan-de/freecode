"use client";

import { agentColor, type CostPoint } from "../data/agent-bench";

// Cost distribution across bugs (onesuperbrain-style): one column per instance,
// one dot per metered trial, freecode against the rest. A dot's height is what
// that trial cost; an open ring is a trial that did not resolve, so an eye can
// tell a cheap win from a cheap giving-up. All trials, not just solved-by-all —
// the point is the spread, including the outliers a mean hides.

const usd = (n: number) => `$${n.toFixed(4)}`;
const shortId = (id: string) => id.replace(/^.*__/, "").replace(/^django-/, "");

export function CostScatter({ points }: { points: CostPoint[] }) {
  if (points.length === 0) return null;

  const instances = [...new Set(points.map((p) => p.instanceId))].sort();
  const maxUsd = Math.max(...points.map((p) => p.usd));
  const agentsHere = [...new Set(points.map((p) => p.agent))];

  // Geometry. Fixed viewBox; the SVG scales to its container width.
  const W = 720;
  const H = 300;
  const padL = 52;
  const padR = 16;
  const padB = 64;
  const padT = 16;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const colW = plotW / instances.length;

  const yFor = (v: number) => padT + plotH - (v / (maxUsd * 1.1)) * plotH;
  const xFor = (instanceId: string, agent: string) => {
    const col = instances.indexOf(instanceId);
    const nAgents = agentsHere.length;
    const slot = agentsHere.indexOf(agent);
    // Spread each agent's dots within the column so they don't overlap.
    const inner = colW * 0.5;
    const step = nAgents > 1 ? inner / (nAgents - 1) : 0;
    return padL + col * colW + colW / 2 - inner / 2 + slot * step;
  };

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => (maxUsd * 1.1 * i) / ticks);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[560px]"
        role="img"
        aria-label="Cost per trial across bugs"
      >
        {/* y gridlines + labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={yFor(t)}
              y2={yFor(t)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={yFor(t) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[10px] font-mono"
            >
              {`$${t.toFixed(3)}`}
            </text>
          </g>
        ))}

        {/* x labels — one per instance */}
        {instances.map((id) => (
          <text
            key={id}
            x={padL + instances.indexOf(id) * colW + colW / 2}
            y={H - padB + 16}
            textAnchor="end"
            transform={`rotate(-35 ${padL + instances.indexOf(id) * colW + colW / 2} ${H - padB + 16})`}
            className="fill-muted-foreground text-[9px] font-mono"
          >
            {shortId(id)}
          </text>
        ))}

        {/* points */}
        {points.map((p, i) => {
          const cx = xFor(p.instanceId, p.agent);
          const cy = yFor(p.usd);
          const color = agentColor(p.agent);
          return p.resolved === false ? (
            // open ring = attempted but not resolved
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={4}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
            >
              <title>{`${p.agent} · ${shortId(p.instanceId)} · ${usd(p.usd)} · not resolved`}</title>
            </circle>
          ) : (
            <circle key={i} cx={cx} cy={cy} r={4} fill={color} stroke={color}>
              <title>{`${p.agent} · ${shortId(p.instanceId)} · ${usd(p.usd)}${p.resolved === true ? " · resolved" : ""}`}</title>
            </circle>
          );
        })}
      </svg>

      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-muted-foreground">
        {agentsHere.map((a) => (
          <span key={a} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: agentColor(a) }}
            />
            {a}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-foreground/60" />
          open ring = not resolved
        </span>
      </div>
    </div>
  );
}

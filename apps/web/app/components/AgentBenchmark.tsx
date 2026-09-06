"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Minus } from "lucide-react";
import { agentColor, type BenchView } from "../data/agent-bench";
import { BenchBarList, type BenchBar } from "./BenchBarList";
import { CostScatter } from "./CostScatter";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(0)}s`;
const tok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
const usd = (n: number) => `$${n.toFixed(4)}`;

export function AgentBenchmark({ views }: { views: BenchView[] }) {
  // Every matchup ran on a pinned model; the picker groups the page by it, so
  // when the same matchups exist on several models each set stays comparable
  // only within itself (spec: "change the model and it is a new experiment").
  const models = [...new Set(views.map((v) => v.model))];
  const [model, setModel] = useState(models[0] ?? "");
  const modelViews = views.filter((v) => v.model === model);
  const [slug, setSlug] = useState(modelViews[0]?.slug ?? "");
  const view = modelViews.find((v) => v.slug === slug) ?? modelViews[0];

  if (!view) {
    return (
      <section className="w-full max-w-4xl mx-auto px-6 py-24">
        <h1 className="text-3xl font-medium text-foreground">Agent benchmark</h1>
        <p className="text-muted-foreground mt-3">
          No runs published yet. <code className="font-mono">pnpm bench:agents</code>{" "}
          writes one file per matchup into{" "}
          <code className="font-mono">app/data/benchmarks/</code>.
        </p>
      </section>
    );
  }

  const provisional = !view.graded || view.isolation === "none";

  const outcomeBars: BenchBar[] = view.agents.map((a) => ({
    label: a.id,
    value: a.rate,
    display: pct(a.rate),
    note: `${a.successes}/${a.trials} trials`,
    highlight: a.isFreeCode,
    color: agentColor(a.id),
  }));

  const slowest = Math.max(...view.agents.map((a) => a.medianMs), 1);
  const speedBars: BenchBar[] = view.agents.map((a) => ({
    label: a.id,
    value: a.medianMs,
    display: secs(a.medianMs),
    note: `median of ${a.trials}`,
    highlight: a.isFreeCode,
    color: agentColor(a.id),
  }));

  const sizeBars: BenchBar[] = view.agents.map((a) => ({
    label: a.id,
    value: a.medianPatchBytes,
    display: `${Math.round(a.medianPatchBytes)}B`,
    note: `median of ${a.trials}`,
    highlight: a.isFreeCode,
    color: agentColor(a.id),
  }));

  // Metering (spec §6.4/§7): shown only for agents the proxy actually saw.
  // An unmetered agent gets a zero-width bar labelled as such, never a zero —
  // a blank is not the cheapest run in the table.
  const anyMetered = view.agents.some((a) => a.meteredTrials > 0);
  // Prompt-cache section data: shown only when the proxy recorded the cache
  // columns at all. Fresh = input the trial paid full price for.
  const anyCache = view.agents.some((a) => a.cacheHitRate !== undefined);
  const maxInput = Math.max(...view.agents.map((a) => a.meanInput ?? 0), 1);
  const freshOf = (a: { meanInput?: number; meanCacheRead?: number }) =>
    Math.max((a.meanInput ?? 0) - (a.meanCacheRead ?? 0), 0);
  const tokenBars: BenchBar[] = view.agents.map((a) => ({
    label: a.id,
    value: a.meanTokens ?? 0,
    display: a.meanTokens !== undefined ? tok(a.meanTokens) : "unmetered",
    note:
      a.meteredTrials > 0
        ? `mean of ${a.meteredTrials} metered trial${a.meteredTrials === 1 ? "" : "s"}${a.meanTurns !== undefined ? ` · ~${Math.round(a.meanTurns)} turns` : ""}`
        : "proxy saw no traffic",
    highlight: a.isFreeCode,
    color: agentColor(a.id),
  }));
  const costBars: BenchBar[] = view.agents.map((a) => ({
    label: a.id,
    value: typeof a.meanUsd === "number" ? a.meanUsd : 0,
    display:
      typeof a.meanUsd === "number"
        ? usd(a.meanUsd)
        : a.meanUsd === null
          ? "unpriced"
          : "unmetered",
    note:
      a.worstUsd !== undefined
        ? `worst single trial ${usd(a.worstUsd)}`
        : a.meteredTrials > 0
          ? "no rate-card row for this model"
          : "proxy saw no traffic",
    highlight: a.isFreeCode,
    color: agentColor(a.id),
  }));

  // Headline cards, freecode against the strongest rival on each axis. The
  // comparison is deliberately unflattering — "slower" goes in the headline in
  // red, because a benchmark we publish only when we win is an advertisement.
  const free = view.agents.find((a) => a.isFreeCode);
  const rivals = view.agents.filter((a) => !a.isFreeCode);
  const fastestRival = rivals.length
    ? rivals.reduce((m, a) => (a.medianMs < m.medianMs ? a : m))
    : undefined;
  const bestRival = rivals.length
    ? rivals.reduce((m, a) => (a.rate > m.rate ? a : m))
    : undefined;
  const timeVerdict = (() => {
    if (!free || !fastestRival || !free.medianMs || !fastestRival.medianMs)
      return "—";
    const r = free.medianMs / fastestRival.medianMs;
    if (Math.abs(r - 1) < 0.05) return "even";
    return r < 1 ? `${(1 / r).toFixed(1)}× faster` : `${r.toFixed(1)}× slower`;
  })();
  // The token-efficiency card, when both sides are metered — freecode's usual
  // headline. Green when freecode uses fewer, red when more; never hidden.
  const edge = view.tokenEdge;
  const tokenCard = edge
    ? {
        value: edge.pctFewer >= 0 ? `${edge.pctFewer}% fewer` : `${-edge.pctFewer}% more`,
        tone: edge.pctFewer > 0 ? "text-primary" : edge.pctFewer < 0 ? "text-destructive" : "text-foreground",
        label: "tokens per trial",
        note: `freecode ${tok(edge.freeTokens)} vs ${edge.rivalId} ${tok(edge.rivalTokens)}`,
      }
    : undefined;
  // Cost per trial vs the cheapest priced rival — same green/red rule as the
  // token card, and absent (never zero) when either side is unmetered/unpriced.
  const costCard = (() => {
    if (typeof free?.meanUsd !== "number" || free.meanUsd <= 0) return undefined;
    const priced = rivals.filter(
      (a): a is typeof a & { meanUsd: number } => typeof a.meanUsd === "number",
    );
    if (!priced.length) return undefined;
    const rival = priced.reduce((m, a) => (a.meanUsd < m.meanUsd ? a : m));
    const r = rival.meanUsd / free.meanUsd;
    return {
      value:
        Math.abs(r - 1) < 0.05
          ? "even"
          : r > 1
            ? `${r.toFixed(1)}× cheaper`
            : `${(1 / r).toFixed(1)}× pricier`,
      tone:
        Math.abs(r - 1) < 0.05
          ? "text-foreground"
          : r > 1
            ? "text-primary"
            : "text-destructive",
      label: "cost per trial",
      note: `freecode ${usd(free.meanUsd)} vs ${rival.id} ${usd(rival.meanUsd)}`,
    };
  })();

  const headline =
    free && fastestRival && bestRival
      ? [
          {
            value: `${pct(free.rate)} vs ${pct(bestRival.rate)}`,
            tone: "text-foreground",
            label: view.metric.label.toLowerCase(),
            note: `freecode vs ${bestRival.id}, over ${view.sharedInstances.length} shared instance${view.sharedInstances.length === 1 ? "" : "s"}`,
          },
          ...(tokenCard ? [tokenCard] : []),
          {
            value: timeVerdict,
            tone: timeVerdict.endsWith("faster")
              ? "text-primary"
              : timeVerdict.endsWith("slower")
                ? "text-destructive"
                : "text-foreground",
            label: "median wall time",
            note: `freecode ${secs(free.medianMs)} vs ${fastestRival.id} ${secs(fastestRival.medianMs)}`,
          },
          ...(costCard ? [costCard] : []),
          // Patch size drops off the headline row when the token card is
          // present (keeps it to 3 cards); it still lives in its own bar below.
          ...(tokenCard
            ? []
            : [
                {
                  value: `${Math.round(free.medianPatchBytes)}B vs ${Math.round(fastestRival.medianPatchBytes)}B`,
                  tone: "text-foreground",
                  label: "median patch size",
                  note: `freecode vs ${fastestRival.id} — style, not quality`,
                },
              ]),
        ]
      : [];

  /** Every trial an agent ran on the shared set, in matrix order. */
  const stripFor = (agentId: string) =>
    view.matrix
      .filter((row) => view.sharedInstances.includes(row.instanceId))
      .flatMap((row) =>
        row.cells
          .filter((c) => c.agent === agentId)
          .map((c) => ({ ...c, instanceId: row.instanceId })),
      );

  return (
    <section className="w-full max-w-4xl mx-auto px-6 py-16 md:py-24">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground/60 mb-3">
          Agent benchmark
        </p>
        <h1 className="text-3xl md:text-4xl font-medium text-foreground tracking-tight">
          We gave every agent the same bugs
        </h1>
        <p className="text-lg text-muted-foreground mt-3 max-w-2xl">
          freecode against other coding agents on {view.taskSet.name} —{" "}
          {view.taskSet.repo}. Same tasks, same model, same key, and every agent
          at full autonomy.
        </p>

        {/* The pinned model, as the page's primary control. One benchmark is
            one model: picking a different one swaps the whole page, because
            numbers measured on different models never share a table. */}
        <div className="mt-6">
          <label
            htmlFor="bench-model"
            className="block font-mono text-xs uppercase tracking-widest text-muted-foreground/60 mb-2"
          >
            Model
          </label>
          <div className="relative inline-block">
            <select
              id="bench-model"
              value={model}
              onChange={(e) => {
                const m = e.target.value;
                setModel(m);
                setSlug(views.find((v) => v.model === m)?.slug ?? "");
              }}
              className="appearance-none cursor-pointer rounded-md border border-border bg-card pl-5 pr-14 py-3.5 font-mono text-lg md:text-xl font-bold text-foreground tracking-tight shadow-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
      </header>

      {/* One tab per matchup. Separate tabs rather than one merged table
          because a matchup is the unit of valid comparison: agents measured
          side by side in the same runs belong together, and agents that never
          met do not. */}
      <div
        role="tablist"
        aria-label="Matchups"
        className="flex flex-wrap gap-2 border-b border-border mb-8"
      >
        {modelViews.map((v) => {
          const active = v.slug === view.slug;
          return (
            <button
              key={v.slug}
              role="tab"
              aria-selected={active}
              onClick={() => setSlug(v.slug)}
              className={`-mb-px rounded-t px-3 py-2 font-mono text-xs transition-colors border-b-2 ${
                active
                  ? "border-primary text-primary font-bold"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/10"
              }`}
            >
              {v.title}
              <span className="ml-2 text-muted-foreground/50">
                {v.sharedInstances.length}
              </span>
            </button>
          );
        })}
      </div>

      <dl className="mb-10 flex flex-wrap gap-x-8 gap-y-2 font-mono text-xs text-muted-foreground">
        <div>
          <dt className="inline text-muted-foreground/60">runs </dt>
          <dd className="inline text-foreground/80">
            {view.runs.length}, latest {view.runId}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground/60">instances </dt>
          <dd className="inline text-foreground/80">
            {view.sharedInstances.length} shared
            {view.ragged ? ` of ${view.taskSet.instances.length}` : ""}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground/60">graded </dt>
          <dd className="inline text-foreground/80">
            {view.graded ? "SWE-bench harness" : "no"}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground/60">isolation </dt>
          <dd
            className={`inline ${view.isolationMix.mixed ? "text-destructive" : "text-foreground/80"}`}
          >
            {view.isolationMix.mixed
              ? `mixed — ${view.isolationMix.container} container / ${view.isolationMix.none} open`
              : view.isolation}
          </dd>
        </div>
      </dl>

      {/* Every run stitched into this page, on the record. One run is a trust
          signal ("nothing merged"); several are the receipt behind the
          stitched-runs caveat — which rows were measured when, against what. */}
      <div className="mb-10 rounded-md border border-border bg-card px-5 py-4 md:px-6">
        <h4 className="font-mono text-xs uppercase tracking-widest text-muted-foreground/60 mb-1">
          Run history
        </h4>
        <p className="text-xs text-muted-foreground mb-3">
          {view.runs.length === 1
            ? "Every row on this page comes from this single run — nothing was merged in."
            : `${view.runs.length} runs merged into this page. Rows measured at different times met a moving endpoint — trust the shape, not the decimals.`}
        </p>
        {/* publish.ts prepends the newest run, so the array is already
            newest-first — #1 is the oldest, the top row the latest. */}
        <ol className="space-y-0.5">
          {view.runs.map((r, i) => (
            <li
              key={r.runId}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-1.5 border-b border-border/60 last:border-0 font-mono text-xs"
            >
              <span className="w-6 shrink-0 text-muted-foreground/40">
                #{view.runs.length - i}
              </span>
              <span className="text-foreground/80 tabular-nums">
                {new Date(r.generatedAt).toISOString().slice(0, 16).replace("T", " ")}{" "}
                UTC
              </span>
              <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
                {r.agents.map((a, j) => (
                  <span key={a}>
                    <span className="font-bold" style={{ color: agentColor(a) }}>
                      {a}
                    </span>
                    {j < r.agents.length - 1 && (
                      <span className="text-muted-foreground/40"> ·</span>
                    )}
                  </span>
                ))}
              </span>
              {r.runId === view.runId && (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-px text-[10px] font-bold text-primary">
                  latest
                </span>
              )}
              <span className="ml-auto text-muted-foreground/40 text-[10px]">
                {r.runId}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {provisional && (
        <div className="mb-10 rounded-md border border-destructive/40 bg-destructive/5 p-5 md:p-6">
          <div className="flex gap-3">
            <AlertTriangle
              className="h-5 w-5 shrink-0 text-destructive mt-0.5"
              aria-hidden
            />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Phase {view.phase} — pipeline check, not a result
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                {view.graded
                  ? "Trials ran without container isolation, so these numbers are not publishable."
                  : "Nothing on this page has been graded. The bars say an agent changed a file; they do not say it fixed the bug. Read the caveats before quoting any of it."}
              </p>
            </div>
          </div>
        </div>
      )}

      {headline.length > 0 && (
        <div
          className={`grid grid-cols-1 sm:grid-cols-2 ${headline.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-4 mb-12`}
        >
          {headline.map((h) => (
            <div
              key={h.label}
              className="rounded-md border border-border bg-card p-5"
            >
              <div
                className={`font-mono text-xl md:text-2xl font-bold tracking-tight ${h.tone}`}
              >
                {h.value}
              </div>
              <div className="text-sm font-medium text-foreground mt-1.5">
                {h.label}
              </div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {h.note}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-12">
        <div className="rounded-md border border-border bg-card p-6 md:p-8">
          <h3 className="text-lg font-medium text-foreground">Setup</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            The autonomy flag is part of the experiment, not a footnote: running
            one agent at full autonomy against another at its default measures
            permission defaults rather than agents.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="text-muted-foreground/60">
                <tr className="border-b border-border">
                  <th className="pb-2 pr-4 font-normal">agent</th>
                  <th className="pb-2 pr-4 font-normal">version</th>
                  <th className="pb-2 pr-4 font-normal">model</th>
                  <th className="pb-2 font-normal">autonomy</th>
                </tr>
              </thead>
              <tbody>
                {view.agents.map((a) => (
                  <tr key={a.id} className="border-b border-border/60">
                    <td
                      className="py-2.5 pr-4 font-bold"
                      style={{ color: agentColor(a.id) }}
                    >
                      {a.id}
                    </td>
                    <td className="py-2.5 pr-4 text-muted-foreground">
                      {a.version}
                    </td>
                    <td className="py-2.5 pr-4 text-foreground/70">{a.model}</td>
                    <td className="py-2.5 text-muted-foreground/70">
                      {a.autonomy}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <BenchBarList
          id={`outcome-${view.slug}`}
          title={view.metric.label}
          description={`${view.metric.help} Computed over the ${view.sharedInstances.length} instance${view.sharedInstances.length === 1 ? "" : "s"} every agent in this matchup ran${view.ragged ? `, not all ${view.taskSet.instances.length} below` : ""}.`}
          bars={outcomeBars}
          footnote={
            view.graded
              ? undefined
              : "Every agent scores 100% here as soon as it edits anything, which is exactly why this bar is not a scoreboard yet."
          }
        >
          {/* One square per trial, onesuperbrain-style: the shape of the result
              at a glance, before any averaging. */}
          <div className="mt-6 pt-5 border-t border-border space-y-2.5">
            {view.agents.map((a) => {
              const cells = stripFor(a.id);
              const ok = cells.filter((c) => c.ok).length;
              return (
                <div key={a.id} className="flex items-center gap-3">
                  <span
                    className="w-28 shrink-0 font-mono text-xs font-bold"
                    style={{ color: agentColor(a.id) }}
                  >
                    {a.id}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {cells.map((c) => (
                      <span
                        key={`${c.instanceId}-${c.trial}`}
                        title={`${c.instanceId} · t${c.trial} · ${secs(c.durationMs)} · ${c.reason}${view.isolationMix.mixed && c.isolation ? ` · ${c.isolation}` : ""}`}
                        className={`h-4 w-4 rounded-[3px] border ${c.ok ? "" : "bg-destructive/10 border-destructive/60"}`}
                        style={
                          c.ok
                            ? { backgroundColor: agentColor(a.id), borderColor: agentColor(a.id) }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground/60">
                    {ok}/{cells.length}
                  </span>
                </div>
              );
            })}
          </div>
        </BenchBarList>

        <BenchBarList
          id={`speed-${view.slug}`}
          title="Median wall time"
          description="Spawn to agent exit. Shorter is better — the longest bar is the slowest agent, not the winner. An agent that runs the tests pays for it here, which is not obviously a vice."
          bars={speedBars}
          footnote={`Slowest median in this matchup: ${secs(slowest)}.`}
        >
          {/* Wall time decomposed: turns per trial × seconds per turn. The
              interesting finding is when the slower agent has the FASTER
              turns — then the whole gap is round trips, not latency. */}
          {free?.meanTurns !== undefined &&
            fastestRival?.meanTurns !== undefined &&
            (() => {
              const perTurn = (a: { medianMs: number; meanTurns?: number }) =>
                a.medianMs / (a.meanTurns as number);
              const rows = [free, fastestRival];
              const freeSlower = free.medianMs > fastestRival.medianMs;
              const freeMoreTurns = free.meanTurns > fastestRival.meanTurns;
              const freeFasterTurns = perTurn(free) < perTurn(fastestRival);
              return (
                <div className="mt-6 pt-5 border-t border-border">
                  <h4 className="text-sm font-medium text-foreground mb-3">
                    Where the time goes
                  </h4>
                  <div className="space-y-1.5 mb-4">
                    {rows.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 font-mono text-xs">
                        <span
                          className="w-28 shrink-0 font-bold"
                          style={{ color: agentColor(a.id) }}
                        >
                          {a.id}
                        </span>
                        <span className="text-foreground/80">
                          ~{Math.round(a.meanTurns as number)} turns per trial
                        </span>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="text-foreground/80">
                          ~{(perTurn(a) / 1000).toFixed(1)}s per turn
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {freeSlower && freeMoreTurns && freeFasterTurns
                      ? `freecode's turns are actually faster than ${fastestRival.id}'s — it loses wall time purely by making ~${Math.round(((free.meanTurns as number) / (fastestRival.meanTurns as number) - 1) * 100)}% more round trips. Every extra turn pays a full network round-trip plus time-to-first-token, even on a warm prompt cache; ${fastestRival.id} packs more work into each turn and finishes sooner.`
                      : "Wall time is turns × time per turn: an agent can lose this bar by making slow turns, or by making more of them. The split above says which."}
                  </p>
                </div>
              );
            })()}
        </BenchBarList>

        <BenchBarList
          id={`size-${view.slug}`}
          title="Median patch size"
          description="Bytes of diff produced. A fact about each harness's style, not a score — a bigger patch is not a better fix, and a smaller one is not automatically surgical."
          bars={sizeBars}
        >
          <div className="mt-6 pt-5 border-t border-border">
            <h4 className="text-sm font-medium text-foreground mb-2">
              New files created
            </h4>
            {view.agents.every((a) => a.newFilesTotal === 0) ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                None — across all{" "}
                {view.agents.reduce((s, a) => s + a.trials, 0)} trials, every
                patch edited existing code only. That is what a bug-fix task set
                should look like: a harness that scaffolds new files here would
                be a smell, not a feature.
              </p>
            ) : (
              <div className="space-y-1.5">
                {view.agents.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 font-mono text-xs"
                  >
                    <span
                      className="w-28 shrink-0 font-bold"
                      style={{ color: agentColor(a.id) }}
                    >
                      {a.id}
                    </span>
                    <span className="text-foreground/80">
                      {a.newFilesTotal === 0
                        ? "none — edits only"
                        : `${a.newFilesTotal} new file${a.newFilesTotal === 1 ? "" : "s"} across ${a.newFileTrials} of ${a.trials} trials`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </BenchBarList>

        {anyMetered && (
          <BenchBarList
            id={`tokens-${view.slug}`}
            title="Tokens per trial"
            description="Input + output counted off one recording proxy for every agent — the same meter, the same rules, never each vendor's own accounting. Fewer is cheaper, but an agent that gives up early is also cheap; read this next to the outcome bar, not instead of it."
            bars={tokenBars}
          />
        )}

        {anyCache && (
          <div className="rounded-md border border-border bg-card p-6 md:p-8">
            <h3 className="text-lg font-medium text-foreground">Prompt cache</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-6">
              How much of each trial&apos;s input the provider served from its
              prompt cache, off the same meter as the token chart. The pale
              segment was read from cache at a discounted rate; the solid
              segment is fresh context, billed in full. Bars share one scale,
              so their lengths also compare input volume.
            </p>
            <div className="space-y-4">
              {view.agents.map((a) => {
                const hasCache = a.cacheHitRate !== undefined;
                const input = a.meanInput ?? 0;
                const cached = a.meanCacheRead ?? 0;
                const fresh = freshOf(a);
                const display = hasCache
                  ? `${((a.cacheHitRate as number) * 100).toFixed(1)}% cached`
                  : a.meteredTrials > 0
                    ? "no cache data"
                    : "unmetered";
                const note = hasCache
                  ? `~${tok(fresh)} fresh of ${tok(input)}/trial${(a.meanCacheWrite ?? 0) > 0 ? ` · ${tok(a.meanCacheWrite as number)} writes` : ""}`
                  : a.meteredTrials > 0
                    ? "proxy recorded no cache columns"
                    : "proxy saw no traffic";
                return (
                  <div
                    key={a.id}
                    className="flex flex-col md:flex-row md:items-center justify-between py-2 border-b border-border hover:bg-accent/10 px-2 rounded transition-colors"
                  >
                    <div className="w-full md:w-36 flex items-center justify-between md:justify-start mb-1 md:mb-0">
                      <span
                        className={`font-mono text-sm ${a.isFreeCode ? "font-bold" : ""}`}
                        style={{ color: agentColor(a.id) }}
                      >
                        {a.id}
                      </span>
                      <span className="md:hidden text-xs text-muted-foreground/60">
                        {display}
                      </span>
                    </div>
                    <div className="flex-1 mx-0 md:mx-6 flex items-center h-6">
                      <div className="w-full bg-muted h-3.5 rounded overflow-hidden border border-border">
                        {hasCache && input > 0 && (
                          <div
                            className="h-full flex transition-all duration-1000 ease-out"
                            style={{ width: `${(input / maxInput) * 100}%` }}
                          >
                            <div
                              className="h-full"
                              style={{
                                width: `${(cached / input) * 100}%`,
                                backgroundColor: agentColor(a.id),
                                opacity: 0.3,
                              }}
                            />
                            <div
                              className="h-full"
                              style={{
                                width: `${(fresh / input) * 100}%`,
                                backgroundColor: agentColor(a.id),
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="hidden md:flex w-56 justify-between items-center text-right font-mono text-xs">
                      <span
                        className={`text-sm ${a.isFreeCode ? "font-semibold" : ""}`}
                        style={{ color: agentColor(a.id) }}
                      >
                        {display}
                      </span>
                      <span className="text-muted-foreground/60 text-[10px] w-32">
                        {note}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[11px] text-muted-foreground/70">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-foreground/25" aria-hidden />
                read from cache (discounted)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-foreground/80" aria-hidden />
                fresh input (billed in full)
              </span>
            </div>
            {(() => {
              const freeCache = view.agents.find(
                (a) => a.isFreeCode && a.cacheHitRate !== undefined,
              );
              const rivalCache = view.agents.find(
                (a) => !a.isFreeCode && a.cacheHitRate !== undefined,
              );
              return (
                <div className="mt-6 p-4 rounded bg-muted border border-border">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {freeCache && rivalCache
                      ? `A high hit rate means the harness keeps its prompt stable enough for the provider to reuse it. What each trial actually pays full price for is the solid segment: freecode ~${tok(freshOf(freeCache))} fresh input tokens per trial vs ${rivalCache.id} ~${tok(freshOf(rivalCache))} — the hit rate is where a token gap becomes a cost gap.`
                      : "A high hit rate means the harness keeps its prompt stable enough for the provider to reuse it — the solid segment is what each trial actually pays full price for."}
                  </p>
                </div>
              );
            })()}
          </div>
        )}

        {anyMetered && (
          <BenchBarList
            id={`cost-${view.slug}`}
            title="Cost per trial"
            description="USD from a committed rate card applied to the proxy's counts — identical pricing for every agent. Cache reads are discounted, not added. The worst-single-trial figure is there because a good mean can hide one runaway."
            bars={costBars}
            footnote={
              view.cost
                ? view.cost.suppressed
                  ? `Cost on the intersection of solved bugs (spec §7.2) is suppressed: only ${view.cost.instances.length} instance${view.cost.instances.length === 1 ? "" : "s"} were resolved by every agent, and below 3 the mean is an anecdote.`
                  : `On the ${view.cost.instances.length} bugs every agent solved: ${view.cost.perAgent
                      .map(
                        (p) =>
                          `${p.id} ${typeof p.meanUsd === "number" ? usd(p.meanUsd) : "unpriced"}${p.meanTokens !== null ? ` (${tok(p.meanTokens)} tok)` : ""}`,
                      )
                      .join(" · ")}. Averaging over failures would make the quitter cheapest — this mean covers solved bugs only.`
                : "Per-solved-bug cost (spec §7.2) appears once the matchup is graded — averaging cost over failed attempts would make the agent that gives up fastest look cheapest."
            }
          />
        )}

        {view.costPoints.length > 0 && (
          <div className="rounded-md border border-border bg-card p-6 md:p-8">
            <h3 className="text-lg font-medium text-foreground">
              Cost distribution
            </h3>
            <p className="text-sm text-muted-foreground mt-1 mb-6">
              Every metered trial, one dot, by bug. A mean hides the outliers —
              this does not. An open ring is a trial that ran but did not
              resolve, so a cheap dot low on the chart is not always a win.
            </p>
            <CostScatter points={view.costPoints} />
          </div>
        )}

        {view.cost && !view.cost.suppressed && view.cost.perBug.length > 0 && (
          <div className="rounded-md border border-border bg-card p-6 md:p-8">
            <h3 className="text-lg font-medium text-foreground">
              What each fix cost
            </h3>
            <p className="text-sm text-muted-foreground mt-1 mb-6">
              Only the {view.cost.instances.length} bugs every agent resolved
              (spec §7.2) — same bug, same model, so the gap is how much context
              each harness moved to get there. Cost is the mean over that
              agent&apos;s resolved trials of the bug; the cheaper agent on each
              row is in bold.
            </p>
            {(() => {
              // One scale for the whole card: every bar is a fraction of the
              // most expensive fix anywhere in it, so bugs compare to each
              // other, not just agents within a bug.
              const maxUsd =
                Math.max(
                  ...view.cost.perBug.flatMap((row) =>
                    row.perAgent
                      .map((p) => p.usd)
                      .filter((u): u is number => typeof u === "number"),
                  ),
                ) || 1;
              const bugGroup = (
                key: string,
                title: React.ReactNode,
                perAgent: { id: string; usd: number | null; tokens: number | null }[],
              ) => {
                const cheapest = Math.min(
                  ...perAgent
                    .map((p) => p.usd)
                    .filter((u): u is number => typeof u === "number"),
                );
                return (
                  <div key={key} className="py-4 border-b border-border/60 last:border-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2.5">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        {title}
                      </div>
                      <div className="ml-auto">
                        <CostRatioBadge row={{ perAgent }} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {view.agents.map((a) => {
                        const p = perAgent.find((x) => x.id === a.id);
                        const best =
                          typeof p?.usd === "number" && p.usd === cheapest;
                        return (
                          <div key={a.id} className="flex items-center gap-3">
                            <span
                              className="w-28 shrink-0 font-mono text-xs font-bold"
                              style={{ color: agentColor(a.id) }}
                            >
                              {a.id}
                            </span>
                            <div className="flex-1 bg-muted h-2.5 rounded overflow-hidden border border-border">
                              {typeof p?.usd === "number" && (
                                <div
                                  className="h-full rounded-r transition-all duration-700 ease-out"
                                  style={{
                                    width: `${Math.max((p.usd / maxUsd) * 100, 1)}%`,
                                    backgroundColor: agentColor(a.id),
                                  }}
                                />
                              )}
                            </div>
                            <span
                              className={`w-32 shrink-0 text-right font-mono text-xs ${best ? "font-bold text-primary" : "text-foreground/80"}`}
                            >
                              {typeof p?.usd === "number" ? usd(p.usd) : "—"}
                              {p?.tokens != null && (
                                <span className="text-muted-foreground/50">
                                  {" "}
                                  ({tok(p.tokens)})
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              };
              return (
                <div>
                  {view.cost.perBug.map((row) =>
                    bugGroup(
                      row.instanceId,
                      <>
                        <span className="text-sm text-foreground/90 leading-snug">
                          {view.taskSet.titles?.[row.instanceId] ??
                            row.instanceId.replace(/^.*__/, "")}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground/50">
                          {row.instanceId.replace(/^.*__/, "")}
                        </span>
                      </>,
                      row.perAgent,
                    ),
                  )}
                  {bugGroup(
                    "mean",
                    <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground/60">
                      mean over {view.cost.perBug.length} bugs
                    </span>,
                    view.cost.perAgent.map((p) => ({
                      id: p.id,
                      usd: p.meanUsd,
                      tokens: p.meanTokens,
                    })),
                  )}
                </div>
              );
            })()}
          </div>
        )}

        <div className="rounded-md border border-border bg-card p-6 md:p-8">
          <h3 className="text-lg font-medium text-foreground">Per instance</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            One row per bug, one cell per trial. Disagreement between trials of
            the same agent is the interesting signal — it is what a single-run
            benchmark cannot show you.
            {view.isolationMix.mixed &&
              " Dashed cells ran on an open network, outside the container."}
          </p>
          <div className="space-y-3">
            {view.matrix.map((row) => (
              <div
                key={row.instanceId}
                className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 py-2.5 border-b border-border last:border-0"
              >
                <span className="font-mono text-xs md:w-56 shrink-0">
                  <span className="text-foreground/70">{row.instanceId}</span>
                  {!view.sharedInstances.includes(row.instanceId) && (
                    <span
                      className="ml-2 text-muted-foreground/50"
                      title="Not every agent ran this one, so it is excluded from the rates above."
                    >
                      partial
                    </span>
                  )}
                </span>
                <div className="flex flex-wrap gap-2">
                  {row.cells.map((cell) => (
                    <span
                      key={`${cell.agent}-${cell.trial}`}
                      title={`${cell.reason} · ${cell.patchBytes}B${cell.tokens !== undefined ? ` · ${tok(cell.tokens)} tok` : ""}${typeof cell.usd === "number" ? ` · ${usd(cell.usd)}` : ""}${cell.isolation ? ` · ${cell.isolation}` : ""}${cell.auditOk === false ? " · UNMETERED/LEAK" : ""}`}
                      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] ${
                        cell.ok
                          ? "border-border bg-muted text-foreground/80"
                          : "border-destructive/40 bg-destructive/5 text-destructive"
                      } ${view.isolationMix.mixed && cell.isolation !== "container" ? "border-dashed" : ""}`}
                    >
                      {cell.ok ? (
                        <Check className="h-3 w-3" aria-hidden />
                      ) : (
                        <Minus className="h-3 w-3" aria-hidden />
                      )}
                      <span style={cell.ok ? { color: agentColor(cell.agent) } : undefined}>
                        {cell.agent}
                      </span>
                      <span className="text-muted-foreground/60">
                        t{cell.trial} · {secs(cell.durationMs)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-6 md:p-8">
          <h3 className="text-lg font-medium text-foreground">
            What this does not tell you
          </h3>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            Published rather than managed. A benchmark whose limitations live in
            a footnote is an advertisement.
          </p>
          <div className="space-y-5">
            {view.caveats.map((c) => (
              <div key={c.title}>
                <h4 className="text-sm font-medium text-foreground">{c.title}</h4>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-6 md:p-8">
          <h3 className="text-lg font-medium text-foreground">How it ran</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            The whole pipeline, in order. Every step is the same for every
            agent — the moment one step differs per agent, the benchmark stops
            comparing harnesses and starts comparing our treatment of them.
          </p>
          <ol className="space-y-5">
            {[
              {
                title: "Pick the bugs",
                body: `${view.taskSet.instances.length} real ${view.taskSet.repo} issues from ${view.taskSet.name}, fetched from HuggingFace. The gold patch, the test patch, and the maintainer hints are stripped before anything touches disk — the answer key never enters this repo.`,
              },
              {
                title: "Build the workspace",
                body: "Each trial gets its own fresh checkout at the commit just before the real fix landed, cloned from a cached local mirror on a detached HEAD. No network clone in the timed path, nothing shared between trials.",
              },
              {
                title: "Give every agent the same prompt",
                body: "One string, identical for all agents: the upstream issue text, plus instructions not to touch tests and not to commit. The prompt lives in its own file so changing it reviews as what it is — a change to the experiment.",
              },
              {
                title: "Pin the model, max the autonomy",
                body: `Every agent runs ${view.model} on the same API key, each with its own full-autonomy flag (see Setup above). Running one agent at full autonomy against another at its default would measure permission defaults, not agents.`,
              },
              {
                title:
                  view.isolation === "container"
                    ? "Isolate each trial in Docker"
                    : "Isolation: not yet",
                body:
                  view.isolation === "container"
                    ? "Each trial runs in a container on an internal Docker network whose only exit is the metering proxy — the agent cannot look the fix up, and a fresh $HOME means nothing an agent learns carries into the next trial."
                    : "These trials ran without a container: open network, shared $HOME. That is exactly why the page marks them provisional.",
              },
              {
                title: "Meter everything through one proxy",
                body: "All model traffic passes through a single recording pass-through proxy. Tokens are counted by that one meter and priced from a committed rate card — the same accounting for every agent, never each vendor's own dashboard.",
              },
              {
                title: "Run the matrix, keep the diff",
                body: `agents × bugs × trials, ${Math.max(...view.matrix.flatMap((r) => r.cells.map((c) => c.trial)), 1)} trial${Math.max(...view.matrix.flatMap((r) => r.cells.map((c) => c.trial)), 1) === 1 ? "" : "s"} per bug here. When the agent exits, its working-tree diff is extracted as the patch — that diff is the entire submission.`,
              },
              {
                title: view.graded ? "Grade with the official harness" : "Grading: not yet",
                body: view.graded
                  ? "The official SWE-bench harness applies each patch in its own Docker environment and runs the project's real test suite. Only its verdict marks a trial resolved — 'produced a patch' is never promoted to 'fixed the bug'."
                  : "The official SWE-bench grader has not run on these trials, so nothing on this page says 'fixed' — only 'changed a file'.",
              },
              {
                title: "Publish the evidence",
                body: "Every trial writes its prompt, argv, patch, and stdout/stderr to the results directory, and the numbers land on this page by finishing. There is no editorial step between the run and what you are reading.",
              },
            ].map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="shrink-0 h-6 w-6 rounded-full border border-border bg-muted font-mono text-[11px] font-bold text-foreground/70 flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <h4 className="text-sm font-medium text-foreground">
                    {s.title}
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-md border border-border bg-card p-6 md:p-8">
          <h3 className="text-lg font-medium text-foreground">
            Check it yourself
          </h3>
          <p className="text-sm text-muted-foreground mt-1 mb-5 leading-relaxed">
            The harness, the agent adapters, and the task list are all in the
            repo. A run lands on this page by finishing — there is no editorial
            step between the numbers and you.
          </p>
          <pre className="rounded bg-muted border border-border p-4 font-mono text-xs text-foreground/80 overflow-x-auto">
            <code>pnpm bench:agents --agents freecode,claude-code --trials 3</code>
          </pre>
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            Every trial writes its full evidence — prompt, argv, patch,
            stdout/stderr — to{" "}
            <code className="font-mono">
              bench/agent-bench/results/&lt;run&gt;/
            </code>
            . The task set is SWE-bench Lite, fetched from HuggingFace with the
            answer key stripped before anything touches disk.
          </p>
        </div>
      </div>

      <footer className="mt-12 font-mono text-xs text-muted-foreground/60">
        Generated {new Date(view.generatedAt).toUTCString()} by{" "}
        <span className="text-foreground/70">pnpm bench:agents</span>. Method:{" "}
        <span className="text-foreground/70">
          docs/superpowers/specs/2026-09-03-agent-comparison-benchmark.md
        </span>
      </footer>
    </section>
  );
}

/**
 * "3.2× cheaper · 2.1× fewer tokens" (or pricier/more), freecode against the
 * cheapest rival on the row — the onesuperbrain-style verdict. Each half
 * renders only when both sides carry a real number, and anything within 5% is
 * called even rather than inventing a winner out of rounding.
 */
function CostRatioBadge({
  row,
}: {
  row: { perAgent: { id: string; usd: number | null; tokens?: number | null }[] };
}) {
  const free = row.perAgent.find((p) => p.id === "freecode");
  const rivals = row.perAgent.filter((p) => p.id !== "freecode");

  const verdict = (
    mine: number | null | undefined,
    theirs: number[],
    words: { win: string; lose: string },
  ) => {
    if (typeof mine !== "number" || mine <= 0 || theirs.length === 0) return null;
    const r = Math.min(...theirs) / mine;
    return Math.abs(r - 1) < 0.05
      ? {
          text: "even",
          cls: "bg-muted text-muted-foreground border-border",
        }
      : r > 1
        ? {
            text: `${r.toFixed(1)}× ${words.win}`,
            cls: "bg-primary/10 text-primary border-primary/30",
          }
        : {
            text: `${(1 / r).toFixed(1)}× ${words.lose}`,
            cls: "bg-destructive/10 text-destructive border-destructive/30",
          };
  };

  const nums = (xs: (number | null | undefined)[]) =>
    xs.filter((u): u is number => typeof u === "number");
  const badges = [
    verdict(free?.usd, nums(rivals.map((p) => p.usd)), {
      win: "cheaper",
      lose: "pricier",
    }),
    verdict(free?.tokens, nums(rivals.map((p) => p.tokens)), {
      win: "fewer tokens",
      lose: "more tokens",
    }),
  ].filter((b): b is NonNullable<typeof b> => b !== null);
  if (badges.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap justify-end gap-1.5">
      {badges.map((b) => (
        <span
          key={b.text}
          className={`inline-block rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold whitespace-nowrap ${b.cls}`}
        >
          {b.text}
        </span>
      ))}
    </span>
  );
}

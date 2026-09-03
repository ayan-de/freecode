"use client";

import { useState } from "react";
import { AlertTriangle, Check, Minus } from "lucide-react";
import type { BenchView } from "../data/agent-bench";
import { BenchBarList, type BenchBar } from "./BenchBarList";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(0)}s`;

export function AgentBenchmark({ views }: { views: BenchView[] }) {
  const [slug, setSlug] = useState(views[0]?.slug ?? "");
  const view = views.find((v) => v.slug === slug) ?? views[0];

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
  }));

  const slowest = Math.max(...view.agents.map((a) => a.medianMs), 1);
  const speedBars: BenchBar[] = view.agents.map((a) => ({
    label: a.id,
    value: a.medianMs,
    display: secs(a.medianMs),
    note: `median of ${a.trials}`,
    highlight: a.isFreeCode,
  }));

  const sizeBars: BenchBar[] = view.agents.map((a) => ({
    label: a.id,
    value: a.medianPatchBytes,
    display: `${Math.round(a.medianPatchBytes)}B`,
    note: `median of ${a.trials}`,
    highlight: a.isFreeCode,
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
  const headline =
    free && fastestRival && bestRival
      ? [
          {
            value: `${pct(free.rate)} vs ${pct(bestRival.rate)}`,
            tone: "text-foreground",
            label: view.metric.label.toLowerCase(),
            note: `freecode vs ${bestRival.id}, over ${view.sharedInstances.length} shared instance${view.sharedInstances.length === 1 ? "" : "s"}`,
          },
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
          {
            value: `${Math.round(free.medianPatchBytes)}B vs ${Math.round(fastestRival.medianPatchBytes)}B`,
            tone: "text-foreground",
            label: "median patch size",
            note: `freecode vs ${fastestRival.id} — style, not quality`,
          },
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
        {views.map((v) => {
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
          <dd className="inline text-foreground/80">{view.isolation}</dd>
        </div>
      </dl>

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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
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
                      className={`py-2.5 pr-4 ${a.isFreeCode ? "text-primary font-bold" : "text-foreground/80"}`}
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
                    className={`w-28 shrink-0 font-mono text-xs ${a.isFreeCode ? "text-primary font-bold" : "text-foreground/70"}`}
                  >
                    {a.id}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {cells.map((c) => (
                      <span
                        key={`${c.instanceId}-${c.trial}`}
                        title={`${c.instanceId} · t${c.trial} · ${secs(c.durationMs)} · ${c.reason}`}
                        className={`h-4 w-4 rounded-[3px] border ${
                          c.ok
                            ? a.isFreeCode
                              ? "bg-primary border-primary"
                              : "bg-foreground/70 border-foreground/70"
                            : "bg-destructive/10 border-destructive/60"
                        }`}
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
        />

        <BenchBarList
          id={`size-${view.slug}`}
          title="Median patch size"
          description="Bytes of diff produced. A fact about each harness's style, not a score — a bigger patch is not a better fix, and a smaller one is not automatically surgical."
          bars={sizeBars}
        />

        <div className="rounded-md border border-border bg-card p-6 md:p-8">
          <h3 className="text-lg font-medium text-foreground">Per instance</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            One row per bug, one cell per trial. Disagreement between trials of
            the same agent is the interesting signal — it is what a single-run
            benchmark cannot show you.
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
                      title={`${cell.reason} · ${cell.patchBytes}B`}
                      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] ${
                        cell.ok
                          ? "border-border bg-muted text-foreground/80"
                          : "border-destructive/40 bg-destructive/5 text-destructive"
                      }`}
                    >
                      {cell.ok ? (
                        <Check className="h-3 w-3" aria-hidden />
                      ) : (
                        <Minus className="h-3 w-3" aria-hidden />
                      )}
                      {cell.agent}
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

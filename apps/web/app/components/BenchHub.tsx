"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { agentColor } from "../data/agent-bench";
import type { OptView } from "../data/jcode-bench";
import type { SignalsReport } from "../data/harness-signals";
import { AutoPokeStats } from "./AutoPokeStats";
import { Benchmark } from "./Benchmark";
import { ConfidenceStepping } from "./ConfidenceStepping";
import { HillClimbHistogram } from "./HillClimbHistogram";
import { OptimizationBench } from "./OptimizationBench";
import { BenchSection, EmptyState, StatTiles, type StatTile } from "./StatTiles";

export interface MatchupSummary {
  slug: string;
  title: string;
  model: string;
  graded: boolean;
  isolation: "none" | "container";
  instances: number;
  metric: string;
  agents: {
    id: string;
    isFreeCode: boolean;
    rate: number;
    successes: number;
    trials: number;
    meanTokens?: number;
    meanUsd?: number | null;
  }[];
}

const SECTIONS = [
  { id: "resource-efficiency", label: "Resource efficiency" },
  { id: "agent-comparison", label: "Agent comparison" },
  { id: "optimization-task", label: "Optimization task" },
  { id: "confidence-stepping", label: "Confidence stepping" },
  { id: "hill-climbable-goals", label: "Hill-climbable goals" },
  { id: "auto-poke", label: "Auto-poke" },
];

const tok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;

export function BenchHub({
  opt,
  signals,
  matchups,
}: {
  opt: OptView;
  signals: SignalsReport;
  matchups: MatchupSummary[];
}) {
  return (
    <div className="w-full max-w-4xl mx-auto px-6 py-16 md:py-24">
      <header className="mb-10">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground/60 mb-3">
          Benchmarks
        </p>
        <h1 className="text-3xl md:text-4xl font-medium text-foreground tracking-tight">
          Every way we measure the agent
        </h1>
        <p className="text-lg text-muted-foreground mt-3 max-w-2xl leading-relaxed">
          Six instruments, each with its own harness, its own data file, and the command that
          produced it. Nothing here is curated by hand: a run appears on this page by being
          published, and a loss goes in the headline like a win.
        </p>
        <nav aria-label="Sections" className="mt-6 flex flex-wrap gap-2">
          {SECTIONS.map((s, i) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded border border-border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <span className="text-muted-foreground/40 mr-1.5">{String(i + 1).padStart(2, "0")}</span>
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      <BenchSection
        id="resource-efficiency"
        index={1}
        title="Resource efficiency"
        lede="The bottleneck to running many agents is what each one costs to keep alive. Resident memory of the whole process tree, and time to an input-ready frame, against the other CLIs on the same machine."
        command="pnpm bench:memory"
      >
        <Benchmark />
      </BenchSection>

      <BenchSection
        id="agent-comparison"
        index={2}
        title="Agent comparison"
        lede="Same bugs, same model, same key, one meter. freecode against other coding agents on SWE-bench Lite, graded by the official harness in Docker, with tokens and cost read off a recording proxy rather than four self-reports."
        command="pnpm bench:agents --isolate --trials 3 · bench:grade · bench:bundle"
      >
        {matchups.length === 0 ? (
          <EmptyState>No matchups published yet.</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {matchups.map((m) => {
              const free = m.agents.find((a) => a.isFreeCode);
              const rival = m.agents.find((a) => !a.isFreeCode);
              const provisional = !m.graded || m.isolation === "none";
              return (
                <div key={m.slug} className="rounded-md border border-border bg-card p-5 md:p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                    <h3 className="font-mono text-base font-medium text-foreground">{m.title}</h3>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {m.model} · {m.instances} instances · {m.graded ? "graded" : "ungraded"} ·{" "}
                      {m.isolation}
                      {provisional && <span className="text-destructive"> · provisional</span>}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {m.agents.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 font-mono text-xs">
                        <span className="w-28 shrink-0 font-bold" style={{ color: agentColor(a.id) }}>
                          {a.id}
                        </span>
                        <div className="flex-1 h-3 rounded bg-muted border border-border overflow-hidden">
                          <div
                            className="h-full"
                            style={{ width: `${Math.round(a.rate * 100)}%`, backgroundColor: agentColor(a.id) }}
                          />
                        </div>
                        <span className="w-40 shrink-0 text-right text-foreground/80 tabular-nums">
                          {Math.round(a.rate * 100)}% {m.metric.toLowerCase()} · {a.successes}/{a.trials}
                        </span>
                        <span className="hidden md:inline w-24 shrink-0 text-right text-muted-foreground tabular-nums">
                          {a.meanTokens !== undefined ? tok(a.meanTokens) : "unmetered"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {free && rival && free.meanTokens !== undefined && rival.meanTokens !== undefined && (
                    <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                      freecode used{" "}
                      <span className={free.meanTokens <= rival.meanTokens ? "text-primary" : "text-destructive"}>
                        {Math.abs(Math.round((1 - free.meanTokens / rival.meanTokens) * 100))}%{" "}
                        {free.meanTokens <= rival.meanTokens ? "fewer" : "more"}
                      </span>{" "}
                      tokens per trial than {rival.id}.
                    </p>
                  )}
                </div>
              );
            })}
            <Link
              href="/benchmark"
              className="inline-flex items-center gap-1 self-start font-mono text-xs text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              Full matrix, cost scatter, and every caveat <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </BenchSection>

      <BenchSection
        id="optimization-task"
        index={3}
        title="Optimization task"
        lede="An uncontaminatable benchmark: the agent is handed a working, tested primitive, an exhaustive verifier and a deterministic cost model, and told to make it faster. Score is doublings of improvement; time is recorded, never capped. The tasks are jcode bench v1, unmodified, so the numbers sit on the same axis as jcode's published runs."
        command="pnpm bench:jcode --agents freecode,claude-code"
      >
        <OptimizationBench view={opt} />
      </BenchSection>

      <BenchSection
        id="confidence-stepping"
        index={4}
        title="Confidence stepping"
        lede="The todo tool asks for a confidence score per item, at assignment and again at completion. A low number at assignment is signal; a jump straight to 100 at the end is a claim. When the gate is on, a spike sends the model back to verify instead of accepting it."
        command="pnpm bench:signals"
      >
        <ConfidenceStepping report={signals} />
      </BenchSection>

      <BenchSection
        id="hill-climbable-goals"
        index={5}
        title="Hill-climbable goals"
        lede="Agents are at their most capable with a metric to climb. Every goal is rated 0–100 for how measurable its progress is; below the gate, the harness asks for a reframe into something with a check to iterate against."
        command="pnpm bench:signals"
      >
        <HillClimbHistogram report={signals} />
      </BenchSection>

      <BenchSection
        id="auto-poke"
        index={6}
        title="Auto-poke"
        lede="Persistence is the other half of intelligence: most agent failures are early exits, not wrong answers. When a turn ends with todo items open, the loop can poke the model back to work — capped, and stopped the moment a poke changes nothing. Off by default until this page says it should not be."
        command="pnpm bench:signals · FREECODE_AUTO_POKE=1 to enable"
      >
        <AutoPokeStats report={signals} />
      </BenchSection>

      <footer className="border-t border-border pt-8 font-mono text-[11px] text-muted-foreground leading-relaxed">
        <StatTiles
          tiles={
            [
              { value: String(signals.sessionsScanned), label: "sessions scanned", note: "rollout logs folded for the signal sections" },
              { value: String(opt.runCount), label: "optimisation runs", note: opt.latest ? `latest ${opt.latest.slice(0, 10)}` : "none yet" },
              { value: String(matchups.length), label: "agent matchups", note: "on /benchmark" },
              {
                value: signals.window.to ? signals.window.to.slice(0, 10) : null,
                label: "signals as of",
                note: signals.window.from ? `since ${signals.window.from.slice(0, 10)}` : undefined,
              },
            ] satisfies StatTile[]
          }
        />
        Every harness lives under <code>bench/</code>; the operator reference is{" "}
        <code>HARNESS-BENCH.md</code> at the repo root. The design and its debts are in the spec{" "}
        <code>docs/superpowers/specs/2026-09-12-harness-bench.md</code>.
      </footer>
    </div>
  );
}

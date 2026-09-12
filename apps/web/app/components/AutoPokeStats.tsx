"use client";

import type { SignalsReport } from "../data/harness-signals";
import { BenchBarList, type BenchBar } from "./BenchBarList";
import { EmptyState, StatTiles, type StatTile } from "./StatTiles";

// Persistence, measured. The baseline is measurable on every session ever
// recorded: did the last todo list still have open items when the run ended?
// Then, for sessions where the gate was on: how often it poked, whether a poke
// was followed by work, and what a poke closed.

const pct = (n: number | null) => (n === null ? null : `${Math.round(n * 100)}%`);

export function AutoPokeStats({ report }: { report: SignalsReport }) {
  const a = report.autoPoke;
  if (a.sessionsWithTodos === 0) {
    return (
      <EmptyState>
        No sessions with a todo list recorded yet.{" "}
        <code className="font-mono">pnpm bench:signals</code> reads every session&apos;s rollout log
        and reports how many ended with open items — the early-exit baseline — and what auto-poke
        did about it where it was on.
      </EmptyState>
    );
  }

  const on = a.endedOpenByGate.on;
  const off = a.endedOpenByGate.off;
  const rate = (x: { n: number; open: number }) => (x.n ? x.open / x.n : null);
  const tiles: StatTile[] = [
    {
      value: pct(a.endedOpenRate),
      label: "ended with open todos",
      note: `${a.sessionsEndedOpen} of ${a.sessionsWithTodos} sessions with a list`,
      tone: (a.endedOpenRate ?? 0) > 0.3 ? "text-destructive" : "text-foreground",
    },
    {
      value: String(a.pokes),
      label: "pokes fired",
      note:
        a.gatedSessions > 0
          ? `across ${a.gatedSessions} session${a.gatedSessions === 1 ? "" : "s"} with the gate on`
          : "gate off in every session so far",
    },
    {
      value: pct(a.productiveRate),
      label: "pokes followed by work",
      note: a.pokes ? `${a.productive} of ${a.pokes} led to at least one tool call` : "no pokes yet",
      tone: (a.productiveRate ?? 0) >= 0.5 ? "text-primary" : "text-foreground",
    },
    {
      value: a.pokes ? String(a.itemsCompletedAfterPoke) : null,
      label: "items closed after a poke",
      note: "todo items completed on a later call",
    },
  ];

  const compare: BenchBar[] = [
    {
      label: "gate off",
      value: rate(off) ?? 0,
      display: pct(rate(off)) ?? "—",
      note: `${off.open}/${off.n} ended open`,
    },
    {
      label: "gate on",
      value: rate(on) ?? 0,
      display: on.n ? (pct(rate(on)) ?? "—") : "no data",
      note: on.n ? `${on.open}/${on.n} ended open` : "enable FREECODE_AUTO_POKE=1",
      highlight: true,
    },
  ];

  const skips = Object.entries(a.skipped).sort((x, y) => y[1] - x[1]);
  const skipBars: BenchBar[] = skips.map(([reason, n]) => ({
    label: reason.replaceAll("_", " "),
    value: n,
    display: String(n),
    note:
      reason === "disabled"
        ? "gate was off"
        : reason === "nothing_open"
          ? "list already complete"
          : reason === "no_progress"
            ? "list unchanged since last poke — stopped"
            : reason === "cap_reached"
              ? "per-run cap hit"
              : "",
  }));

  return (
    <div className="flex flex-col gap-8">
      <StatTiles tiles={tiles} />
      <BenchBarList
        id="poke-compare"
        title="Sessions that ended with open todos"
        description="Lower is better. The same measure on sessions where auto-poke was off and where it was on — the before/after the default flip waits on."
        bars={compare}
        footnote="A session counts as 'gate on' when a poke fired or the loop recorded a skip reason other than disabled. Sessions from before the gate existed count as off — that is the baseline."
      />
      {skipBars.length > 0 && (
        <BenchBarList
          id="poke-skips"
          title="Why the loop did not poke"
          description="Every stop with a todo list present is recorded, poked or not."
          bars={skipBars}
        />
      )}
    </div>
  );
}

// Written by `pnpm bench:jcode` (bench/jcode-bench/runner/publish.ts) into
// app/data/jcode-bench/<task>.json, one file per task. The harness owns the
// numbers, this module owns the view model, the components own the pixels —
// same split as agent-bench.ts.

export interface CurvePoint {
  t: number;
  score: number;
  best: number;
  fullGate: boolean;
}

export interface RawOptRun {
  runId: string;
  trial: number;
  agent: string;
  agentVersion: string;
  model: string;
  autonomy: string;
  harnessFlags: Record<string, string>;
  upstreamCommit: string;
  date: string;
  best: number | null;
  bestAt: number | null;
  final: number | null;
  finalFullGate: boolean;
  grades: number;
  activeMs: number;
  durationMs: number;
  timedOut: boolean;
  curve: CurvePoint[];
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  usd?: number | null;
  auditOk?: boolean;
}

export interface RawOptTask {
  task: string;
  oneLiner: string;
  generatedAt: string;
  runs: RawOptRun[];
}

/** One leaderboard row: a run, ranked by the score that counts. */
export interface OptRow {
  key: string;
  rank: number | null;
  agent: string;
  isFreeCode: boolean;
  /** Model with the provider prefix stripped, so two spellings of one pin agree. */
  model: string;
  agentVersion: string;
  /** Which gates were on — "auto-poke", "confidence gate", … — for the label. */
  gates: string[];
  best: number | null;
  final: number | null;
  /** 2^final, the "x faster" a reader wants. */
  speedup: number | null;
  verified: boolean;
  fullGate: boolean;
  grades: number;
  activeMs: number;
  timedOut: boolean;
  date: string;
  curve: CurvePoint[];
  tokens?: number;
  usd?: number | null;
}

export interface OptTaskView {
  task: string;
  oneLiner: string;
  rows: OptRow[];
  /** Longest active time across rows — the chart's x extent. */
  maxActiveMs: number;
  maxBest: number;
  /** freecode's best verified final against the best verified rival's. */
  headline?: { free: OptRow; rival?: OptRow };
}

export interface OptView {
  tasks: OptTaskView[];
  /** Runs published, across tasks. */
  runCount: number;
  latest: string | null;
  /**
   * jcode's aggregate: the geometric mean of one harness/model's task scores,
   * only when it has a verified final on EVERY task. Mixed task sets would let
   * the widest task dominate, which is the reason the geomean exists.
   */
  aggregate: { agent: string; isFreeCode: boolean; model: string; geomean: number; tasks: number }[];
}

const GATE_LABELS: Record<string, string> = {
  FREECODE_AUTO_POKE: "auto-poke",
  FREECODE_CONFIDENCE_GATE: "confidence gate",
  FREECODE_HILLCLIMB_GATE: "hill-climb gate",
};

export function gateLabels(flags: Record<string, string>): string[] {
  return Object.entries(flags)
    .filter(([k, v]) => GATE_LABELS[k] && ["1", "true", "yes"].includes(v.toLowerCase()))
    .map(([k]) => GATE_LABELS[k]!);
}

const shortModel = (m: string) => m.split("/").pop() ?? m;

export function deriveOptView(raw: RawOptTask[]): OptView {
  const tasks: OptTaskView[] = raw
    .map((t) => {
      const rows: OptRow[] = t.runs.map((r) => ({
        key: `${r.runId}|${r.agent}|${r.trial}`,
        rank: null,
        agent: r.agent,
        isFreeCode: r.agent === "freecode",
        model: shortModel(r.model),
        agentVersion: r.agentVersion,
        gates: gateLabels(r.harnessFlags ?? {}),
        best: r.best,
        final: r.final,
        speedup: r.final === null ? null : 2 ** r.final,
        verified: r.final !== null,
        fullGate: r.finalFullGate,
        grades: r.grades,
        activeMs: r.activeMs,
        timedOut: r.timedOut,
        date: r.date,
        curve: r.curve,
        ...(r.inputTokens !== undefined
          ? { tokens: r.inputTokens + (r.outputTokens ?? 0) }
          : {}),
        ...(r.usd !== undefined ? { usd: r.usd } : {}),
      }));
      // Verified runs rank by final, best first; unverified runs sit below
      // them unranked — a wrong submission has no score, whatever it sampled.
      rows.sort((a, b) => {
        if (a.verified !== b.verified) return a.verified ? -1 : 1;
        return (b.final ?? -Infinity) - (a.final ?? -Infinity) || b.date.localeCompare(a.date);
      });
      let rank = 0;
      for (const r of rows) r.rank = r.verified ? ++rank : null;

      const free = rows.find((r) => r.isFreeCode && r.verified);
      const rival = rows.find((r) => !r.isFreeCode && r.verified);
      return {
        task: t.task,
        oneLiner: t.oneLiner,
        rows,
        maxActiveMs: Math.max(...rows.map((r) => r.activeMs), 1),
        maxBest: Math.max(...rows.map((r) => r.best ?? 0), 0.5),
        ...(free ? { headline: { free, rival } } : {}),
      };
    })
    .sort((a, b) => a.task.localeCompare(b.task));

  // Aggregate: per (agent, model), best verified final on each task; geomean
  // only over harnesses that have every task.
  const byKey = new Map<string, { agent: string; model: string; finals: Map<string, number> }>();
  for (const t of tasks) {
    for (const r of t.rows) {
      if (!r.verified || r.final === null) continue;
      const k = `${r.agent}|${r.model}`;
      const e = byKey.get(k) ?? { agent: r.agent, model: r.model, finals: new Map() };
      e.finals.set(t.task, Math.max(e.finals.get(t.task) ?? -Infinity, r.final));
      byKey.set(k, e);
    }
  }
  const aggregate = [...byKey.values()]
    .filter((e) => e.finals.size === tasks.length && tasks.length > 0)
    .map((e) => {
      const scores = [...e.finals.values()];
      // A negative score has no geometric mean; clamp at zero (no improvement)
      // rather than let one regression poison the product with a NaN.
      const geomean = Math.exp(
        scores.reduce((s, x) => s + Math.log(Math.max(x, 1e-9)), 0) / scores.length,
      );
      return {
        agent: e.agent,
        isFreeCode: e.agent === "freecode",
        model: e.model,
        geomean: scores.some((x) => x <= 0) ? 0 : geomean,
        tasks: scores.length,
      };
    })
    .sort((a, b) => b.geomean - a.geomean);

  const dates = raw.flatMap((t) => t.runs.map((r) => r.date)).sort();
  return {
    tasks,
    runCount: raw.reduce((n, t) => n + t.runs.length, 0),
    latest: dates.length ? dates[dates.length - 1]! : null,
    aggregate,
  };
}

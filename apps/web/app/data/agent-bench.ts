// Written by `pnpm bench:agents` (bench/agent-bench/runner/publish.ts) into
// app/data/benchmarks/<matchup>.json, one file per agent set. Same arrangement
// as benchmark.ts and results-1.json: the harness owns the numbers, this module
// owns the view model, the components own the pixels.
//
// Nothing is imported at module scope here — /benchmark reads the directory at
// build time, so adding a matchup is adding a file, not editing an import list.

export interface RawAgent {
  id: string;
  version: string;
  model: string;
  autonomy: string;
}

export interface RawResult {
  agent: string;
  instanceId: string;
  trial: number;
  producedPatch: boolean;
  resolved: boolean | null;
  /** Per-row isolation; absent on legacy rows. */
  isolation?: "none" | "container";
  durationMs: number;
  patchBytes: number;
  newFiles: number;
  reason: string;
  runId: string;
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  usd?: number | null;
  auditOk?: boolean;
}

export interface RawBenchmark {
  slug: string;
  runId: string;
  generatedAt: string;
  runs: { runId: string; generatedAt: string; agents: string[] }[];
  phase: number;
  isolation: "none" | "container";
  graded: boolean;
  taskSet: { name: string; repo: string; instances: string[] };
  agents: RawAgent[];
  results: RawResult[];
}

export interface AgentSummary {
  id: string;
  isFreeCode: boolean;
  version: string;
  model: string;
  autonomy: string;
  trials: number;
  successes: number;
  rate: number;
  medianMs: number;
  medianPatchBytes: number;
  /** Trials the recording proxy actually saw. 0 ⇒ this agent is unmetered. */
  meteredTrials: number;
  /** Mean input+output tokens per metered trial (shared instances). */
  meanTokens?: number;
  /** Mean USD per metered trial; null when the model is unpriced. */
  meanUsd?: number | null;
  /** Max USD on a single metered trial — the runaway the mean hides (§7). */
  worstUsd?: number;
  meanTurns?: number;
}

export interface MatrixCell {
  agent: string;
  ok: boolean;
  durationMs: number;
  patchBytes: number;
  reason: string;
  trial: number;
  tokens?: number;
  usd?: number | null;
  auditOk?: boolean;
}

/**
 * Spec §7.2: cost compared only on instances every agent RESOLVED — averaging
 * over failures makes the quitter cheapest. Graded matchups only; suppressed
 * (numbers withheld) when fewer than 3 shared resolved instances exist,
 * because two shared instances is an anecdote wearing a decimal point.
 */
export interface CostComparison {
  instances: string[];
  suppressed: boolean;
  perAgent: {
    id: string;
    isFreeCode: boolean;
    meanUsd: number | null;
    meanTokens: number | null;
  }[];
  /** One row per solved-by-all instance; mean USD/tokens per agent on it. */
  perBug: {
    instanceId: string;
    perAgent: { id: string; usd: number | null; tokens: number | null }[];
  }[];
}

/** One metered trial as a scatter point: which agent, which bug, what it cost. */
export interface CostPoint {
  agent: string;
  isFreeCode: boolean;
  instanceId: string;
  usd: number;
  resolved: boolean | null;
}

export interface BenchView {
  slug: string;
  /** Tab label — "freecode vs claude-code". */
  title: string;
  runId: string;
  generatedAt: string;
  runs: RawBenchmark["runs"];
  phase: number;
  isolation: "none" | "container";
  graded: boolean;
  taskSet: RawBenchmark["taskSet"];
  metric: { label: string; help: string };
  agents: AgentSummary[];
  sharedInstances: string[];
  ragged: boolean;
  matrix: { instanceId: string; cells: MatrixCell[] }[];
  /** §7.2 cost table. Undefined until the matchup is graded. */
  cost?: CostComparison;
  /** Every metered trial as a point, for the cost-distribution scatter. */
  costPoints: CostPoint[];
  /** freecode's token saving vs the best rival, when both are metered. */
  tokenEdge?: { rivalId: string; freeTokens: number; rivalTokens: number; pctFewer: number };
  caveats: { title: string; body: string }[];
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;

const totalTokens = (r: RawResult) =>
  r.inputTokens !== undefined ? r.inputTokens + (r.outputTokens ?? 0) : undefined;

export function deriveView(raw: RawBenchmark): BenchView {
  const { results } = raw;

  /**
   * What the headline bar means, which changes the moment the grader lands.
   * Phase 0 can only say "the agent changed something" — calling that a pass
   * would be the single most misleading thing this page could do.
   */
  const metric = raw.graded
    ? {
        label: "Resolved",
        help: "Marked resolved by the official SWE-bench grader.",
      }
    : {
        label: "Produced a patch",
        help: "Only that the agent changed something. NOT that it fixed the bug — nothing here has been graded.",
      };

  /**
   * Instances every agent in this matchup actually attempted. Rates are
   * reported over this set and nothing else: averaging each agent over its own
   * private list of bugs compares nothing. Same intersection rule the spec
   * applies to cost (§7.2), for the same reason.
   */
  const sharedInstances = raw.taskSet.instances.filter((id) =>
    raw.agents.every((a) =>
      results.some((r) => r.agent === a.id && r.instanceId === id),
    ),
  );
  const ragged = sharedInstances.length < raw.taskSet.instances.length;

  const agents: AgentSummary[] = raw.agents.map((a) => {
    const mine = results.filter(
      (r) => r.agent === a.id && sharedInstances.includes(r.instanceId),
    );
    const successes = mine.filter((r) =>
      raw.graded ? r.resolved === true : r.producedPatch,
    ).length;
    // Metered means the proxy saw model calls — a trial where the agent
    // talked around the proxy still writes zeros, and zeros are not a $0 run.
    const metered = mine.filter((r) => (r.turns ?? 0) > 0);
    const usds = metered.map((r) => r.usd).filter((u): u is number => typeof u === "number");
    return {
      id: a.id,
      isFreeCode: a.id === "freecode",
      version: a.version,
      model: a.model,
      autonomy: a.autonomy,
      trials: mine.length,
      successes,
      rate: mine.length ? successes / mine.length : 0,
      medianMs: median(mine.map((r) => r.durationMs)),
      medianPatchBytes: median(mine.map((r) => r.patchBytes)),
      meteredTrials: metered.length,
      meanTokens: mean(metered.map((r) => totalTokens(r)!)),
      // Metered but unpriced (no rate-card row) is null, not absent — the
      // distinction between "we didn't measure" and "we can't price".
      meanUsd: metered.length ? (usds.length ? mean(usds)! : null) : undefined,
      worstUsd: usds.length ? Math.max(...usds) : undefined,
      meanTurns: mean(metered.map((r) => r.turns ?? 0)),
    };
  });

  const matrix = raw.taskSet.instances.map((instanceId) => ({
    instanceId,
    cells: results
      .filter((r) => r.instanceId === instanceId)
      // Stable display order: freecode first (it is the constant in every
      // matchup), then alphabetical, then trial — merged files interleave runs.
      .sort(
        (x, y) =>
          Number(y.agent === "freecode") - Number(x.agent === "freecode") ||
          x.agent.localeCompare(y.agent) ||
          x.trial - y.trial,
      )
      .map((r) => ({
        agent: r.agent,
        ok: raw.graded ? r.resolved === true : r.producedPatch,
        durationMs: r.durationMs,
        patchBytes: r.patchBytes,
        reason: r.reason,
        trial: r.trial,
        tokens: (r.turns ?? 0) > 0 ? totalTokens(r) : undefined,
        usd: (r.turns ?? 0) > 0 ? r.usd : undefined,
        auditOk: r.auditOk,
      })),
  }));

  /**
   * §7.2, executed: cost is compared only on instances every agent resolved
   * at least once, and suppressed entirely below 3 such instances. Only a
   * graded matchup can have this table at all.
   */
  let cost: CostComparison | undefined;
  if (raw.graded) {
    const solvedByAll = sharedInstances.filter((id) =>
      raw.agents.every((a) =>
        results.some((r) => r.agent === a.id && r.instanceId === id && r.resolved === true),
      ),
    );
    cost = {
      instances: solvedByAll,
      suppressed: solvedByAll.length < 3,
      perAgent: raw.agents.map((a) => {
        const mine = results.filter(
          (r) =>
            r.agent === a.id &&
            solvedByAll.includes(r.instanceId) &&
            r.resolved === true &&
            (r.turns ?? 0) > 0,
        );
        const usds = mine.map((r) => r.usd).filter((u): u is number => typeof u === "number");
        return {
          id: a.id,
          isFreeCode: a.id === "freecode",
          meanUsd: usds.length ? mean(usds)! : null,
          meanTokens: mine.length ? mean(mine.map((r) => totalTokens(r)!))! : null,
        };
      }),
      // Per-bug rows: on each solved-by-all instance, each agent's mean cost
      // and tokens over its resolved trials of that bug.
      perBug: solvedByAll.map((instanceId) => ({
        instanceId,
        perAgent: raw.agents.map((a) => {
          const mine = results.filter(
            (r) =>
              r.agent === a.id &&
              r.instanceId === instanceId &&
              r.resolved === true &&
              (r.turns ?? 0) > 0,
          );
          const usds = mine.map((r) => r.usd).filter((u): u is number => typeof u === "number");
          return {
            id: a.id,
            usd: usds.length ? mean(usds)! : null,
            tokens: mine.length ? mean(mine.map((r) => totalTokens(r)!))! : null,
          };
        }),
      })),
    };
  }

  // Every metered, priced trial as a scatter point (all shared instances, not
  // just solved-by-all): the shape of the cost distribution, before averaging.
  const costPoints: CostPoint[] = results
    .filter(
      (r) =>
        sharedInstances.includes(r.instanceId) &&
        (r.turns ?? 0) > 0 &&
        typeof r.usd === "number",
    )
    .map((r) => ({
      agent: r.agent,
      isFreeCode: r.agent === "freecode",
      instanceId: r.instanceId,
      usd: r.usd as number,
      resolved: r.resolved,
    }));

  // freecode's token edge vs the best (fewest-token) metered rival — the
  // "N% fewer tokens" headline, stated only when both sides are metered.
  const freeSummary = agents.find((a) => a.isFreeCode);
  const meteredRivals = agents.filter(
    (a) => !a.isFreeCode && a.meanTokens !== undefined,
  );
  let tokenEdge: BenchView["tokenEdge"];
  if (freeSummary?.meanTokens !== undefined && meteredRivals.length) {
    const rival = meteredRivals.reduce((m, a) =>
      a.meanTokens! < m.meanTokens! ? a : m,
    );
    tokenEdge = {
      rivalId: rival.id,
      freeTokens: freeSummary.meanTokens,
      rivalTokens: rival.meanTokens!,
      pctFewer: Math.round((1 - freeSummary.meanTokens / rival.meanTokens!) * 100),
    };
  }

  /**
   * Everything not yet true about this matchup, in the page's own words. Spec
   * §9 wants the caveats on the page rather than in a footnote and §10 wants
   * them published rather than managed; deriving them from the data is what
   * stops them drifting out of date once a phase lands.
   */
  const caveats = [
    ...(raw.graded
      ? []
      : [
          {
            title: "Nothing here has been graded",
            body: "The bars show whether an agent changed a file, not whether it fixed the bug. The official SWE-bench grader runs in Docker and is not wired up yet, so no number on this page is a result.",
          },
        ]),
    ...(raw.isolation === "none"
      ? [
          {
            title: "No isolation",
            body: "Trials run without a container: the network is open, so an agent could in principle look the fix up, and $HOME is shared, so an agent's own memory carries between trials. Both are corrected by the container step.",
          },
        ]
      : []),
    ...(agents.some((a) => a.trials > 0 && a.meteredTrials < a.trials)
      ? [
          {
            title: "Not every trial was metered",
            body: `Token and cost figures cover only trials the recording proxy saw (${agents
              .map((a) => `${a.id}: ${a.meteredTrials}/${a.trials}`)
              .join(", ")}). An agent that ignores the proxy env vars is unmetered until the container forces its egress through the proxy — comparing its cost column would compare a measurement to a blank.`,
          },
        ]
      : []),
    ...(raw.runs.length > 1
      ? [
          {
            title: `Stitched together from ${raw.runs.length} runs of this matchup`,
            body: "Rows were measured at different times against a moving endpoint. The same agent on the same bug has varied several-fold between runs of this benchmark — a spread wider than most gaps between agents here. Trust the shape, not the decimals; a clean comparison is one run with several trials.",
          },
        ]
      : []),
    ...(ragged
      ? [
          {
            title: "Agents did not all attempt the same bugs",
            body: `Rates cover only the ${sharedInstances.length} instance${sharedInstances.length === 1 ? "" : "s"} every agent here ran. Rows outside that set are marked partial below.`,
          },
        ]
      : []),
    {
      title: `${raw.taskSet.instances.length} instance${raw.taskSet.instances.length === 1 ? "" : "s"} is a demo, not a leaderboard`,
      body: "SWE-bench Lite is 300 instances across 11 repositories. One repository's idioms are not the field, and a handful of instances from it is an anecdote with decimal places.",
    },
    {
      title: "Contamination is unfixable on this task set",
      body: "Every SWE-bench Lite fix is public and predates the training cutoff of the models involved. Closing the network stops lookup, not recall. That is survivable for a relative comparison — every agent gets the same unfair advantage — but it invalidates any absolute reading.",
    },
    {
      title: "This compares harnesses, not models",
      body: `Every agent is pinned to the same model (${raw.agents[0]?.model ?? "—"}) on the same key, and each keeps its own system prompt. Change the model and it becomes a different experiment with the same table.`,
    },
    {
      title: "We built the harness and we are in the table",
      body: "Every incentive here points one way. The countermeasures are structural: the task set is external, the grader is external, the artifacts are published, and a loss goes in the headline.",
    },
  ];

  return {
    slug: raw.slug,
    title: raw.slug.replaceAll("-vs-", " vs "),
    runId: raw.runId,
    generatedAt: raw.generatedAt,
    runs: raw.runs,
    phase: raw.phase,
    isolation: raw.isolation,
    graded: raw.graded,
    taskSet: raw.taskSet,
    metric,
    agents,
    sharedInstances,
    ragged,
    matrix,
    cost,
    costPoints,
    tokenEdge,
    caveats,
  };
}

import raw from "./agent-bench.json";

// Written by `pnpm bench:agents` (bench/agent-bench/runner/publish.ts) at the
// end of every run. Same arrangement as benchmark.ts and results-1.json: the
// harness owns the numbers, this module owns the view model, the components
// own the pixels.

interface RawResult {
  agent: string;
  instanceId: string;
  trial: number;
  producedPatch: boolean;
  resolved: boolean | null;
  durationMs: number;
  patchBytes: number;
  newFiles: number;
  reason: string;
}

export const run = {
  runId: raw.runId,
  generatedAt: raw.generatedAt,
  phase: raw.phase,
  isolation: raw.isolation as "none" | "container",
  graded: raw.graded,
  taskSet: raw.taskSet,
};

/** Every run contributing a row, newest first. */
export const runs = raw.runs as {
  runId: string;
  generatedAt: string;
  agents: string[];
}[];

/**
 * What the headline bar means, which changes the moment the grader lands.
 * Phase 0 can only say "the agent changed something" — calling that a pass
 * would be the single most misleading thing this page could do.
 */
export const metric = run.graded
  ? { label: "Resolved", help: "Marked resolved by the official SWE-bench grader." }
  : {
      label: "Produced a patch",
      help: "Only that the agent changed something. NOT that it fixed the bug — nothing here has been graded.",
    };

const results = raw.results as RawResult[];

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

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
}

/**
 * Instances every agent actually attempted.
 *
 * The page reports rates over this set and nothing else. Agents accumulate
 * across runs, so the raw matrix goes ragged the moment you run two agents on
 * one bug and two different agents on another — and a rate averaged over each
 * agent's own private instance list compares nothing. This is the same
 * intersection rule the spec applies to cost (§7.2), for the same reason.
 */
export const sharedInstances: string[] = (
  raw.taskSet.instances as string[]
).filter((id) =>
  raw.agents.every((a) =>
    results.some((r) => r.agent === a.id && r.instanceId === id),
  ),
);

/** True when some agent skipped an instance another one ran. */
export const ragged = sharedInstances.length < run.taskSet.instances.length;

export const agents: AgentSummary[] = raw.agents.map((a) => {
  // Shared instances only — see sharedInstances above.
  const mine = results.filter(
    (r) => r.agent === a.id && sharedInstances.includes(r.instanceId),
  );
  const successes = mine.filter((r) =>
    run.graded ? r.resolved === true : r.producedPatch,
  ).length;
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
  };
});

export interface MatrixCell {
  agent: string;
  ok: boolean;
  durationMs: number;
  patchBytes: number;
  reason: string;
  trial: number;
}

export const matrix: { instanceId: string; cells: MatrixCell[] }[] =
  run.taskSet.instances.map((instanceId) => ({
    instanceId,
    cells: results
      .filter((r) => r.instanceId === instanceId)
      .map((r) => ({
        agent: r.agent,
        ok: run.graded ? r.resolved === true : r.producedPatch,
        durationMs: r.durationMs,
        patchBytes: r.patchBytes,
        reason: r.reason,
        trial: r.trial,
      })),
  }));

/**
 * Everything that is not yet true about this run, in the page's own words.
 *
 * Spec §9 requires the caveats on the page rather than in a footnote, and §10
 * requires them published rather than managed. They are derived from the data
 * so they cannot drift out of date once a phase lands.
 */
export const caveats: { title: string; body: string }[] = [
  ...(runs.length > 1
    ? [
        {
          title: `Stitched together from ${runs.length} separate runs`,
          body: "Rows were measured at different times against a moving endpoint, so this table answers 'which agents have I tried' — not 'which agent is better'. The same freecode trial on django__django-11039 took 11s, 29s and 52s across three runs; that spread is larger than most gaps between agents here. A real comparison interleaves its variants inside one run.",
        },
      ]
    : []),
  ...(ragged
    ? [
        {
          title: "Agents did not all attempt the same bugs",
          body: `Rates above cover only the ${sharedInstances.length} instance${sharedInstances.length === 1 ? "" : "s"} every agent actually ran. Anything else would average each agent over its own private list of bugs, which compares nothing. Run the full matrix to widen it.`,
        },
      ]
    : []),
  ...(run.graded
    ? []
    : [
        {
          title: "Nothing here has been graded",
          body: "The bars show whether an agent changed a file, not whether it fixed the bug. The official SWE-bench grader runs in Docker and is not wired up yet, so no number on this page is a result.",
        },
      ]),
  ...(run.isolation === "none"
    ? [
        {
          title: "No isolation",
          body: "Trials run without a container: the network is open, so an agent could in principle look the fix up, and $HOME is shared, so freecode's own memory carries between trials. Both are corrected by the container step.",
        },
      ]
    : []),
  {
    title: `${run.taskSet.instances.length} instance${run.taskSet.instances.length === 1 ? "" : "s"} is a demo, not a leaderboard`,
    body: "SWE-bench Lite is 300 instances across 11 repositories. One repository's idioms are not the field, and a handful of instances from it is an anecdote with decimal places.",
  },
  {
    title: "Contamination is unfixable on this task set",
    body: "Every SWE-bench Lite fix is public and predates the training cutoff of the models involved. Closing the network stops lookup, not recall. That is survivable for a relative comparison — both agents get the same unfair advantage — but it invalidates any absolute reading.",
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

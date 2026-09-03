// =============================================================================
// Publish — accumulate runs into the file the /benchmark page reads.
//
// `results/` is git-ignored (transcripts, container logs), so the page cannot
// read it: on a deploy the directory does not exist. Same shape as
// `pnpm bench:memory`, which has always written straight into
// apps/web/app/data/. One committed, diffable JSON per axis.
//
// What is dropped: transcripts, patches, argv, prompts. What is kept: the
// numbers, and every disclosure §9 requires the page to print — agent version,
// pinned model, autonomy flag, isolation, and whether anything was graded.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import type { Report } from "./types.js";

const BENCH_DIR = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "apps",
  "web",
  "app",
  "data",
  "benchmarks",
);

/**
 * One file per matchup, named for the agents in it.
 *
 * A matchup is the unit of valid comparison: freecode vs opencode measured in
 * one run is evidence, and freecode vs claude-code measured an hour later is
 * separate evidence. Keeping them in separate files makes "do not stitch
 * unrelated runs together" structural instead of a caveat somebody has to read.
 *
 * freecode leads when present because it is the constant in every matchup;
 * everything else is alphabetical, so the same agent set always resolves to the
 * same file no matter what order it was passed on the command line.
 */
export function matchupSlug(agentIds: string[]): string {
  const rest = [...new Set(agentIds)].filter((a) => a !== "freecode").sort();
  const ordered = agentIds.includes("freecode") ? ["freecode", ...rest] : rest;
  return ordered.join("-vs-");
}

export interface PublishedAgent {
  id: string;
  version: string;
  model: string;
  autonomy: string;
}

export interface PublishedResult {
  agent: string;
  instanceId: string;
  trial: number;
  producedPatch: boolean;
  /** null until `graded` — "produced a patch" is not "fixed the bug". */
  resolved: boolean | null;
  durationMs: number;
  patchBytes: number;
  newFiles: number;
  reason: string;
  /** Which run this row came from. See the `runs` note below. */
  runId: string;
}

export interface PublishedRun {
  /** Matchup id, and the file's own name. See matchupSlug. */
  slug: string;
  generatedAt: string;
  /** Most recent run folded in. */
  runId: string;
  /**
   * Every run contributing a row, newest first.
   *
   * The page prints this whenever there is more than one, because rows from
   * different runs were measured at different times against a moving endpoint.
   * That is fine for "which agents have I tried" and NOT fine as evidence that
   * one agent beat another — the same freecode trial on django__django-11039
   * took 11s, 29s and 52s across three runs. A real comparison interleaves its
   * variants in one run; this file only stitches them together for display.
   */
  runs: { runId: string; generatedAt: string; agents: string[] }[];
  /** Which phase of the spec produced this. The page refuses to dress up 0. */
  phase: number;
  isolation: "none" | "container";
  /** False until the official SWE-bench grader runs (Phase 1). */
  graded: boolean;
  taskSet: { name: string; repo: string; instances: string[] };
  agents: PublishedAgent[];
  results: PublishedResult[];
}

const key = (r: { agent: string; instanceId: string; trial: number }) =>
  `${r.agent}|${r.instanceId}|${r.trial}`;

function readExisting(file: string): PublishedRun | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const prev = JSON.parse(fs.readFileSync(file, "utf-8")) as PublishedRun;
    // Pre-merge files have no `runs`; adopt them rather than discarding, so an
    // upgrade does not silently throw away the numbers already on the page.
    if (!Array.isArray(prev.runs)) {
      prev.runs = [
        { runId: prev.runId, generatedAt: prev.generatedAt, agents: prev.agents.map((a) => a.id) },
      ];
      prev.results = prev.results.map((r) => ({ ...r, runId: r.runId ?? prev.runId }));
    }
    return prev;
  } catch {
    return undefined;
  }
}

/**
 * Folds `report` into whatever the page is already showing.
 *
 * Merging rather than replacing is the whole point: running
 * `--agents freecode,opencode` and then `--agents freecode,claude-code` used to
 * leave the page showing two agents, having silently dropped opencode. A row is
 * identified by (agent, instance, trial) and the newest run wins it, so
 * re-running the same matrix refreshes in place instead of accumulating
 * duplicates.
 *
 * `fresh` throws the accumulated file away — the honest move whenever anything
 * that changes the meaning of a number changes: a new model, the grader landing,
 * the container landing.
 */
export function publish(report: Report, fresh = false): string {
  const slug = matchupSlug(report.trials.map((t) => t.agent));
  const file = path.join(BENCH_DIR, `${slug}.json`);
  fs.mkdirSync(BENCH_DIR, { recursive: true });
  // Only runs of the SAME agent set can merge. A run that adds an agent writes
  // a different file rather than quietly widening an existing matchup with rows
  // nobody measured side by side.
  const prev = fresh ? undefined : readExisting(file);

  const agents = new Map<string, PublishedAgent>(
    (prev?.agents ?? []).map((a) => [a.id, a]),
  );
  for (const t of report.trials) {
    // This run's metadata wins: it is the version and model actually used now.
    agents.set(t.agent, {
      id: t.agent,
      version: t.agentVersion,
      model: t.model,
      autonomy: t.autonomy,
    });
  }

  const results = new Map<string, PublishedResult>(
    (prev?.results ?? []).map((r) => [key(r), r]),
  );
  for (const t of report.trials) {
    results.set(key(t), {
      agent: t.agent,
      instanceId: t.instanceId,
      trial: t.trial,
      producedPatch: t.producedPatch,
      // Only the grader's own verdict may ever fill this in (Phase 1).
      // producedPatch is not a substitute: wiring it here would let a flipped
      // `graded` flag relabel "changed a file" as "fixed the bug". Until the
      // grader writes a real verdict per trial, a graded run with null verdicts
      // fails closed on the page — every bar reads 0%, not 100%.
      resolved: null,
      durationMs: t.durationMs,
      patchBytes: t.patchBytes,
      newFiles: t.newFiles.length,
      reason: t.reason,
      runId: report.startedAt,
    });
  }

  const generatedAt = new Date().toISOString();
  const thisRun = {
    runId: report.startedAt,
    generatedAt,
    agents: [...new Set(report.trials.map((t) => t.agent))],
  };
  const runs = [
    thisRun,
    ...(prev?.runs ?? []).filter((r) => r.runId !== thisRun.runId),
  ];

  const rows = [...results.values()];
  const out: PublishedRun = {
    slug,
    generatedAt,
    runId: report.startedAt,
    runs,
    // Grading is what separates a pipeline check from a result, so the phase is
    // derived from the run rather than typed in and left to rot. The weakest
    // contributing run sets it: one graded run does not grade the older rows
    // sitting next to it.
    phase: report.graded && prev?.phase !== 0 ? 1 : 0,
    isolation:
      report.isolation === "container" && prev?.isolation !== "none"
        ? "container"
        : "none",
    graded: report.graded && (prev?.graded ?? true),
    taskSet: {
      name: "SWE-bench Lite",
      repo: "django/django",
      instances: [...new Set(rows.map((r) => r.instanceId))].sort(),
    },
    agents: [...agents.values()],
    results: rows,
  };

  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  return file;
}

// Re-publish a finished run without re-running it — which run the page shows is
// an editorial decision, and it should not cost money to change your mind.
//   tsx bench/agent-bench/runner/publish.ts results/<run> [--fresh]
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: publish.ts <results-dir> [--fresh]");
    process.exit(1);
  }
  const file = dir.endsWith(".json") ? dir : path.join(dir, "report.json");
  const report = JSON.parse(fs.readFileSync(file, "utf-8")) as Report;
  console.log(publish(report, process.argv.includes("--fresh")));
}

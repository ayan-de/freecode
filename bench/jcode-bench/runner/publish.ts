// =============================================================================
// Publish — one committed JSON per task, the file /bench reads at build time.
//
// Same arrangement as bench/agent-bench/runner/publish.ts: results/ is
// git-ignored (workspaces, transcripts, callgrind dumps), so a slim record per
// trial is merged into apps/web/app/data/jcode-bench/<task>.json. Every run
// is KEPT, not overwritten — a leaderboard is a list of runs, and the
// score-over-time curve is the point. `--fresh` empties a task file.
//
// Dropped: transcripts, the submission diff, argv, prompt. Kept: the curve,
// the numbers, and every disclosure the page prints (version, model, autonomy,
// gates in force, whether the final grade ran the full gate).
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import type { CurvePoint, Report, TrialRecord } from "./types.js";

const DATA_DIR = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "apps",
  "web",
  "app",
  "data",
  "jcode-bench",
);

export interface PublishedRun {
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

export interface PublishedTask {
  task: string;
  oneLiner: string;
  generatedAt: string;
  runs: PublishedRun[];
}

export function toPublished(t: TrialRecord, runId: string): PublishedRun {
  return {
    runId,
    trial: t.trial,
    agent: t.agent,
    agentVersion: t.agentVersion,
    model: t.model,
    autonomy: t.autonomy,
    harnessFlags: t.harnessFlags,
    upstreamCommit: t.upstreamCommit,
    date: t.startedAt,
    best: t.best,
    bestAt: t.bestAt,
    final: t.final,
    finalFullGate: t.finalFullGate,
    grades: t.grades,
    activeMs: t.activeMs,
    durationMs: t.durationMs,
    timedOut: t.timedOut,
    curve: t.curve,
    ...(t.turns !== undefined ? { turns: t.turns } : {}),
    ...(t.inputTokens !== undefined ? { inputTokens: t.inputTokens } : {}),
    ...(t.outputTokens !== undefined ? { outputTokens: t.outputTokens } : {}),
    ...(t.usd !== undefined ? { usd: t.usd } : {}),
    ...(t.auditOk !== undefined ? { auditOk: t.auditOk } : {}),
  };
}

/**
 * Merge a report's trials for one task into an existing file. A row is keyed
 * by (runId, agent, trial): re-publishing the same run replaces its rows,
 * a new run adds rows. Newest first.
 */
export function mergeTask(
  existing: PublishedTask | undefined,
  task: string,
  oneLiner: string,
  runs: PublishedRun[],
  now: string,
): PublishedTask {
  const key = (r: PublishedRun) => `${r.runId}|${r.agent}|${r.trial}`;
  const incoming = new Set(runs.map(key));
  const kept = (existing?.runs ?? []).filter((r) => !incoming.has(key(r)));
  const all = [...runs, ...kept].sort((a, b) => b.date.localeCompare(a.date));
  return {
    task,
    oneLiner: oneLiner || existing?.oneLiner || "",
    generatedAt: now,
    runs: all,
  };
}

export function publish(
  report: Report,
  oneLiners: Record<string, string>,
  opts: { fresh?: boolean; dir?: string } = {},
): string[] {
  const dir = opts.dir ?? DATA_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const written: string[] = [];
  const byTask = new Map<string, TrialRecord[]>();
  for (const t of report.trials) {
    byTask.set(t.task, [...(byTask.get(t.task) ?? []), t]);
  }
  for (const [task, trials] of byTask) {
    const file = path.join(dir, `${task}.json`);
    const existing =
      !opts.fresh && fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, "utf-8")) as PublishedTask)
        : undefined;
    const merged = mergeTask(
      existing,
      task,
      oneLiners[task] ?? "",
      trials.map((t) => toPublished(t, report.runId)),
      now,
    );
    fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
    written.push(file);
  }
  return written;
}

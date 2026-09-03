// =============================================================================
// Publish — reduce a run to the file the /benchmark page reads.
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

const WEB_DATA = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "apps",
  "web",
  "app",
  "data",
  "agent-bench.json",
);

export interface PublishedRun {
  generatedAt: string;
  runId: string;
  /** Which phase of the spec produced this. The page refuses to dress up 0. */
  phase: number;
  isolation: "none" | "container";
  /** False until the official SWE-bench grader runs (Phase 1). */
  graded: boolean;
  taskSet: { name: string; repo: string; instances: string[] };
  agents: { id: string; version: string; model: string; autonomy: string }[];
  results: {
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
  }[];
}

export function publish(report: Report): string {
  const seen = new Map<string, PublishedRun["agents"][number]>();
  for (const t of report.trials) {
    if (seen.has(t.agent)) continue;
    seen.set(t.agent, {
      id: t.agent,
      version: t.agentVersion,
      model: t.model,
      autonomy: t.autonomy,
    });
  }

  const out: PublishedRun = {
    generatedAt: new Date().toISOString(),
    runId: report.startedAt,
    // Grading is what separates a pipeline check from a result, so the phase is
    // derived from the run rather than typed in and left to rot.
    phase: report.graded ? 1 : 0,
    isolation: report.isolation,
    graded: report.graded,
    taskSet: {
      name: "SWE-bench Lite",
      repo: "django/django",
      instances: [...new Set(report.trials.map((t) => t.instanceId))],
    },
    agents: [...seen.values()],
    results: report.trials.map((t) => ({
      agent: t.agent,
      instanceId: t.instanceId,
      trial: t.trial,
      producedPatch: t.producedPatch,
      resolved: report.graded ? t.producedPatch : null,
      durationMs: t.durationMs,
      patchBytes: t.patchBytes,
      newFiles: t.newFiles.length,
      reason: t.reason,
    })),
  };

  fs.writeFileSync(WEB_DATA, JSON.stringify(out, null, 2) + "\n");
  return WEB_DATA;
}

// Re-publish a finished run without re-running it — which run the page shows is
// an editorial decision, and it should not cost money to change your mind.
//   tsx bench/agent-bench/runner/publish.ts results/<run>
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: publish.ts <results-dir>");
    process.exit(1);
  }
  const file = dir.endsWith(".json") ? dir : path.join(dir, "report.json");
  const report = JSON.parse(fs.readFileSync(file, "utf-8")) as Report;
  console.log(publish(report));
}

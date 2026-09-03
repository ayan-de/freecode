#!/usr/bin/env tsx
// =============================================================================
// The trial loop. agents × instances × trials, one workspace each.
//
// Phase 0: no container, no grader, no metering. It answers exactly one
// question — does every adapter produce a non-empty patch — and every record it
// writes carries `isolation: "none"` so it can never be mistaken for a
// publishable number.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { agentVersion, loadAgent, runAgent } from "./agents.js";
import { loadInstances, readIdList } from "./instances.js";
import { taskPrompt } from "./prompt.js";
import { createWorkspace, extractPatch, verifyWorkspace } from "./workspace.js";
import type { Report, TrialRecord } from "./types.js";

const ROOT = path.join(import.meta.dirname, "..");

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const agentIds = (arg("agents", "freecode,claude-code") as string).split(",");
const trials = Number(arg("trials", "1"));
const timeoutMs = Number(arg("timeout", "900000"));
const instanceIds = arg("instances")
  ? (arg("instances") as string).split(",")
  : readIdList(path.join(ROOT, "instances", "django-lite.txt"));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = arg("out", path.join(ROOT, "results", runId)) as string;

async function main() {
  const agents = agentIds.map(loadAgent);
  const versions = new Map(agents.map((a) => [a.id, agentVersion(a)]));
  const instances = await loadInstances(instanceIds);

  fs.mkdirSync(outDir, { recursive: true });
  console.log(`run ${runId}`);
  for (const a of agents) {
    console.log(`  ${a.id.padEnd(12)} ${versions.get(a.id)}  model=${a.model}`);
    console.log(`  ${"".padEnd(12)} autonomy: ${a.autonomy}`);
  }
  console.log(
    `  ${instances.length} instance(s) × ${trials} trial(s) × ${agents.length} agent(s)\n`,
  );

  const records: TrialRecord[] = [];
  for (const inst of instances) {
    for (let trial = 1; trial <= trials; trial++) {
      for (const spec of agents) {
        const artifactDir = path.join(
          outDir,
          inst.instanceId,
          `trial-${trial}`,
          spec.id,
        );
        fs.mkdirSync(artifactDir, { recursive: true });
        process.stdout.write(
          `${inst.instanceId} t${trial} ${spec.id.padEnd(12)} `,
        );

        const ws = createWorkspace(inst);
        let record: TrialRecord;
        try {
          if (!verifyWorkspace(ws.dir, inst.baseCommit)) {
            throw new Error(`checkout is not at ${inst.baseCommit}`);
          }
          const prompt = taskPrompt(inst);
          fs.writeFileSync(path.join(artifactDir, "prompt.txt"), prompt);

          const run = await runAgent(
            spec,
            prompt,
            ws.dir,
            artifactDir,
            timeoutMs,
          );
          fs.writeFileSync(
            path.join(artifactDir, "argv.json"),
            JSON.stringify(run.argv, null, 2),
          );

          const patch = extractPatch(ws.dir);
          fs.writeFileSync(path.join(artifactDir, "patch.diff"), patch.diff);

          record = {
            agent: spec.id,
            agentVersion: versions.get(spec.id)!,
            model: spec.model,
            autonomy: spec.autonomy,
            instanceId: inst.instanceId,
            trial,
            isolation: "none",
            producedPatch: patch.diff.length > 0,
            reason: run.timedOut
              ? `timed out after ${timeoutMs}ms`
              : patch.diff.length > 0
                ? "ok"
                : `no changes (exit ${run.exitCode})`,
            exitCode: run.exitCode,
            timedOut: run.timedOut,
            durationMs: run.durationMs,
            patchBytes: Buffer.byteLength(patch.diff),
            newFiles: patch.newFiles,
            artifactDir: path.relative(ROOT, artifactDir),
          };
        } catch (err) {
          // One dead trial must not cost the rest of the matrix.
          record = {
            agent: spec.id,
            agentVersion: versions.get(spec.id)!,
            model: spec.model,
            autonomy: spec.autonomy,
            instanceId: inst.instanceId,
            trial,
            isolation: "none",
            producedPatch: false,
            reason: `harness error: ${(err as Error).message}`.slice(0, 200),
            exitCode: null,
            timedOut: false,
            durationMs: 0,
            patchBytes: 0,
            newFiles: [],
            artifactDir: path.relative(ROOT, artifactDir),
          };
        } finally {
          ws.cleanup();
        }

        records.push(record);
        console.log(
          `${record.producedPatch ? "patch" : "EMPTY"} ` +
            `${String(record.patchBytes).padStart(6)}B ` +
            `${(record.durationMs / 1000).toFixed(0)}s  ${record.reason}`,
        );
      }
    }
  }

  const report: Report = {
    startedAt: runId,
    finishedAt: new Date().toISOString(),
    isolation: "none",
    graded: false,
    trials: records,
  };
  const reportFile = path.join(outDir, "report.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n${reportFile}`);

  // Phase 0 has no grader, so "did every adapter produce a patch" IS the
  // verdict. Non-zero on a broken adapter, because a silently empty patch is
  // exactly the failure this phase exists to catch.
  const empty = records.filter((r) => !r.producedPatch);
  if (empty.length > 0) {
    console.error(
      `\n${empty.length}/${records.length} trials produced no patch:`,
    );
    for (const r of empty) console.error(`  ${r.agent} ${r.instanceId}: ${r.reason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

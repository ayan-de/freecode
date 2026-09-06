#!/usr/bin/env tsx
// =============================================================================
// The trial loop. agents × instances × trials, one workspace each.
//
// Metering (spec §6.4) is on by default: a pass-through proxy so every agent
// is billed by one table; `--no-meter` restores the adapter-only loop.
// `--isolate` (spec §6.3) runs each trial in a container on an --internal
// docker network whose only exit is that proxy — build the image first with
// `docker build -t agent-bench bench/agent-bench/isolate`. Grading is a
// separate, free-to-rerun step: `pnpm bench:grade results/<run>`.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { agentVersion, loadAgent, runAgent } from "./agents.js";
import { loadInstances, readIdList } from "./instances.js";
import { publish } from "./publish.js";
import { taskPrompt } from "./prompt.js";
import { createWorkspace, extractPatch, verifyWorkspace } from "./workspace.js";
import {
  IMAGE,
  INTERNAL_NETWORK,
  dockerAvailable,
  ensureNetworks,
  forwardedEnvNames,
  imageExists,
  startProxyContainer,
} from "../isolate/docker.js";
import { meterEnv, upstreamFor } from "../proxy/env.js";
import { persistTrialMeter } from "../proxy/fold.js";
import { startProxy } from "../proxy/server.js";
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
const meter = !process.argv.includes("--no-meter");
const isolate = process.argv.includes("--isolate");

async function main() {
  // Isolation implies metering: the agent's only route out is the sidecar
  // proxy, so an --isolate run is always metered.
  if (isolate) {
    if (!dockerAvailable()) {
      throw new Error("--isolate needs docker (daemon up, user in the docker group)");
    }
    if (!imageExists(IMAGE)) {
      throw new Error(
        `--isolate needs the "${IMAGE}" image. Build it (online) first:\n` +
          `  pnpm bench:image`,
      );
    }
    ensureNetworks();
  }

  const agents = agentIds.map(loadAgent);
  const versions = new Map(
    agents.map((a) => [a.id, agentVersion(a, isolate ? IMAGE : undefined)]),
  );
  const instances = await loadInstances(instanceIds);

  fs.mkdirSync(outDir, { recursive: true });
  console.log(`run ${runId}`);
  for (const a of agents) {
    console.log(`  ${a.id.padEnd(12)} ${versions.get(a.id)}  model=${a.model}`);
    console.log(`  ${"".padEnd(12)} autonomy: ${a.autonomy}`);
  }
  console.log(
    `  ${instances.length} instance(s) × ${trials} trial(s) × ${agents.length} agent(s)` +
      `  meter=${meter || isolate ? "proxy" : "off"}  isolation=${isolate ? "container" : "none"}\n`,
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
        // Either a host proxy (metered non-isolated) or a sidecar container
        // proxy (isolated); both expose an origin and a close().
        let proxyOrigin: string | undefined;
        let closeProxy: (() => void | Promise<void>) | undefined;
        // DNS-safe name (container names are hostnames on user networks; the
        // instance id's `__` is not valid there).
        const safe = `${inst.instanceId}-t${trial}-${spec.id}`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-");
        try {
          if (!verifyWorkspace(ws.dir, inst.baseCommit)) {
            throw new Error(`checkout is not at ${inst.baseCommit}`);
          }
          const prompt = taskPrompt(inst);
          fs.writeFileSync(path.join(artifactDir, "prompt.txt"), prompt);

          const logPath = path.join(artifactDir, "proxy.jsonl");
          if (isolate) {
            const pc = await startProxyContainer({
              name: `bench-proxy-${safe}`.slice(0, 63),
              image: IMAGE,
              upstream: upstreamFor(spec),
              artifactDir,
              benchDir: ROOT,
            });
            proxyOrigin = pc.url;
            closeProxy = pc.close;
          } else if (meter) {
            const hp = await startProxy({ upstream: upstreamFor(spec), logPath });
            proxyOrigin = hp.origin;
            closeProxy = hp.close;
          }

          const extraEnv = proxyOrigin ? meterEnv(proxyOrigin) : undefined;
          const containerize = isolate
            ? {
                image: IMAGE,
                network: INTERNAL_NETWORK,
                name: `bench-${safe}`.slice(0, 63),
                wsDir: ws.dir,
                benchDir: ROOT,
                envNames: forwardedEnvNames(spec.env, extraEnv),
                uid: process.getuid?.() ?? 1000,
                gid: process.getgid?.() ?? 1000,
              }
            : undefined;

          const run = await runAgent(
            spec,
            prompt,
            ws.dir,
            artifactDir,
            timeoutMs,
            extraEnv,
            containerize,
          );
          fs.writeFileSync(
            path.join(artifactDir, "argv.json"),
            JSON.stringify(run.argv, null, 2),
          );

          const patch = extractPatch(ws.dir);
          fs.writeFileSync(path.join(artifactDir, "patch.diff"), patch.diff);
          const usage = proxyOrigin ? persistTrialMeter(artifactDir, spec.model) : undefined;

          record = {
            agent: spec.id,
            agentVersion: versions.get(spec.id)!,
            model: spec.model,
            autonomy: spec.autonomy,
            instanceId: inst.instanceId,
            trial,
            isolation: isolate ? "container" : "none",
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
            turns: usage?.turns,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            cacheReadTokens: usage?.cacheReadTokens,
            cacheWriteTokens: usage?.cacheWriteTokens,
            usd: usage ? (usage.usd ?? null) : undefined,
            auditOk: usage?.auditOk,
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
            isolation: isolate ? "container" : "none",
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
          await closeProxy?.();
          ws.cleanup();
        }

        records.push(record);
        const tokens =
          record.inputTokens !== undefined
            ? ` ${(record.inputTokens + (record.outputTokens ?? 0)).toLocaleString()}tok`
            : "";
        console.log(
          `${record.producedPatch ? "patch" : "EMPTY"} ` +
            `${String(record.patchBytes).padStart(6)}B ` +
            `${(record.durationMs / 1000).toFixed(0)}s${tokens}  ${record.reason}`,
        );
      }
    }
  }

  const report: Report = {
    startedAt: runId,
    finishedAt: new Date().toISOString(),
    isolation: isolate ? "container" : "none",
    graded: false,
    trials: records,
  };
  const reportFile = path.join(outDir, "report.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n${reportFile}`);
  // Always publish: the point of the /benchmark page is that a finished run is
  // already on it. This MERGES into whatever is already there — a run of
  // freecode+opencode followed by one of freecode+claude-code leaves all three
  // on the page, where it used to silently drop the agent missing from the
  // latest run. `--fresh` starts over.
  console.log(path.relative(process.cwd(), publish(report, process.argv.includes("--fresh"))));

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

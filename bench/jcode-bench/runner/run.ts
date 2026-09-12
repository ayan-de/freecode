#!/usr/bin/env tsx
// =============================================================================
// The trial loop: tasks × trials × agents, one staged workspace each.
//
//   pnpm bench:jcode --tasks utf16-transcode --agents freecode --trials 1
//
// Per trial: stage the upstream task fresh, start the recording proxy (the
// same meter agent-bench uses, so tokens and USD land on one rate card), spawn
// the agent in the task dir with the one prompt, and let it climb until it
// stops or `--timeout` (default 2h — time is recorded, not judged). Then fold
// its scores.jsonl into a curve, run the official final grade on what it left
// (`--full` gate unless `--no-full-gate`), fold the meter, and publish.
//
// No isolation yet: the agent runs on the host, so the proxy sees only what
// is pointed at it (AGENT-BENCH.md §3). Recorded as such.
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { agentVersion, loadAgent, runAgent } from "../../agent-bench/runner/agents.js";
import { meterEnv, upstreamFor } from "../../agent-bench/proxy/env.js";
import { persistTrialMeter } from "../../agent-bench/proxy/fold.js";
import { startProxy } from "../../agent-bench/proxy/server.js";
import { buildCurve, parseScores, stepsOnly, summarize } from "./curve.js";
import { checkToolchain, finalGrade } from "./grade.js";
import { taskPrompt } from "./prompt.js";
import { publish } from "./publish.js";
import { ensureUpstream, listTasks, stageTask, submissionDiff, taskOneLiner } from "./tasks.js";
import type { Report, TrialRecord } from "./types.js";

const ROOT = path.join(import.meta.dirname, "..");
const AGENT_DIR = path.join(ROOT, "agents");
/** The gates whose env value is recorded on the trial (agent/signals). */
const HARNESS_FLAG_ENV = [
  "FREECODE_AUTO_POKE",
  "FREECODE_CONFIDENCE_GATE",
  "FREECODE_HILLCLIMB_GATE",
  "FREECODE_DISABLE_REDIRECT",
];

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const agentIds = (arg("agents", "freecode") as string).split(",");
const trials = Number(arg("trials", "1"));
const timeoutMs = Number(arg("timeout", String(2 * 60 * 60 * 1000)));
const finalTimeoutMs = Number(arg("final-timeout", String(60 * 60 * 1000)));
const meter = !process.argv.includes("--no-meter");
const fullGate = !process.argv.includes("--no-full-gate");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = arg("out", path.join(ROOT, "results", runId)) as string;

async function main() {
  checkToolchain();
  const upstream = ensureUpstream();
  const tasks = arg("tasks") ? (arg("tasks") as string).split(",") : listTasks(upstream.dir);
  const agents = agentIds.map((id) => loadAgent(id, AGENT_DIR));
  const versions = new Map(agents.map((a) => [a.id, agentVersion(a)]));
  const harnessFlags = Object.fromEntries(
    HARNESS_FLAG_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]!]),
  );

  fs.mkdirSync(outDir, { recursive: true });
  console.log(`run ${runId}  upstream ${upstream.commit}`);
  for (const a of agents) {
    console.log(`  ${a.id.padEnd(12)} ${versions.get(a.id)}  model=${a.model}`);
    console.log(`  ${"".padEnd(12)} autonomy: ${a.autonomy}`);
  }
  console.log(
    `  ${tasks.length} task(s) × ${trials} trial(s) × ${agents.length} agent(s)` +
      `  meter=${meter ? "proxy" : "off"}  final=${fullGate ? "--full" : "sampled"}` +
      (Object.keys(harnessFlags).length ? `  gates=${JSON.stringify(harnessFlags)}` : "") +
      "\n",
  );

  const report: Report = {
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    upstreamCommit: upstream.commit,
    trials: [],
  };
  const oneLiners = Object.fromEntries(tasks.map((t) => [t, taskOneLiner(upstream.dir, t)]));

  for (const task of tasks) {
    for (let trial = 1; trial <= trials; trial++) {
      for (const spec of agents) {
        const artifactDir = path.join(outDir, task, `trial-${trial}`, spec.id);
        fs.mkdirSync(artifactDir, { recursive: true });
        process.stdout.write(`${task} t${trial} ${spec.id.padEnd(12)} `);

        const ws = fs.mkdtempSync(path.join(os.tmpdir(), `jcode-bench-${task}-`));
        let closeProxy: (() => void | Promise<void>) | undefined;
        try {
          const taskDir = stageTask(upstream.dir, task, ws);
          const prompt = taskPrompt(task);
          fs.writeFileSync(path.join(artifactDir, "prompt.txt"), prompt);

          let proxyOrigin: string | undefined;
          if (meter) {
            const hp = await startProxy({
              upstream: upstreamFor(spec),
              logPath: path.join(artifactDir, "proxy.jsonl"),
            });
            proxyOrigin = hp.origin;
            closeProxy = hp.close;
          }

          const startedAt = Date.now();
          const run = await runAgent(
            spec,
            prompt,
            taskDir,
            artifactDir,
            timeoutMs,
            proxyOrigin ? meterEnv(proxyOrigin) : undefined,
          );
          fs.writeFileSync(path.join(artifactDir, "argv.json"), JSON.stringify(run.argv, null, 2));

          // The agent's own grades → the curve.
          const scoresFile = path.join(taskDir, "scores.jsonl");
          const scoresText = fs.existsSync(scoresFile) ? fs.readFileSync(scoresFile, "utf-8") : "";
          fs.writeFileSync(path.join(artifactDir, "scores.jsonl"), scoresText);
          const curve = buildCurve(parseScores(scoresText), startedAt);
          const { best, bestAt, activeMs } = summarize(curve);

          // The submission as left, and its official grade.
          fs.writeFileSync(
            path.join(artifactDir, "submission.diff"),
            submissionDiff(upstream.dir, task, taskDir),
          );
          process.stdout.write(`${curve.length} grades, best ${best === null ? "—" : best.toFixed(3)} · final… `);
          const fin = finalGrade(taskDir, { full: fullGate, timeoutMs: finalTimeoutMs });
          fs.writeFileSync(path.join(artifactDir, "final-grade.log"), fin.stdout + fin.stderr);

          const usage = proxyOrigin ? persistTrialMeter(artifactDir, spec.model) : undefined;
          const record: TrialRecord = {
            task,
            agent: spec.id,
            agentVersion: versions.get(spec.id)!,
            model: spec.model,
            autonomy: spec.autonomy,
            trial,
            upstreamCommit: upstream.commit,
            startedAt: new Date(startedAt).toISOString(),
            durationMs: run.durationMs,
            timedOut: run.timedOut,
            exitCode: run.exitCode,
            grades: curve.length,
            best,
            bestAt,
            activeMs,
            final: fin.score,
            finalFullGate: fin.fullGate,
            curve: stepsOnly(curve),
            harnessFlags,
            artifactDir: path.relative(ROOT, artifactDir),
            ...(usage
              ? {
                  turns: usage.turns,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  cacheReadTokens: usage.cacheReadTokens,
                  cacheWriteTokens: usage.cacheWriteTokens,
                  usd: usage.usd ?? null,
                  auditOk: usage.auditOk,
                }
              : {}),
          };
          report.trials.push(record);
          console.log(
            fin.verified
              ? `${fin.score!.toFixed(4)} (${(2 ** fin.score!).toFixed(2)}x)${fin.fullGate ? " full gate" : ""}` +
                  (usage ? `  ${usage.turns} turns` : "") +
                  (run.timedOut ? "  TIMED OUT" : "")
              : `FAILED verification — no score${run.timedOut ? "  TIMED OUT" : ""}`,
          );
        } catch (err) {
          console.log(`ERROR ${(err as Error).message}`);
        } finally {
          await closeProxy?.();
          fs.rmSync(ws, { recursive: true, force: true });
        }
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  for (const f of publish(report, oneLiners, { fresh: process.argv.includes("--fresh") })) {
    console.log(path.relative(process.cwd(), f));
  }
  // A trial that failed its final verification is a broken agent (it left the
  // submission wrong), and a run with none scored is a broken harness.
  const unverified = report.trials.filter((t) => t.final === null).length;
  if (report.trials.length === 0 || unverified > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import type { CommandModule } from "yargs";
import * as path from "path";
import { fileURLToPath } from "url";

// Autonomous runs (Tier A, bounded): `freecode autonomous start|status|cancel`.
// `child` is an internal, undocumented subcommand — it's what `start` spawns
// detached (re-invoking this same binary with new argv, the standard way to
// get a self-contained detached child regardless of dev/tsx vs the compiled
// binary), never something a user types.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md §4.4(a), §4.9

interface StartArgs {
  mission: string[];
  verify: string;
  maxTurns: number;
  maxTokens: number;
  timeoutMs: number;
  maxUsd: number;
  model?: string;
}

const startCommand: CommandModule<object, StartArgs> = {
  command: "start [mission..]",
  describe: "start a bounded autonomous run in this directory (detached)",
  builder: (yargs) =>
    yargs
      .positional("mission", {
        type: "string",
        array: true,
        default: [],
        describe: "what the run should accomplish",
      })
      .option("verify", {
        type: "string",
        demandOption: true,
        describe: "shell command that must pass for the run to be done",
      })
      .option("maxTurns", { type: "number", default: 20 })
      .option("maxTokens", { type: "number", default: 150_000 })
      .option("timeoutMs", { type: "number", default: 60 * 60 * 1000 })
      .option("maxUsd", {
        type: "number",
        demandOption: true,
        describe: "hard USD ceiling — required, no default (see spec §9)",
      })
      .option("model", {
        type: "string",
        describe: "model to use, in provider/model format",
      }),
  handler: async (argv) => {
    const { createRunManifest, saveRunManifest } = await import(
      "../../autonomous/run-store.js"
    );
    const { spawnRun } = await import("../../autonomous/supervisor.js");

    const manifest = createRunManifest(
      {
        maxTurns: argv.maxTurns,
        maxTokens: argv.maxTokens,
        timeoutMs: argv.timeoutMs,
        maxUsd: argv.maxUsd,
      },
      argv.verify,
      argv.mission.join(" ") || undefined,
    );
    manifest.worktreePath = process.cwd();
    saveRunManifest(manifest);

    // process.argv[1] is the entrypoint that launched *this* process. In the
    // compiled binary (FREECODE_BUNDLED=1, per CLAUDE.md) that's plain JS, so
    // re-exec via `node <entry>` works directly. In this repo's dev flow it's
    // TypeScript source run through tsx's loader hooks, which a bare `node`
    // invocation cannot resolve (no loader) — re-exec through the local tsx
    // binary instead, same one already used to run this process.
    const entrypoint = process.argv[1];
    const isTsSource = entrypoint.endsWith(".ts") && !process.env.FREECODE_BUNDLED;
    const childArgs = [entrypoint, "autonomous", "child", manifest.id];
    const command = isTsSource
      ? path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          "..",
          "node_modules",
          ".bin",
          "tsx",
        )
      : process.execPath;
    if (argv.model) childArgs.push("--model", argv.model);
    spawnRun(manifest, command, childArgs);

    console.log(`Started run ${manifest.id}`);
    console.log(`  verify:  ${argv.verify}`);
    console.log(`  limits:  ${JSON.stringify(manifest.limits)}`);
    console.log(`  status:  freecode autonomous status ${manifest.id}`);
  },
};

const statusCommand: CommandModule<object, { runId: string }> = {
  command: "status <runId>",
  describe: "check an autonomous run's status, reconciling a dead PID",
  builder: (yargs) =>
    yargs.positional("runId", { type: "string", demandOption: true }),
  handler: async (argv) => {
    const { reconcileRunStatus } = await import(
      "../../autonomous/supervisor.js"
    );
    const manifest = reconcileRunStatus(argv.runId);
    if (!manifest) {
      console.error(`No such run: ${argv.runId}`);
      process.exit(1);
    }
    console.log(JSON.stringify(manifest, null, 2));
  },
};

const cancelCommand: CommandModule<object, { runId: string }> = {
  command: "cancel <runId>",
  describe: "request cancellation of an autonomous run",
  builder: (yargs) =>
    yargs.positional("runId", { type: "string", demandOption: true }),
  handler: async (argv) => {
    const { requestCancel } = await import("../../autonomous/supervisor.js");
    const manifest = requestCancel(argv.runId);
    if (!manifest) {
      console.error(`No such run: ${argv.runId}`);
      process.exit(1);
    }
    console.log(`Cancel requested for ${argv.runId}`);
  },
};

interface ChildArgs {
  runId: string;
  model?: string;
}

const childCommand: CommandModule<object, ChildArgs> = {
  command: "child <runId>",
  describe: false, // internal — spawned by `start`, not user-facing
  builder: (yargs) =>
    yargs
      .positional("runId", { type: "string", demandOption: true })
      .option("model", { type: "string" }),
  handler: async (argv) => {
    const { runAutonomousChild } = await import(
      "../../autonomous/child.js"
    );
    await runAutonomousChild(argv.runId, argv.model);
  },
};

export const autonomousCommand: CommandModule = {
  command: "autonomous <command>",
  describe: "bounded, budget-capped unattended runs (Tier A)",
  builder: (yargs) =>
    yargs
      .command(startCommand)
      .command(statusCommand)
      .command(cancelCommand)
      .command(childCommand)
      .demandCommand(1),
  handler: () => {},
};

// =============================================================================
// Agent adapters — load `agents/<id>.json`, pin the version, run the thing.
//
// Adding an agent is one JSON file. Nothing about a competitor is hard-coded
// here, and nothing about freecode is special-cased.
// =============================================================================

import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  dockerArgv,
  removeContainer,
  type Containerize,
} from "../isolate/docker.js";
import type { AgentSpec } from "./types.js";

const AGENT_DIR = path.join(import.meta.dirname, "..", "agents");

export function loadAgent(id: string): AgentSpec {
  const file = path.join(AGENT_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    const have = fs
      .readdirSync(AGENT_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    throw new Error(`no adapter ${id}; have: ${have.join(", ")}`);
  }
  const spec = JSON.parse(fs.readFileSync(file, "utf-8")) as AgentSpec;
  if (spec.id !== id) throw new Error(`${file}: id is "${spec.id}", not "${id}"`);
  if (!spec.run.some((a) => a.includes("{prompt}"))) {
    throw new Error(`${file}: run template never uses {prompt}`);
  }
  if (!spec.autonomy) throw new Error(`${file}: autonomy must be stated (§6.2)`);
  return spec;
}

/**
 * The agent's self-reported version, recorded in every trial.
 *
 * Agent CLIs move between releases and a flag that silently stopped working
 * degrades a competitor while flattering us (spec §10.6) — so the version that
 * produced a number is part of the number.
 */
export function agentVersion(spec: AgentSpec, image?: string): string {
  // Isolated trials run the IMAGE's copy of the agent, so that is the copy
  // whose version belongs in the record — not whatever the host has.
  const argv = image
    ? ["docker", "run", "--rm", image, ...spec.versionCmd]
    : spec.versionCmd;
  const [cmd, ...args] = argv;
  const r = spawnSync(cmd!, args, { encoding: "utf-8", timeout: 120_000 });
  if (r.status !== 0) return "unknown";
  return (r.stdout || r.stderr).trim().split("\n")[0]!.slice(0, 80);
}

function render(spec: AgentSpec, prompt: string): string[] {
  return spec.run.map((arg) =>
    arg.replaceAll("{prompt}", prompt).replaceAll("{model}", spec.model),
  );
}

/**
 * Resolves an adapter's `env`, so no adapter file ever contains a credential —
 * these are committed, and the whole point of the run is that a stranger can
 * read them.
 *
 * `${VAR}` is substituted from the environment and is a hard error when unset:
 * an agent that silently fell back to its own key would be billed elsewhere and
 * would quietly break the "one bill" property (spec §5).
 * `""` means *unset this variable*, which is how a pre-existing
 * `ANTHROPIC_API_KEY` in the operator's shell is kept from overriding the
 * endpoint we are pointing the agent at.
 * `{benchDir}` is this directory, which is how an adapter points an agent at
 * `empty-config/` — the only way found to stop opencode loading the operator's
 * personal MCP servers (see agents/opencode.json).
 */
export function resolveEnv(spec: AgentSpec, benchDir?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, raw] of Object.entries(spec.env ?? {})) {
    if (raw === "") {
      delete env[key];
      continue;
    }
    env[key] = raw
      // In a container, {benchDir} is the ro mount, not the host path.
      .replaceAll("{benchDir}", benchDir ?? path.join(AGENT_DIR, ".."))
      .replace(/\$\{(\w+)\}/g, (_, name: string) => {
      const value = process.env[name];
      if (!value) {
        throw new Error(
          `${spec.id}: ${key} needs $${name}, which is unset. ` +
            `The MiniMax key is in ~/.freecode/config.json under providers.minimax.apiKey — ` +
            `export it rather than pasting it into agents/${spec.id}.json.`,
        );
      }
      return value;
    });
  }
  return env;
}

export interface AgentRun {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  argv: string[];
}

/**
 * One agent, one task, in `cwd`.
 *
 * stdin is `ignore`: an agent that drops to an interactive prompt would
 * otherwise sit there until the timeout and report as a slow failure rather
 * than the misconfiguration it is.
 */
export function runAgent(
  spec: AgentSpec,
  prompt: string,
  cwd: string,
  artifactDir: string,
  timeoutMs: number,
  extraEnv?: NodeJS.ProcessEnv,
  containerize?: Containerize,
): Promise<AgentRun> {
  // In a container, {benchDir} in the adapter env must resolve to the ro
  // mount. The env still carries real values (docker copies them from the
  // spawn env for each bare `-e NAME`); only argv stays value-free.
  const env = {
    ...resolveEnv(spec, containerize ? "/bench" : undefined),
    ...extraEnv,
  };
  const agentArgv = render(spec, prompt);
  const argv = containerize ? dockerArgv(containerize, agentArgv) : agentArgv;
  const [cmd, ...args] = argv;
  const out = fs.createWriteStream(path.join(artifactDir, "stdout.log"));
  const err = fs.createWriteStream(path.join(artifactDir, "stderr.log"));
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(cmd!, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(err);

    let timedOut = false;
    const kill = () => {
      timedOut = true;
      child.kill("SIGKILL");
      // Killing the docker CLIENT does not stop the container.
      if (containerize) removeContainer(containerize.name);
    };
    const timer = setTimeout(kill, timeoutMs);
    // A wall-clock guard on top of the timer: a laptop suspend freezes the
    // container but pauses setTimeout, so a lid closed overnight would blow
    // past the deadline (it did — one trial ran 7h). This interval compares
    // real elapsed time and fires on resume even when the timer is behind.
    const watchdog = setInterval(() => {
      if (!timedOut && Date.now() - startedAt >= timeoutMs) kill();
    }, 30_000);

    const done = (exitCode: number | null) => {
      clearTimeout(timer);
      clearInterval(watchdog);
      out.end();
      err.end();
      resolve({ exitCode, timedOut, durationMs: Date.now() - startedAt, argv });
    };
    child.on("error", () => done(null));
    child.on("close", (code) => done(code));
  });
}

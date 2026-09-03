// =============================================================================
// Agent adapters — load `agents/<id>.json`, pin the version, run the thing.
//
// Adding an agent is one JSON file. Nothing about a competitor is hard-coded
// here, and nothing about freecode is special-cased.
// =============================================================================

import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
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
export function agentVersion(spec: AgentSpec): string {
  const [cmd, ...args] = spec.versionCmd;
  const r = spawnSync(cmd!, args, { encoding: "utf-8", timeout: 30_000 });
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
export function resolveEnv(spec: AgentSpec): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, raw] of Object.entries(spec.env ?? {})) {
    if (raw === "") {
      delete env[key];
      continue;
    }
    env[key] = raw
      .replaceAll("{benchDir}", path.join(AGENT_DIR, ".."))
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
): Promise<AgentRun> {
  const argv = render(spec, prompt);
  const env = resolveEnv(spec);
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
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const done = (exitCode: number | null) => {
      clearTimeout(timer);
      out.end();
      err.end();
      resolve({ exitCode, timedOut, durationMs: Date.now() - startedAt, argv });
    };
    child.on("error", () => done(null));
    child.on("close", (code) => done(code));
  });
}

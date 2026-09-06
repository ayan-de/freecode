// =============================================================================
// Per-trial agent config files.
//
// Some agents have no env var for a setting the harness must control. opencode
// is the case that forced this: it resolves its endpoint from models.dev and
// ignores both base-URL env vars, so under `--isolate` — an `--internal`
// network whose only reachable peer is the recording proxy — it has no route to
// the model at all. Every trial would fail for a plumbing reason and read as a
// lost benchmark, which §Status of AGENT-BENCH.md calls the worst failure this
// harness has.
//
// Its config file does take a provider baseURL, and the proxy's address is only
// known per trial (the sidecar's IP is allocated when its container joins the
// network), so the config cannot be a committed file. It is rendered here,
// once per trial, into the trial's own artifact dir — which means it also lands
// in the evidence bundle: the exact config the agent ran under is published
// beside the number it produced.
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AgentSpec } from "./types.js";

/** Where the rendered config lands inside a container. Mounted ro. */
export const CONFIG_MOUNT = "/agent-config";

/**
 * Substitute `{proxyOrigin}` / `{model}` throughout a JSON value.
 *
 * Pure and total: walks the tree rather than string-replacing serialized JSON,
 * so a substituted value containing a quote cannot produce a broken file.
 */
export function renderConfig(
  contents: unknown,
  vars: { proxyOrigin?: string; model: string },
): unknown {
  if (typeof contents === "string") {
    return contents
      .replaceAll("{proxyOrigin}", vars.proxyOrigin ?? "")
      .replaceAll("{model}", vars.model);
  }
  if (Array.isArray(contents)) {
    return contents.map((v) => renderConfig(v, vars));
  }
  if (contents && typeof contents === "object") {
    return Object.fromEntries(
      Object.entries(contents).map(([k, v]) => [k, renderConfig(v, vars)]),
    );
  }
  return contents;
}

/**
 * Write `spec.configFile` for one trial. Returns the HOST directory that
 * `{configDir}` resolves to, or undefined when the adapter declares no config.
 *
 * The live dir is a throwaway under the OS temp dir, NOT the artifact dir, and
 * it is mounted rw. opencode treats XDG_CONFIG_HOME as writable state: pointed
 * at the old committed `empty-config/`, it grew that directory to 62 MB of
 * node_modules. A ro mount would break it and an artifact-dir mount would put
 * that 62 MB into the evidence bundle thirty times over. The rendered JSON is
 * still copied to `<trial>/agent-config.json` — the config an agent ran under
 * is part of the evidence, its package cache is not.
 *
 * An adapter that needs `{proxyOrigin}` and is run unmetered is a hard error
 * rather than a config pointing at nothing: the agent would silently fall back
 * to its own endpoint, which breaks the one-bill property the whole comparison
 * rests on (spec §5) — the same reasoning as an unset `${VAR}` in `env`.
 */
export function writeAgentConfig(
  spec: AgentSpec,
  artifactDir: string,
  proxyOrigin: string | undefined,
  benchDir: string,
): string | undefined {
  if (!spec.configFile) return undefined;
  const needsProxy = JSON.stringify(spec.configFile.contents).includes(
    "{proxyOrigin}",
  );
  if (needsProxy && !proxyOrigin) {
    throw new Error(
      `${spec.id}: configFile needs {proxyOrigin}, but this trial has no proxy. ` +
        `${spec.id} cannot be pointed at the meter without one, so a --no-meter ` +
        `run would send it to its own endpoint and off the shared bill.`,
    );
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-bench-${spec.id}-`));
  if (spec.configSeed) {
    const seed = path.join(benchDir, spec.configSeed);
    if (!fs.existsSync(seed)) {
      throw new Error(
        `${spec.id}: config seed ${spec.configSeed} is missing. It is a cache, ` +
          `not committed — create it once, online:\n` +
          `  XDG_CONFIG_HOME=${seed} opencode run --pure "hi" >/dev/null 2>&1\n` +
          `  rm -f ${seed}/opencode/opencode.json\n` +
          `See AGENT-BENCH.md §1.`,
      );
    }
    // A real copy, not a hardlink: the dir is mounted rw and the agent writes
    // into it, which through a hardlink would corrupt the shared seed.
    fs.cpSync(seed, dir, { recursive: true });
  }
  const file = path.join(dir, spec.configFile.path);
  if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) {
    throw new Error(`${spec.id}: configFile.path escapes the config dir`);
  }
  const rendered = renderConfig(spec.configFile.contents, {
    proxyOrigin,
    model: spec.model,
  });
  const json = JSON.stringify(rendered, null, 2) + "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, json);
  // Evidence copy: what the agent was configured with, without what it cached.
  fs.writeFileSync(path.join(artifactDir, "agent-config.json"), json);
  return dir;
}

/** Drop a trial's throwaway config dir, package cache and all. */
export function cleanAgentConfig(dir: string | undefined): void {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

// =============================================================================
// Container isolation (spec §6.3), sidecar-proxy design.
//
// Two networks:
//   INTERNAL_NETWORK  --internal, no route to the internet. The agent lives
//                     here and here only, so its sole reachable peer is the
//                     proxy — the egress audit is enforced by the namespace,
//                     not an honor system.
//   EGRESS_NETWORK    a normal bridge with internet. ONLY the proxy joins it.
//
// The recording proxy runs as its own container attached to BOTH networks:
// the agent reaches it by container name over the internal net (container-to-
// container always works), and it reaches the model over the egress net. This
// replaces the original "proxy on the host gateway" design, which the host
// firewall silently dropped (container-to-host-gateway blocked; confirmed
// HTTP 000 on this host, even on a non-internal network).
//
// Secrets never enter argv: env vars ride as bare `-e NAME` flags, which
// docker resolves from the spawning process's environment. argv.json stays
// publishable.
// =============================================================================

import { spawnSync } from "child_process";
import { CONFIG_MOUNT } from "../runner/agent-config.js";

export const IMAGE = "agent-bench";
export const INTERNAL_NETWORK = "agent-bench-internal";
export const EGRESS_NETWORK = "agent-bench-egress";
/** Fixed proxy port; the agent's base-URL env points here before the proxy exists. */
export const PROXY_PORT = 8080;
/** Where the workspace and bench dir land inside the container. */
export const WORKSPACE = "/workspace";
export const BENCH_MOUNT = "/bench";

export interface Containerize {
  image: string;
  network: string;
  /** Unique per trial, so a timeout can `docker rm -f` exactly this one. */
  name: string;
  /** Host workspace dir, mounted rw at /workspace. */
  wsDir: string;
  /** Host bench/agent-bench dir, mounted ro at /bench. */
  benchDir: string;
  /** Env NAMES to forward. Values come from the spawn env, never argv. */
  envNames: string[];
  /**
   * Host dir holding a per-trial rendered agent config, mounted **rw** at
   * /agent-config. Undefined for adapters that need no config file.
   *
   * Writable on purpose: opencode installs packages into XDG_CONFIG_HOME, so a
   * ro mount fails it outright. The dir is a per-trial throwaway, so nothing
   * survives to the next trial.
   */
  configDir?: string;
  uid: number;
  gid: number;
}

/** `docker run` argv around an agent's own argv. Pure — unit-testable. */
export function dockerArgv(c: Containerize, argv: string[]): string[] {
  return [
    "docker", "run", "--rm", "--init",
    "--name", c.name,
    "--network", c.network,
    "--user", `${c.uid}:${c.gid}`,
    "-v", `${c.wsDir}:${WORKSPACE}`,
    "-v", `${c.benchDir}:${BENCH_MOUNT}:ro`,
    ...(c.configDir ? ["-v", `${c.configDir}:${CONFIG_MOUNT}`] : []),
    "-w", WORKSPACE,
    // Writable HOME for CLIs that insist on one; --user means /root is not it.
    "-e", "HOME=/tmp/agent-home",
    ...c.envNames.flatMap((n) => ["-e", n]),
    c.image,
    ...argv,
  ];
}

/** The env names worth forwarding: the adapter's own, plus the meter's. */
export function forwardedEnvNames(
  adapterEnv: Record<string, string> | undefined,
  meterEnv: NodeJS.ProcessEnv | undefined,
): string[] {
  const names = new Set<string>();
  for (const [k, v] of Object.entries(adapterEnv ?? {})) {
    if (v !== "") names.add(k); // "" means unset — simply do not forward it
  }
  for (const k of Object.keys(meterEnv ?? {})) names.add(k);
  return [...names].sort();
}

function docker(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("docker", args, { encoding: "utf-8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

export function dockerAvailable(): boolean {
  return docker(["info", "--format", "{{.ServerVersion}}"]).ok;
}

export function imageExists(image: string): boolean {
  return docker(["image", "inspect", image, "--format", "ok"]).ok;
}

function ensureNetwork(name: string, internal: boolean): void {
  if (docker(["network", "inspect", name, "--format", "ok"]).ok) return;
  const args = internal
    ? ["network", "create", "--internal", name]
    : ["network", "create", name];
  if (!docker(args).ok) throw new Error(`docker network create ${name} failed`);
}

/** Create both networks if missing. The agent joins internal; the proxy, both. */
export function ensureNetworks(): void {
  ensureNetwork(INTERNAL_NETWORK, true);
  ensureNetwork(EGRESS_NETWORK, false);
}

/** Best-effort teardown after a timeout — the client dying does not stop a container. */
export function removeContainer(name: string): void {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ProxyContainer {
  name: string;
  /** Origin the agent points its base-URL env at, e.g. http://<name>:8080. */
  url: string;
  close(): void;
}

/**
 * Start the recording proxy as a container on both networks and wait until it
 * is listening. Detached (`-d`): it outlives the `docker run` client and is
 * torn down explicitly. Carries no API key — it only forwards — so nothing
 * secret rides its env. proxy.jsonl is written to a host-mounted /out.
 */
export async function startProxyContainer(opts: {
  name: string;
  image: string;
  upstream: string;
  /** Host artifactDir, mounted at /out so proxy.jsonl lands beside the trial. */
  artifactDir: string;
  /** Host bench dir, mounted ro at /bench — the proxy source runs from here. */
  benchDir: string;
}): Promise<ProxyContainer> {
  const run = docker([
    "run", "-d", "--name", opts.name,
    "--network", EGRESS_NETWORK,
    "-v", `${opts.artifactDir}:/out`,
    "-v", `${opts.benchDir}:${BENCH_MOUNT}:ro`,
    "-e", `PROXY_UPSTREAM=${opts.upstream}`,
    "-e", `PROXY_PORT=${PROXY_PORT}`,
    "-e", "PROXY_LOG=/out/proxy.jsonl",
    opts.image,
    "tsx", `${BENCH_MOUNT}/proxy/main.ts`,
  ]);
  if (!run.ok) throw new Error(`proxy container ${opts.name} failed to start`);
  // Join the internal network so the agent can reach it.
  if (!docker(["network", "connect", INTERNAL_NETWORK, opts.name]).ok) {
    removeContainer(opts.name);
    throw new Error(`proxy container ${opts.name} could not join ${INTERNAL_NETWORK}`);
  }
  // Address the proxy by its internal IP, not its name. Embedded DNS updates
  // asynchronously after a network connect, so a name-based URL loses a race
  // with an agent that resolves immediately on startup (freecode did — a 1s
  // NXDOMAIN exit). An IP has no propagation delay.
  const ipQuery = [
    "inspect", "-f",
    `{{(index .NetworkSettings.Networks "${INTERNAL_NETWORK}").IPAddress}}`,
    opts.name,
  ];
  for (let i = 0; i < 60; i++) {
    const logs = docker(["logs", opts.name]);
    if (logs.out.includes("PROXY_READY")) {
      const ip = docker(ipQuery).out;
      if (!ip) {
        removeContainer(opts.name);
        throw new Error(`proxy ${opts.name} has no IP on ${INTERNAL_NETWORK}`);
      }
      return {
        name: opts.name,
        url: `http://${ip}:${PROXY_PORT}`,
        close: () => removeContainer(opts.name),
      };
    }
    await sleep(500);
  }
  removeContainer(opts.name);
  throw new Error(`proxy container ${opts.name} never reported ready`);
}

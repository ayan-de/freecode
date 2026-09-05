// =============================================================================
// Container isolation (spec §6.3). One container per trial on an --internal
// docker network: no route to the internet, so the only way out is the
// recording proxy listening on the network's gateway (the host side of the
// bridge). That makes the proxy log a real egress audit instead of an honor
// system — with the stated residue that OTHER host services on the gateway
// IP remain reachable; the network namespace blocks the internet, the proxy
// log still audits what was actually sent.
//
// Secrets never enter argv: env vars ride as bare `-e NAME` flags, which
// docker resolves from the spawning process's environment. argv.json stays
// publishable.
// =============================================================================

import { spawnSync } from "child_process";

export const IMAGE = "agent-bench";
export const NETWORK = "agent-bench-internal";
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
  /** Host bench/agent-bench dir, mounted ro at /bench (empty-config lives there). */
  benchDir: string;
  /** Env NAMES to forward. Values come from the spawn env, never argv. */
  envNames: string[];
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

/**
 * Create the internal network if missing; return the gateway IP the proxy
 * should bind. `--internal` is the isolation: docker programs no masquerade
 * for it, so nothing routes past the bridge.
 */
export function ensureInternalNetwork(name: string): string {
  const fmt = ["--format", "{{(index .IPAM.Config 0).Gateway}}"];
  let r = docker(["network", "inspect", name, ...fmt]);
  if (!r.ok) {
    const created = docker(["network", "create", "--internal", name]);
    if (!created.ok) throw new Error(`docker network create ${name} failed`);
    r = docker(["network", "inspect", name, ...fmt]);
  }
  if (!r.ok || !r.out) throw new Error(`no gateway on docker network ${name}`);
  return r.out;
}

/** Best-effort teardown after a timeout — the client dying does not stop a container. */
export function removeContainer(name: string): void {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
}

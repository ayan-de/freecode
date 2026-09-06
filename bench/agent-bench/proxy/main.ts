// Sidecar proxy entrypoint (spec §6.3/§6.4). Runs INSIDE a container that sits
// on two networks: the agent's internal (no-egress) network, where the agent
// reaches it by name, and an egress network, where it reaches the model. This
// is the reachable path — container-to-container works regardless of the host
// firewall, which blocks container-to-host-gateway (the reason the first
// isolation design failed).
//
// Env (set by isolate/docker.ts):
//   PROXY_UPSTREAM  real model origin, e.g. https://api.minimax.io/anthropic
//   PROXY_PORT      fixed port the agent's base-URL env points at (default 8080)
//   PROXY_LOG       where to write proxy.jsonl (a host-mounted volume at /out)

import { startProxy } from "./server.js";

const upstream = process.env.PROXY_UPSTREAM;
if (!upstream) {
  console.error("PROXY_UPSTREAM is required");
  process.exit(1);
}
const port = Number(process.env.PROXY_PORT || "8080");
const logPath = process.env.PROXY_LOG || "/out/proxy.jsonl";

const proxy = await startProxy({ upstream, logPath, host: "0.0.0.0", port });
// The runner polls the logs for this line before starting the agent.
console.log(`PROXY_READY ${proxy.origin}`);

const shutdown = () => {
  proxy.close().finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

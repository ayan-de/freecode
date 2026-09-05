import test from "node:test";
import assert from "node:assert/strict";
import { dockerArgv, forwardedEnvNames, type Containerize } from "./docker.js";

const c: Containerize = {
  image: "agent-bench",
  network: "agent-bench-internal",
  name: "trial-x",
  wsDir: "/tmp/ws",
  benchDir: "/repo/bench/agent-bench",
  envNames: ["ANTHROPIC_BASE_URL", "MINIMAX_API_KEY"],
  uid: 1000,
  gid: 1000,
};

test("dockerArgv: env rides as bare -e NAME — no secret ever lands in argv", () => {
  const argv = dockerArgv(c, ["freecode", "run", "fix it"]);
  assert.equal(argv.includes("MINIMAX_API_KEY"), true);
  assert.equal(argv.some((a) => a.includes("MINIMAX_API_KEY=")), false);
  assert.deepEqual(argv.slice(-3), ["freecode", "run", "fix it"]);
  assert.equal(argv[argv.indexOf("--network") + 1], "agent-bench-internal");
  assert.equal(argv[argv.indexOf("--user") + 1], "1000:1000");
  assert.equal(argv.includes("/tmp/ws:/workspace"), true);
  assert.equal(argv.includes("/repo/bench/agent-bench:/bench:ro"), true);
});

test("forwardedEnvNames: adapter names + meter names; \"\" (unset) is not forwarded", () => {
  const names = forwardedEnvNames(
    { XDG_CONFIG_HOME: "{benchDir}/empty-config", ANTHROPIC_API_KEY: "" },
    { MINIMAX_BASE_URL: "http://x", ANTHROPIC_BASE_URL: "http://x" },
  );
  assert.deepEqual(names, ["ANTHROPIC_BASE_URL", "MINIMAX_BASE_URL", "XDG_CONFIG_HOME"]);
});

import assert from "node:assert";
import { test } from "node:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { cleanAgentConfig, renderConfig, writeAgentConfig } from "./agent-config.js";
import type { AgentSpec } from "./types.js";

const SPEC: AgentSpec = {
  id: "fake",
  versionCmd: ["fake", "--version"],
  run: ["fake", "{prompt}"],
  model: "minimax/MiniMax-M3",
  autonomy: "test",
  configFile: {
    path: "opencode/opencode.json",
    contents: { provider: { minimax: { options: { baseURL: "{proxyOrigin}/v1" } } } },
  },
};

function artifacts(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-config-test-"));
}

test("renderConfig walks the tree rather than patching serialized JSON", () => {
  const out = renderConfig(
    { a: "{proxyOrigin}/v1", b: ["{model}", 1, true, null], c: { d: "plain" } },
    { proxyOrigin: 'http://x"y:8080', model: "m" },
  );
  // A substituted value containing a quote must not be able to break the file.
  assert.deepEqual(out, {
    a: 'http://x"y:8080/v1',
    b: ["m", 1, true, null],
    c: { d: "plain" },
  });
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(out)));
});

test("writeAgentConfig renders the proxy origin into a writable throwaway dir", () => {
  const art = artifacts();
  const dir = writeAgentConfig(SPEC, art, "http://10.0.0.2:8080", ".")!;
  const written = JSON.parse(
    fs.readFileSync(path.join(dir, "opencode/opencode.json"), "utf-8"),
  );
  assert.equal(written.provider.minimax.options.baseURL, "http://10.0.0.2:8080/v1");

  // The dir must be writable: opencode installs packages into XDG_CONFIG_HOME.
  assert.doesNotThrow(() => fs.writeFileSync(path.join(dir, "opencode/probe"), "x"));
  // ...and must not be the artifact dir, or its package cache lands in the bundle.
  assert.ok(!path.resolve(dir).startsWith(path.resolve(art)));

  // The config itself IS evidence, so a copy stays with the trial.
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(art, "agent-config.json"), "utf-8")),
    written,
  );

  cleanAgentConfig(dir);
  assert.ok(!fs.existsSync(dir));
});

test("writeAgentConfig refuses to point an agent at nothing when unmetered", () => {
  assert.throws(
    () => writeAgentConfig(SPEC, artifacts(), undefined, "."),
    /needs \{proxyOrigin\}/,
  );
});

test("an adapter with no configFile gets no config dir", () => {
  const { configFile: _drop, ...bare } = SPEC;
  assert.equal(writeAgentConfig(bare, artifacts(), "http://x", "."), undefined);
});

test("configFile.path cannot escape the config dir", () => {
  const evil = { ...SPEC, configFile: { path: "../escaped.json", contents: {} } };
  assert.throws(() => writeAgentConfig(evil, artifacts(), "http://x", "."), /escapes/);
});

test("a missing config seed fails loudly, with the command that creates it", () => {
  const seeded = { ...SPEC, configSeed: ".cache/does-not-exist" };
  assert.throws(
    () => writeAgentConfig(seeded, artifacts(), "http://x", "."),
    /config seed .* is missing[\s\S]*XDG_CONFIG_HOME/,
  );
});

test("a config seed is copied in, then the rendered config is written over it", () => {
  const benchDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-"));
  fs.mkdirSync(path.join(benchDir, "seed/opencode/node_modules/zod"), { recursive: true });
  fs.writeFileSync(path.join(benchDir, "seed/opencode/node_modules/zod/index.js"), "//");
  // A stale config in the seed must not survive — the trial's proxy differs.
  fs.writeFileSync(path.join(benchDir, "seed/opencode/opencode.json"), '{"stale":true}');

  const dir = writeAgentConfig(
    { ...SPEC, configSeed: "seed" }, artifacts(), "http://10.0.0.9:8080", benchDir,
  )!;
  assert.ok(fs.existsSync(path.join(dir, "opencode/node_modules/zod/index.js")));
  const written = JSON.parse(fs.readFileSync(path.join(dir, "opencode/opencode.json"), "utf-8"));
  assert.equal(written.provider.minimax.options.baseURL, "http://10.0.0.9:8080/v1");

  // The seed is shared across trials, so the copy must not write back into it.
  fs.writeFileSync(path.join(dir, "opencode/node_modules/zod/index.js"), "MUTATED");
  assert.equal(
    fs.readFileSync(path.join(benchDir, "seed/opencode/node_modules/zod/index.js"), "utf-8"),
    "//",
  );
});


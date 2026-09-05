import { test, describe, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// config.ts resolves CONFIG_FILE from os.homedir() at module load, so point HOME
// at a scratch dir before importing it.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-fallback-"));
process.env.HOME = home;
const configFile = path.join(home, ".freecode", "config.json");

const { credentialedProviderIds, fallbackProviderFromCredentials } =
  await import("./config.js");

function writeConfigFile(config: unknown): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config));
}

const ENV_VARS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "MINIMAX_API_KEY"];

afterEach(() => {
  for (const v of ENV_VARS) delete process.env[v];
  writeConfigFile({});
});

describe("credentialedProviderIds", () => {
  test("an exported env key counts as a credential", () => {
    writeConfigFile({});
    process.env.ANTHROPIC_API_KEY = "sk-env";
    assert.deepEqual(credentialedProviderIds(), ["anthropic"]);
  });

  test("a stored key counts as a credential", () => {
    writeConfigFile({ providers: { minimax: { apiKey: "sk-stored" } } });
    assert.deepEqual(credentialedProviderIds(), ["minimax"]);
  });

  test("a providers entry without an apiKey does not count", () => {
    writeConfigFile({ providers: { anthropic: { authMode: "api-key" } } });
    assert.deepEqual(credentialedProviderIds(), []);
  });

  test("env and stored credentials merge, sorted, without duplicates", () => {
    writeConfigFile({ providers: { openai: { apiKey: "sk-stored" } } });
    process.env.ANTHROPIC_API_KEY = "sk-env";
    process.env.OPENAI_API_KEY = "sk-env-too";
    assert.deepEqual(credentialedProviderIds(), ["anthropic", "openai"]);
  });
});

describe("fallbackProviderFromCredentials", () => {
  test("a sole credential selects its provider", () => {
    writeConfigFile({});
    process.env.ANTHROPIC_API_KEY = "sk-env";
    assert.equal(fallbackProviderFromCredentials(), "anthropic");
  });

  test("no credential returns undefined, not an error", () => {
    writeConfigFile({});
    assert.equal(fallbackProviderFromCredentials(), undefined);
  });

  test("several credentials throw, naming every candidate", () => {
    writeConfigFile({});
    process.env.ANTHROPIC_API_KEY = "sk-a";
    process.env.OPENAI_API_KEY = "sk-b";
    assert.throws(
      () => fallbackProviderFromCredentials(),
      /anthropic.*openai/s,
    );
  });
});

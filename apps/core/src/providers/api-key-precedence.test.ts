import { test, describe, afterEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// config.ts resolves CONFIG_FILE from os.homedir() at module load, so point HOME
// at a scratch dir before importing it.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-keyprec-"));
process.env.HOME = home;
const configFile = path.join(home, ".freecode", "config.json");

const { getApiKey } = await import("./config.js");

function writeConfigFile(config: unknown): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config));
}

const ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CODING_PLAN_API_KEY",
];

afterEach(() => {
  for (const v of ENV_VARS) delete process.env[v];
});

describe("API key precedence", () => {
  test("the environment overrides a stored key", () => {
    writeConfigFile({ providers: { anthropic: { apiKey: "sk-stored" } } });
    process.env.ANTHROPIC_API_KEY = "sk-env";
    assert.equal(getApiKey("anthropic"), "sk-env");
  });

  test("the stored key is used when the environment is unset", () => {
    writeConfigFile({ providers: { anthropic: { apiKey: "sk-stored" } } });
    assert.equal(getApiKey("anthropic"), "sk-stored");
  });

  test("a configured coding-plan key beats the base provider's env var", () => {
    writeConfigFile({
      providers: { "minimax-coding-plan": { apiKey: "sk-plan" } },
    });
    process.env.MINIMAX_API_KEY = "sk-base-env";
    assert.equal(getApiKey("minimax-coding-plan"), "sk-plan");
  });

  test("the base provider's env var still resolves a plan variant with nothing exact", () => {
    writeConfigFile({});
    process.env.MINIMAX_API_KEY = "sk-base-env";
    assert.equal(getApiKey("minimax-coding-plan"), "sk-base-env");
  });

  test("a plan variant falls back to the base provider's stored key", () => {
    writeConfigFile({ providers: { minimax: { apiKey: "sk-base-stored" } } });
    assert.equal(getApiKey("minimax-coding-plan"), "sk-base-stored");
  });

  test("a missing key names the exact provider's env vars", () => {
    writeConfigFile({});
    assert.throws(() => getApiKey("anthropic"), /ANTHROPIC_API_KEY/);
  });
});

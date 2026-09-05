import { test, describe } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// config.ts resolves CONFIG_FILE from os.homedir() at module load, so point HOME
// at a scratch dir before importing it.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-redact-"));
process.env.HOME = home;
const configFile = path.join(home, ".freecode", "config.json");

const { redactConfig } = await import("./config.js");

function writeConfigFile(config: unknown): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config));
}

const SECRETS = [
  "sk-ant-secret",
  "sk-openai-secret",
  "SID=cookie-secret",
  "xsrf-secret",
  "bearer-secret",
];

describe("redactConfig", () => {
  test("no secret survives, whatever block it sits in", () => {
    writeConfigFile({
      providers: {
        anthropic: { apiKey: SECRETS[0], model: "claude-x", authMode: "oauth" },
        openai: { apiKey: SECRETS[1] },
      },
      web: {
        "gemini-web": {
          cookie: SECRETS[2],
          xsrfToken: SECRETS[3],
          apiKey: SECRETS[4],
          authUser: "1",
        },
      },
      current: { provider: "anthropic", model: "claude-x" },
    });
    const serialized = JSON.stringify(redactConfig());
    for (const secret of SECRETS) {
      assert.ok(!serialized.includes(secret), `leaked ${secret}`);
    }
  });

  test("keeps what a caller actually asked: is a key set, and which model", () => {
    writeConfigFile({
      providers: {
        anthropic: { apiKey: SECRETS[0], model: "claude-x", authMode: "oauth" },
        openai: { apiKey: "" },
      },
      current: { provider: "anthropic", model: "claude-x" },
      lastAgentMode: "build",
      recovery: { fallbackProviders: ["openai"] },
    });
    assert.deepEqual(redactConfig(), {
      providers: {
        anthropic: { hasApiKey: true, model: "claude-x", authMode: "oauth" },
        openai: { hasApiKey: false },
      },
      current: { provider: "anthropic", model: "claude-x" },
      lastAgentMode: "build",
      recovery: { fallbackProviders: ["openai"] },
    });
  });

  test("an anonymous web session reads as no credential, not a missing block", () => {
    writeConfigFile({ web: { "gemini-web": { authUser: "0" } } });
    assert.deepEqual(redactConfig().web, {
      "gemini-web": { hasCredential: false },
    });
  });

  test("an empty config redacts to an empty object", () => {
    writeConfigFile({});
    assert.deepEqual(redactConfig(), {});
  });
});

import { test, describe } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// config.ts resolves CONFIG_FILE from os.homedir() at module load, so point HOME
// at a scratch dir before importing anything that reads it.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-gwsettings-"));
process.env.HOME = home;
const configFile = path.join(home, ".freecode", "config.json");

const { loadGeminiWebSettings } = await import("./settings.js");

function writeConfigFile(config: unknown): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config));
}

function withEnv(value: string | undefined, run: () => void): void {
  const previous = process.env.FREECODE_GEMINI_WEB_TOOLS;
  if (value === undefined) delete process.env.FREECODE_GEMINI_WEB_TOOLS;
  else process.env.FREECODE_GEMINI_WEB_TOOLS = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.FREECODE_GEMINI_WEB_TOOLS;
    else process.env.FREECODE_GEMINI_WEB_TOOLS = previous;
  }
}

describe("gemini-web tool bridge default (spec §10.4)", () => {
  test("on by default: fresh install, nothing configured", () => {
    writeConfigFile({});
    withEnv(undefined, () => {
      assert.equal(loadGeminiWebSettings().experimentalTools, true);
    });
  });

  test("config opt-out turns it off", () => {
    writeConfigFile({ web: { "gemini-web": { experimentalTools: false } } });
    withEnv(undefined, () => {
      assert.equal(loadGeminiWebSettings().experimentalTools, false);
    });
  });

  test("env=0 outranks a config opt-in", () => {
    writeConfigFile({ web: { "gemini-web": { experimentalTools: true } } });
    withEnv("0", () => {
      assert.equal(loadGeminiWebSettings().experimentalTools, false);
    });
  });

  test("env=1 outranks a config opt-out", () => {
    // This is what lets the eval suite force the bridge on regardless of the
    // machine's config, and what lets a broken bridge be killed without
    // editing anyone's config.json.
    writeConfigFile({ web: { "gemini-web": { experimentalTools: false } } });
    withEnv("1", () => {
      assert.equal(loadGeminiWebSettings().experimentalTools, true);
    });
  });
});

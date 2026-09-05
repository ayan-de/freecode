import { test, describe } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// config.ts resolves CONFIG_FILE from os.homedir() at module load, so point HOME
// at a scratch dir before importing it.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-configperms-"));
process.env.HOME = home;
const configFile = path.join(home, ".freecode", "config.json");

const { writeConfig } = await import("./config.js");

const modeOf = (file: string): number => fs.statSync(file).mode & 0o777;

describe("config.json file permissions", () => {
  test("a fresh config.json is created owner-only (0600)", { skip: process.platform === "win32" }, () => {
    fs.rmSync(configFile, { force: true });
    writeConfig({ providers: { anthropic: { apiKey: "sk-test" } } });
    assert.equal(modeOf(configFile), 0o600);
  });

  test("a pre-existing world-readable config.json is locked down on write", { skip: process.platform === "win32" }, () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, "{}", { mode: 0o644 });
    fs.chmodSync(configFile, 0o644);
    writeConfig({ providers: { anthropic: { apiKey: "sk-test" } } });
    assert.equal(modeOf(configFile), 0o600);
  });
});

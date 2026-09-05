import { test, describe } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// config.ts resolves CONFIG_FILE from os.homedir() at module load, so point HOME
// at a scratch dir before importing it.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-configbad-"));
process.env.HOME = home;
const configFile = path.join(home, ".freecode", "config.json");

const { readConfig, writeConfig } = await import("./config.js");

function seedMalformed(): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, '{ "providers": { "anthropic": { "apiKey": "sk-keep", }, }');
}

describe("malformed config.json", () => {
  test("readConfig degrades to empty instead of throwing", () => {
    seedMalformed();
    assert.deepEqual(readConfig(), {});
  });

  test("writeConfig preserves the unparseable original as config.json.invalid", () => {
    seedMalformed();
    writeConfig({ current: { provider: "anthropic", model: "m" } });
    const backup = fs.readFileSync(`${configFile}.invalid`, "utf-8");
    assert.match(backup, /sk-keep/);
    // The new file is valid and readable again.
    assert.equal(readConfig().current?.provider, "anthropic");
  });

  test("a valid pre-existing file is not backed up on write", () => {
    fs.rmSync(`${configFile}.invalid`, { force: true });
    writeConfig({ current: { provider: "openai", model: "m" } });
    writeConfig({ current: { provider: "openai", model: "m2" } });
    assert.equal(fs.existsSync(`${configFile}.invalid`), false);
    assert.equal(readConfig().current?.model, "m2");
  });
});

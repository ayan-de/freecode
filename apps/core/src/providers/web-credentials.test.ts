import { test, describe } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// config.ts resolves CONFIG_FILE from os.homedir() at module load, so point HOME
// at a scratch dir before importing it.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-webcred-"));
process.env.HOME = home;
const configFile = path.join(home, ".freecode", "config.json");

const { readWebCredential, hasWebCredential, setWebCredential, readConfig } =
  await import("./config.js");

function writeConfigFile(config: unknown): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config));
}

describe("web-session credentials", () => {
  test("a provider with no entry at all is anonymous, not broken", () => {
    writeConfigFile({});
    assert.deepEqual(readWebCredential("gemini-web"), {});
    assert.equal(hasWebCredential("gemini-web"), false);
  });

  test("reads the web block", () => {
    writeConfigFile({ web: { "gemini-web": { cookie: "SID=abc" } } });
    assert.equal(readWebCredential("gemini-web").cookie, "SID=abc");
    assert.equal(hasWebCredential("gemini-web"), true);
  });

  test("still honours a cookie left under providers", () => {
    // gemini-web shipped documenting its cookie under providers["gemini-web"].
    // Dropping this read would make an existing cookie stop applying, which
    // surfaces as Pro quietly serving Flash rather than as an error.
    writeConfigFile({ providers: { "gemini-web": { cookie: "SID=old" } } });
    assert.equal(readWebCredential("gemini-web").cookie, "SID=old");
    assert.equal(hasWebCredential("gemini-web"), true);
  });

  test("the web block wins over the legacy providers entry", () => {
    writeConfigFile({
      providers: { "gemini-web": { cookie: "SID=old" } },
      web: { "gemini-web": { cookie: "SID=new" } },
    });
    assert.equal(readWebCredential("gemini-web").cookie, "SID=new");
  });

  test("an empty web entry falls through rather than shadowing", () => {
    writeConfigFile({
      providers: { "gemini-web": { cookie: "SID=old" } },
      web: { "gemini-web": {} },
    });
    assert.equal(readWebCredential("gemini-web").cookie, "SID=old");
  });

  test("authUser alone is not a credential", () => {
    // It modifies a session rather than authenticating one. An entry holding
    // only this is still anonymous and the picker must not claim otherwise.
    writeConfigFile({ web: { "gemini-web": { authUser: "1" } } });
    assert.equal(hasWebCredential("gemini-web"), false);
  });

  test("cookieFile and apiKey both count as a credential", () => {
    writeConfigFile({
      web: { a: { cookieFile: "/tmp/c" }, b: { apiKey: "t" } },
    });
    assert.equal(hasWebCredential("a"), true);
    assert.equal(hasWebCredential("b"), true);
  });

  test("setWebCredential merges, so saving a cookie keeps authUser", () => {
    writeConfigFile({ web: { "gemini-web": { authUser: "2" } } });
    setWebCredential("gemini-web", { cookie: "SID=abc" });
    assert.deepEqual(readWebCredential("gemini-web"), {
      authUser: "2",
      cookie: "SID=abc",
    });
  });

  test("setWebCredential never writes into the metered providers block", () => {
    writeConfigFile({ providers: { minimax: { apiKey: "sk-real" } } });
    setWebCredential("gemini-web", { cookie: "SID=abc" });
    const config = readConfig();
    assert.equal(config.providers?.minimax.apiKey, "sk-real");
    assert.equal(config.providers?.["gemini-web"], undefined);
    assert.equal(config.web?.["gemini-web"].cookie, "SID=abc");
  });
});

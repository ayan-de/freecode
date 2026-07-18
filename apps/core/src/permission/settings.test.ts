import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PermissionSettingsManager } from "./settings.js";

function makeTempProject(): { projectRoot: string; restoreHome: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-perm-"));
  const projectRoot = path.join(base, "project");
  const home = path.join(base, "home");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const prevHome = process.env.HOME;
  process.env.HOME = home; // os.homedir() honors $HOME on POSIX
  return {
    projectRoot,
    restoreHome: () => {
      process.env.HOME = prevHome;
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function writeSettings(dir: string, content: unknown): void {
  fs.mkdirSync(path.join(dir, ".freecode"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".freecode", "settings.json"),
    typeof content === "string" ? content : JSON.stringify(content),
  );
}

test("loads and merges project + user scopes per tier", () => {
  const { projectRoot, restoreHome } = makeTempProject();
  try {
    writeSettings(projectRoot, { permissions: { allow: ["Bash(npm run test:*)"], deny: ["Read(./secrets/**)"] } });
    writeSettings(os.homedir(), { permissions: { allow: ["Grep"], ask: ["Bash(git push:*)"] } });
    const mgr = new PermissionSettingsManager(projectRoot);
    const rules = mgr.getRuleSet();
    assert.deepEqual(rules.allow.map((r) => r.raw), ["Bash(npm run test:*)", "Grep"]);
    assert.deepEqual(rules.ask.map((r) => r.raw), ["Bash(git push:*)"]);
    assert.deepEqual(rules.deny.map((r) => r.raw), ["Read(./secrets/**)"]);
  } finally {
    restoreHome();
  }
});

test("missing and malformed settings files fail closed to empty scopes", () => {
  const { projectRoot, restoreHome } = makeTempProject();
  try {
    writeSettings(projectRoot, "{ not json !!");
    const mgr = new PermissionSettingsManager(projectRoot);
    const rules = mgr.getRuleSet();
    assert.deepEqual(rules.allow, []);
    assert.deepEqual(rules.ask, []);
    assert.deepEqual(rules.deny, []);
  } finally {
    restoreHome();
  }
});

test("session grants join the allow tier only and do not persist", () => {
  const { projectRoot, restoreHome } = makeTempProject();
  try {
    const mgr = new PermissionSettingsManager(projectRoot);
    assert.ok(mgr.addSessionGrant("Write(./src/**)"));
    assert.deepEqual(mgr.getRuleSet().allow.map((r) => r.raw), ["Write(./src/**)"]);
    assert.ok(!fs.existsSync(path.join(projectRoot, ".freecode", "settings.json")));
    assert.ok(!mgr.addSessionGrant("not a rule!!"));
  } finally {
    restoreHome();
  }
});

test("appendRule creates the file, preserves existing keys, dedupes, re-merges", () => {
  const { projectRoot, restoreHome } = makeTempProject();
  try {
    writeSettings(projectRoot, { theme: "dark", permissions: { deny: ["Read(.env*)"] } });
    const mgr = new PermissionSettingsManager(projectRoot);
    assert.ok(mgr.appendRule("project", "allow", "Bash(npm run lint:*)"));
    assert.ok(mgr.appendRule("project", "allow", "Bash(npm run lint:*)")); // dedupe
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(projectRoot, ".freecode", "settings.json"), "utf-8"),
    );
    assert.equal(onDisk.theme, "dark");
    assert.deepEqual(onDisk.permissions.allow, ["Bash(npm run lint:*)"]);
    assert.deepEqual(onDisk.permissions.deny, ["Read(.env*)"]);
    assert.deepEqual(mgr.getRuleSet().allow.map((r) => r.raw), ["Bash(npm run lint:*)"]);

    // user scope writes to ~/.freecode/settings.json
    assert.ok(mgr.appendRule("user", "allow", "Grep"));
    const userDisk = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".freecode", "settings.json"), "utf-8"),
    );
    assert.deepEqual(userDisk.permissions.allow, ["Grep"]);
  } finally {
    restoreHome();
  }
});

test("invalid rule is rejected by appendRule without touching disk", () => {
  const { projectRoot, restoreHome } = makeTempProject();
  try {
    const mgr = new PermissionSettingsManager(projectRoot);
    assert.ok(!mgr.appendRule("project", "allow", "garbage rule (("));
    assert.ok(!fs.existsSync(path.join(projectRoot, ".freecode", "settings.json")));
  } finally {
    restoreHome();
  }
});

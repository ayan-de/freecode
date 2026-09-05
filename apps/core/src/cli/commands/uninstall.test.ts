import { test, describe } from "node:test";
import assert from "node:assert";
import * as path from "node:path";
import { planUninstall } from "./uninstall.js";

const homeDir = "/home/tester";
const configDir = path.join(homeDir, ".freecode");
const launcher = path.join(homeDir, ".local/bin/freecode");
const builds = path.join(configDir, "builds");

/** Everything an installed-and-used freecode has on disk. */
const onDisk = new Set([launcher, configDir, builds]);
const exists = (p: string) => onDisk.has(p);

function plan(purge: boolean): string[] {
  return planUninstall({ homeDir, configDir, purge, exists }).map((t) => t.path);
}

describe("planUninstall", () => {
  test("the default removes the program and keeps the data directory", () => {
    const targets = plan(false);
    assert.deepEqual(targets, [launcher, builds]);
    assert.ok(!targets.includes(configDir), "would delete user data");
  });

  test("--purge takes the data directory, and says so", () => {
    const targets = planUninstall({ homeDir, configDir, purge: true, exists });
    assert.deepEqual(
      targets.map((t) => t.path),
      [launcher, configDir],
    );
    const dataTarget = targets.find((t) => t.path === configDir);
    assert.match(dataTarget!.label, /sessions/);
    assert.match(dataTarget!.label, /memory/);
  });

  test("--purge does not also list builds, which is inside the directory it takes", () => {
    assert.ok(!plan(true).includes(builds));
  });

  test("a launcher that is not on disk is not listed", () => {
    const targets = planUninstall({
      homeDir,
      configDir,
      purge: false,
      exists: (p) => p === builds,
    });
    assert.deepEqual(
      targets.map((t) => t.path),
      [builds],
    );
  });

  test("nothing installed plans nothing, in either mode", () => {
    const none = () => false;
    assert.deepEqual(planUninstall({ homeDir, configDir, purge: false, exists: none }), []);
    assert.deepEqual(planUninstall({ homeDir, configDir, purge: true, exists: none }), []);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import { findUnknownSettings, KNOWN_SETTINGS } from "./known-keys.js";
import { warnOnUnknownSettings } from "./validate.js";

test("a known file produces no warnings", () => {
  assert.deepEqual(
    findUnknownSettings({
      $schema: "https://example.com/settings.schema.json",
      permissions: { allow: ["Bash(git *)"], deny: [] },
      memory: { autoExtract: false, extractEveryNRuns: 4 },
      redirect: { enabled: true },
      hooks: { PostToolUse: [] },
    }),
    [],
  );
});

// The motivating typo: singular "permission" silently disabled every rule.
test("a near-miss top-level key suggests the right one", () => {
  const [warning, ...rest] = findUnknownSettings({ permission: { allow: [] } });
  assert.deepEqual(rest, []);
  assert.equal(warning.path, "permission");
  assert.match(warning.message, /did you mean "permissions"/);
});

test("an unrecognizable top-level key lists what is known", () => {
  const [warning] = findUnknownSettings({ telemetry: { enabled: true } });
  assert.match(warning.message, /known settings: permissions, hooks, memory, redirect/);
});

test("a typo inside a section is reported with its full path", () => {
  const [warning] = findUnknownSettings({ memory: { autoExtractt: true } });
  assert.equal(warning.path, "memory.autoExtractt");
  assert.match(warning.message, /did you mean "memory\.autoExtract"/);
});

// hooks sub-keys are event names, and hooks/settings.ts already reports an
// unknown one with the full valid list. Warning here too would say the same
// thing twice, in different words.
test("hook event names are left to the hooks loader", () => {
  assert.deepEqual(findUnknownSettings({ hooks: { NotAnEvent: [] } }), []);
});

test("a wrong-typed section is left to its own reader", () => {
  assert.deepEqual(findUnknownSettings({ permissions: "yes" }), []);
});

test("warnOnUnknownSettings reads the project scope and names the file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-settings-"));
  try {
    fs.mkdirSync(path.join(dir, ".freecode"));
    fs.writeFileSync(
      path.join(dir, ".freecode", "settings.json"),
      JSON.stringify({ permission: { allow: [] } }),
    );

    const emitted = warnOnUnknownSettings(dir);
    const projectWarnings = emitted.filter((m) => m.includes(dir));

    assert.equal(projectWarnings.length, 1);
    assert.match(projectWarnings[0], /did you mean "permissions"/);
    assert.match(projectWarnings[0], /settings\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing settings file is silent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-settings-"));
  try {
    assert.deepEqual(
      warnOnUnknownSettings(dir).filter((m) => m.includes(dir)),
      [],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Two descriptions of the same file — one for editors, one for the runtime
// warning — drift the moment a key is added to only one of them.
test("the shipped JSON Schema and the runtime key list agree", () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
  );
  const schema = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "schemas", "settings.schema.json"), "utf-8"),
  ) as {
    properties: Record<string, { properties?: Record<string, unknown> }>;
  };

  const schemaTopLevel = Object.keys(schema.properties).filter(
    (k) => k !== "$schema",
  );
  assert.deepEqual(schemaTopLevel.sort(), Object.keys(KNOWN_SETTINGS).sort());

  for (const [section, known] of Object.entries(KNOWN_SETTINGS)) {
    if (known === "any") continue;
    assert.deepEqual(
      Object.keys(schema.properties[section].properties ?? {}).sort(),
      [...known].sort(),
      `${section} keys differ between the schema and known-keys.ts`,
    );
  }
});

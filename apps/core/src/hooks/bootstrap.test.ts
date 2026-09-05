// =============================================================================
// The hook bootstrap is shared by `freecode serve` and `freecode run`.
// Before it existed, HookSettingsManager + registerRtkHook were constructed
// inside startServer() only, so a headless run loaded no settings.json hooks:
// the same repo behaved differently depending on which entrypoint ran it.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { initHooks } from "./bootstrap.js";
import { getHooksForEvent, unregisterAllHooks } from "./registry.js";

function projectWithHook(): string {
  const root = mkdtempSync(join(tmpdir(), "freecode-hook-bootstrap-"));
  mkdirSync(join(root, ".freecode"), { recursive: true });
  writeFileSync(
    join(root, ".freecode", "settings.json"),
    JSON.stringify({
      hooks: {
        PostToolUse: [{ name: "fmt", command: "true" }],
      },
    }),
  );
  return root;
}

test("initHooks registers project settings.json hooks", () => {
  unregisterAllHooks("settings");
  const root = projectWithHook();
  const manager = initHooks(root);
  try {
    const names = getHooksForEvent("PostToolUse").map((h) => h.name);
    assert.ok(
      names.includes("fmt"),
      `expected the settings.json hook to be registered, got: ${names.join(", ")}`,
    );
  } finally {
    manager.dispose();
    unregisterAllHooks("settings");
  }
});

test("initHooks does not watch unless asked", () => {
  unregisterAllHooks("settings");
  const root = projectWithHook();
  // A one-shot `freecode run` must not leave an fs watcher holding the loop
  // open past its last turn; dispose is still safe to call either way.
  const manager = initHooks(root, { watch: false });
  manager.dispose();
  const watched = initHooks(root, { watch: true });
  watched.dispose();
  unregisterAllHooks("settings");
});

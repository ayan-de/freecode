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

// --- board webhook -----------------------------------------------------------
// The webhook exists to be registered by bootstrap: registering it anywhere
// else is how `serve` and `run` diverged last time.

test("initHooks registers board-webhook hooks when FREECODE_HOOK_URL is set", () => {
  unregisterAllHooks("settings");
  process.env.FREECODE_HOOK_URL = "http://127.0.0.1:1/hooks/SES-01";
  const root = projectWithHook();
  const manager = initHooks(root);
  try {
    const names = getHooksForEvent("Stop").map((h) => h.name);
    assert.ok(
      names.includes("board-webhook-Stop"),
      `expected the board webhook to be registered, got: ${names.join(", ")}`,
    );
  } finally {
    manager.dispose();
    delete process.env.FREECODE_HOOK_URL;
    unregisterAllHooks("settings");
    unregisterAllHooks("session");
  }
});

test("initHooks registers no board-webhook hooks without FREECODE_HOOK_URL", () => {
  unregisterAllHooks("settings");
  unregisterAllHooks("session");
  delete process.env.FREECODE_HOOK_URL;
  const root = projectWithHook();
  const manager = initHooks(root);
  try {
    const names = getHooksForEvent("Stop").map((h) => h.name);
    assert.ok(
      !names.some((n) => n.startsWith("board-webhook-")),
      `expected no board webhook, got: ${names.join(", ")}`,
    );
  } finally {
    manager.dispose();
    unregisterAllHooks("settings");
    unregisterAllHooks("session");
  }
});

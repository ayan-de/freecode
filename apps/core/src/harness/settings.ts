// =============================================================================
// Continual Harness Settings
// PRIMARY: harness.enabled, off by default (spec §9 — this changes agent
// behaviour in every future session, so it ships opt-in). Same scope chain
// and same "malformed file falls through to defaults" behaviour as
// memory/extract-policy.ts's loadMemorySettings — deliberately kept
// consistent rather than inventing a second settings convention.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface HarnessSettings {
  enabled: boolean;
}

function readScope(filePath: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      harness?: Record<string, unknown>;
    };
    return parsed.harness;
  } catch {
    return undefined;
  }
}

// Priority chain, first definition wins: project -> user -> default (off).
export function loadHarnessSettings(projectRoot: string): HarnessSettings {
  const scopes = [
    path.join(projectRoot, ".freecode", "settings.json"),
    path.join(os.homedir(), ".freecode", "settings.json"),
  ];

  let enabled: boolean | undefined;
  for (const file of scopes) {
    const harness = readScope(file);
    if (!harness) continue;
    if (enabled === undefined && typeof harness.enabled === "boolean") {
      enabled = harness.enabled;
    }
  }

  return { enabled: enabled ?? false };
}

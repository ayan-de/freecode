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

export interface AutoDistillSettings {
  /** Phase 4 master switch. Off until there are real cost numbers (spec §9). */
  enabled: boolean;
  /** Cumulative transcript turns between automatic distillations. */
  turnInterval: number;
  /** Also consider distilling at a compaction boundary (cache cost sunk). */
  compact: boolean;
  /** Wall-clock floor between distillations — 25 turns can be 4min or 4h. */
  cooldownMs: number;
}

export interface HarnessSettings {
  enabled: boolean;
  autoDistill: AutoDistillSettings;
}

// Prime-agent's AutoRefineSettings defaults, unchanged pending real data —
// except `enabled`, which is false here because our Phase 4 ships off (§9).
const DEFAULT_AUTO_DISTILL: AutoDistillSettings = {
  enabled: false,
  turnInterval: 25,
  compact: true,
  cooldownMs: 20 * 60 * 1000,
};

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
  const auto: Partial<AutoDistillSettings> = {};
  for (const file of scopes) {
    const harness = readScope(file);
    if (!harness) continue;
    if (enabled === undefined && typeof harness.enabled === "boolean") {
      enabled = harness.enabled;
    }
    // Field-by-field, first scope that defines a field wins — so a project can
    // shorten the interval without having to restate the whole block.
    const block = harness.autoDistill;
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    if (auto.enabled === undefined && typeof b.enabled === "boolean") {
      auto.enabled = b.enabled;
    }
    if (
      auto.turnInterval === undefined &&
      typeof b.turnInterval === "number" &&
      b.turnInterval >= 1
    ) {
      auto.turnInterval = Math.floor(b.turnInterval);
    }
    if (auto.compact === undefined && typeof b.compact === "boolean") {
      auto.compact = b.compact;
    }
    if (
      auto.cooldownMs === undefined &&
      typeof b.cooldownMs === "number" &&
      b.cooldownMs >= 0
    ) {
      auto.cooldownMs = b.cooldownMs;
    }
  }

  return {
    enabled: enabled ?? false,
    autoDistill: { ...DEFAULT_AUTO_DISTILL, ...auto },
  };
}

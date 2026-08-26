// =============================================================================
// Redirect settings — project → user → default, mirroring loadMemorySettings()
// (`memory/extract-policy.ts`) so the two never disagree about scope order.
//
// **Off by default (D8).** Shipping this on and then measuring would mean every
// user pays for an unvalidated model call on a signal we already know produced
// false positives before Phase 0. The flip criterion is written down in §9 of
// the spec so it is a fact, not a judgement call.
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { REDIRECT_MAX_PER_RUN } from "./policy.js";

const ENV_DISABLE = "FREECODE_DISABLE_REDIRECT";

export interface RedirectSettings {
  enabled: boolean;
  maxPerRun: number;
}

function readScope(filePath: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      redirect?: Record<string, unknown>;
    };
    return parsed.redirect;
  } catch {
    // Missing or malformed → the next scope decides, then the defaults.
    return undefined;
  }
}

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function loadRedirectSettings(projectRoot: string): RedirectSettings {
  const scopes = [
    path.join(projectRoot, ".freecode", "settings.json"),
    path.join(os.homedir(), ".freecode", "settings.json"),
  ];

  let enabled: boolean | undefined;
  let maxPerRun: number | undefined;
  for (const file of scopes) {
    const redirect = readScope(file);
    if (!redirect) continue;
    if (enabled === undefined && typeof redirect.enabled === "boolean") {
      enabled = redirect.enabled;
    }
    if (
      maxPerRun === undefined &&
      typeof redirect.maxPerRun === "number" &&
      redirect.maxPerRun >= 0
    ) {
      maxPerRun = Math.floor(redirect.maxPerRun);
    }
  }

  return {
    enabled: (enabled ?? false) && !isEnvTruthy(process.env[ENV_DISABLE]),
    maxPerRun: maxPerRun ?? REDIRECT_MAX_PER_RUN,
  };
}

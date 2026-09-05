// =============================================================================
// Read both settings scopes and report keys nothing in this codebase reads.
//
// Every reader of settings.json ignores what it does not recognise, which
// meant a typo was invisible: `"permission"` for `"permissions"` disabled
// every rule and looked exactly like the permission system being broken.
// This runs once per process, at bootstrap, and says so on stderr.
//
// Warn only. A settings file with an unknown key is still a usable settings
// file, and refusing to start over a stray key would be a far worse failure
// than the one being fixed.
// =============================================================================

import * as fs from "fs";
import { settingsPath, type RuleScope } from "../permission/settings.js";
import { findUnknownSettings } from "./known-keys.js";
import { logger } from "../utils/logger.js";

/**
 * Returns the warnings it emitted, so a caller (or a test) can see them
 * without scraping the log.
 */
export function warnOnUnknownSettings(projectRoot: string): string[] {
  const emitted: string[] = [];

  for (const scope of ["project", "user"] as const satisfies RuleScope[]) {
    const filePath = settingsPath(scope, projectRoot);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (error) {
      // ENOENT is the normal case. A parse failure is already reported by
      // each reader as it fails closed, and saying it a fifth time here
      // helps nobody.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn(`[Settings] Could not read ${filePath}: ${error}`);
      }
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logger.warn(`[Settings] ${filePath} is not a JSON object — ignoring it.`);
      continue;
    }

    for (const warning of findUnknownSettings(
      parsed as Record<string, unknown>,
    )) {
      const message = `[Settings] ${warning.message} (${filePath})`;
      logger.warn(message);
      emitted.push(message);
    }
  }

  return emitted;
}

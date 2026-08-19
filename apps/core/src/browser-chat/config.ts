// =============================================================================
// Browser Chat — configuration
//
// Reads the optional `browser` block from ~/.freecode/config.json. Deliberately
// does NOT add a field to the shared `Config` interface: keeping the shape
// local means deleting this folder removes the feature with no edits elsewhere
// (see the delink section of the spec).
// =============================================================================

import * as os from "os";
import * as path from "path";
import { readConfig } from "../providers/config.js";
import type { BrowserChatConfig } from "./types.js";

export const BROWSER_CHAT_DEFAULTS: BrowserChatConfig = {
  transport: "extension",
  bridgePort: 8765,
  cdpUrl: "http://localhost:9222",
  autoLaunch: true,
  binary: "",
  profileDir: path.join(os.homedir(), ".freecode", "browser-profile"),
  headless: false,
  threadBudgetChars: 400_000,
  maxToolResultChars: 4_000,
  maxRepairAttempts: 3,
  threadPoolSize: 2,
  ledgerMaxAgeChars: 150_000,
  subagentProvider: "inherit",
};

// Hand-edited JSON puts numbers and booleans in quotes often enough that
// coercing is cheaper than a confusing "must be a number" failure at Phase 1.
function positiveNumber(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Pure: merge a raw `browser` block over the defaults. */
export function resolveBrowserChatConfig(
  raw: Record<string, unknown>,
): BrowserChatConfig {
  const d = BROWSER_CHAT_DEFAULTS;
  return {
    transport: raw.transport === "cdp" ? "cdp" : d.transport,
    bridgePort: positiveNumber(raw.bridgePort, d.bridgePort),
    cdpUrl: nonEmptyString(raw.cdpUrl, d.cdpUrl),
    autoLaunch: boolean(raw.autoLaunch, d.autoLaunch),
    binary: typeof raw.binary === "string" ? raw.binary : d.binary,
    profileDir: nonEmptyString(raw.profileDir, d.profileDir),
    headless: boolean(raw.headless, d.headless),
    threadBudgetChars: positiveNumber(
      raw.threadBudgetChars,
      d.threadBudgetChars,
    ),
    maxToolResultChars: positiveNumber(
      raw.maxToolResultChars,
      d.maxToolResultChars,
    ),
    maxRepairAttempts: positiveNumber(
      raw.maxRepairAttempts,
      d.maxRepairAttempts,
    ),
    threadPoolSize: positiveNumber(raw.threadPoolSize, d.threadPoolSize),
    ledgerMaxAgeChars: positiveNumber(
      raw.ledgerMaxAgeChars,
      d.ledgerMaxAgeChars,
    ),
    subagentProvider: nonEmptyString(raw.subagentProvider, d.subagentProvider),
  };
}

export function readBrowserChatConfig(): BrowserChatConfig {
  const raw =
    (readConfig() as { browser?: Record<string, unknown> }).browser ?? {};
  const resolved = resolveBrowserChatConfig(raw);
  // CDP_URL is the env var the legacy browser/ controller honoured, so an
  // existing local setup keeps working.
  const fromEnv = process.env.CDP_URL;
  return fromEnv ? { ...resolved, cdpUrl: fromEnv } : resolved;
}

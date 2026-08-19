// =============================================================================
// Browser Chat — browser auto-launch
//
// WHY THIS EXISTS: Chromium only accepts --remote-debugging-port at startup.
// There is no way to enable it on an already-running browser, so "just use the
// window I already have open" is not achievable over CDP. Rather than making
// the user run a flag-laden command, we launch it for them.
//
// The profile directory is persistent and dedicated, which means the user logs
// in ONCE, ever — not once per run — and their day-to-day browser profile is
// never touched, locked, or read.
// =============================================================================

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../../utils/logger.js";

const CANDIDATES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "brave",
  "microsoft-edge-stable",
  // macOS bundles are not on PATH.
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

export function findBrowserBinary(explicit?: string): string | null {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;

  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const candidate of CANDIDATES) {
    if (candidate.startsWith("/")) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    for (const dir of dirs) {
      const full = path.join(dir, candidate);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

function portOf(cdpUrl: string): number {
  try {
    return Number(new URL(cdpUrl).port) || 9222;
  } catch {
    return 9222;
  }
}

async function isPortLive(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/json/version", cdpUrl), {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface LaunchOptions {
  cdpUrl: string;
  profileDir: string;
  binary?: string;
  headless: boolean;
  startUrl?: string;
  timeoutMs?: number;
}

/**
 * Starts a browser with debugging enabled and waits for it to answer.
 * Detached on purpose: the window outlives this process, so the login stays
 * warm between `freecode` runs.
 */
export async function launchBrowser(opts: LaunchOptions): Promise<void> {
  if (await isPortLive(opts.cdpUrl)) return; // already running — reuse it

  const binary = findBrowserBinary(opts.binary);
  if (!binary) {
    throw new Error(
      "No Chrome/Chromium-based browser found. Install one, or set " +
        "browser.binary in ~/.freecode/config.json to its full path.",
    );
  }

  fs.mkdirSync(opts.profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${portOf(opts.cdpUrl)}`,
    `--user-data-dir=${opts.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(opts.headless ? ["--headless=new"] : []),
    ...(opts.startUrl ? [opts.startUrl] : []),
  ];

  logger.info("browser-chat: launching browser", { binary });
  const child = spawn(binary, args, { detached: true, stdio: "ignore" });
  child.unref();

  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    if (await isPortLive(opts.cdpUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `Launched ${path.basename(binary)} but it never opened a debugging port ` +
      `at ${opts.cdpUrl}. If a window did appear, close ALL of its windows and ` +
      `try again — an already-running browser ignores the debugging flag.`,
  );
}

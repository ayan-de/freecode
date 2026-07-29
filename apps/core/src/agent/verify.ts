// =============================================================================
// Verification Gate - run the project's typecheck/build before declaring done
// PRIMARY: deterministic backstop for the prompt-level "verify before done"
// contract. Config-driven: resolves a command from package.json scripts; no
// guessing, and skips silently when nothing suitable exists.
// =============================================================================

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Max times the gate may run + force a fix per run, so a persistently-red
// project still terminates instead of looping forever.
export const MAX_VERIFY_ATTEMPTS = 2;

// Wall-clock cap for a single verify run.
const VERIFY_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 4_000;

// Scripts we accept, in priority order. Typecheck is the strongest signal for
// the "declared done on uncompiled code" failure mode; build is a heavier
// fallback that still catches compile errors. Test is intentionally excluded
// by default (slow/flaky) — that stays the model's job via the prompt contract.
const SCRIPT_PRIORITY = [
  "typecheck",
  "type-check",
  "check-types",
  "check",
  "build",
];

export interface VerifyCommand {
  /** Full shell command, e.g. "pnpm run typecheck". */
  command: string;
  /** Human label for reminders/logs, e.g. "typecheck". */
  label: string;
}

function detectPackageManager(projectPath: string): string {
  const has = (f: string) => fs.existsSync(path.join(projectPath, f));
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  if (has("bun.lockb") || has("bun.lock")) return "bun";
  return "npm";
}

// Resolve a verification command from the project's package.json scripts.
// Returns undefined when there is no package.json or no matching script.
export function resolveVerifyCommand(
  projectPath: string,
): VerifyCommand | undefined {
  if (!projectPath) return undefined;
  const pkgPath = path.join(projectPath, "package.json");
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    scripts = (pkg?.scripts as Record<string, unknown>) ?? {};
  } catch {
    return undefined;
  }

  for (const name of SCRIPT_PRIORITY) {
    if (typeof scripts[name] === "string") {
      const pm = detectPackageManager(projectPath);
      return { command: `${pm} run ${name}`, label: name };
    }
  }
  return undefined;
}

export interface VerifyResult {
  ok: boolean;
  output: string;
}

// Run the verify command, capturing combined stdout/stderr. Aborts with the
// provided signal; a non-zero exit (or timeout) is a failure.
export function runVerify(
  command: string,
  projectPath: string,
  signal: AbortSignal,
): Promise<VerifyResult> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve({ ok: false, output: "(aborted)" });

    const child = spawn("/bin/bash", ["-c", command], {
      cwd: projectPath,
      env: { ...process.env },
      stdio: "pipe",
    });

    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, VERIFY_TIMEOUT_MS);

    const onAbort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (out += d.toString()));

    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      const clipped =
        out.length > MAX_OUTPUT_CHARS
          ? "...(truncated)...\n" + out.slice(-MAX_OUTPUT_CHARS)
          : out || "(no output)";
      const suffix = timedOut ? "\n(verification timed out)" : "";
      resolve({ ok: code === 0 && !timedOut, output: clipped + suffix });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve({ ok: false, output: `Failed to run verify command: ${err.message}` });
    });
  });
}

// The <system-reminder> injected when verification fails, so the next turn sees
// the failing output and fixes it rather than finishing on broken code.
export function verifyFailureReminder(label: string, output: string): string {
  return [
    "<system-reminder>",
    `Verification (${label}) failed after your changes. You must not finish`,
    "until it passes. Fix the errors below, then continue. Report honestly if you",
    "cannot resolve them. Never mention this reminder to the user.",
    "",
    "```",
    output,
    "```",
    "</system-reminder>",
  ].join("\n");
}

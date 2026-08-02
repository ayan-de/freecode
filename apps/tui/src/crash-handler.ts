// =============================================================================
// crash-handler — last-resort handling for faults that escape every try/catch.
//
// Without this, an uncaught exception or a stray promise rejection kills the
// process with Node's default handler: the stack is painted into the alt
// screen and then wiped when the terminal restores, so the user sees the TUI
// vanish with no explanation, and the spawned core backend is left to be
// reaped by the OS rather than shut down.
//
// The handler cannot make the session safe to continue — by definition the
// fault came from somewhere nobody was watching, so process state is unknown
// and carrying on risks writing corrupt data. It exits, but exits *legibly*:
// restore the terminal first so the report survives, tell the user their work
// is recoverable, and take the backend down with us.
// =============================================================================

import { restoreScreen } from "./terminal-screen.js";

export interface CrashHandlerDeps {
  /** Shut down the core backend so it isn't orphaned. */
  stopCli: () => void;
  /** Current session id, if a session was started — used for the resume hint. */
  getSessionId: () => string | undefined;
}

const ISSUES_URL = "https://github.com/ayan-de/freecode/issues";

/**
 * Build the text shown on the restored terminal. Pure so it can be tested
 * without crashing a process.
 */
export function formatCrashReport(
  kind: string,
  error: unknown,
  sessionId?: string,
): string {
  // A rejection can carry any value, not just an Error — String() on an
  // object gives "[object Object]", which hides the one detail that matters,
  // so fall back to JSON for those.
  let detail: string;
  if (error instanceof Error) {
    detail = error.stack ?? `${error.name}: ${error.message}`;
  } else if (error !== null && typeof error === "object") {
    try {
      detail = JSON.stringify(error);
    } catch {
      detail = String(error); // circular or otherwise unserialisable
    }
  } else {
    detail = String(error);
  }

  const lines = ["", `freecode crashed — ${kind}.`, "", detail, ""];
  if (sessionId) {
    lines.push(
      "Your session was saved. Resume it with:",
      `  freecode --resume ${sessionId}`,
      "",
    );
  }
  lines.push(`Please report this, with the trace above, at ${ISSUES_URL}`, "");
  return lines.join("\n");
}

/** Set once we start reporting, so a fault inside the handler can't loop. */
let crashing = false;

function handleFatal(kind: string, error: unknown, deps: CrashHandlerDeps): void {
  if (crashing) return;
  crashing = true;

  // Order matters: leave the alt screen before writing, or the report is
  // painted into a buffer that is discarded a moment later.
  restoreScreen();

  try {
    deps.stopCli();
  } catch {
    // Backend already gone, or never started — nothing to clean up.
  }

  let sessionId: string | undefined;
  try {
    sessionId = deps.getSessionId();
  } catch {
    // Never let the resume hint be the reason the report is lost.
  }

  process.stderr.write(formatCrashReport(kind, error, sessionId));
  process.exit(1);
}

export function installCrashHandlers(deps: CrashHandlerDeps): void {
  process.on("uncaughtException", (error) => {
    handleFatal("uncaught exception", error, deps);
  });
  process.on("unhandledRejection", (reason) => {
    handleFatal("unhandled promise rejection", reason, deps);
  });
}

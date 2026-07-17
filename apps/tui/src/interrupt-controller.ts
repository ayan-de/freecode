// =============================================================================
// InterruptController — single source of truth for Ctrl+C handling.
//
// Mirrors Claude Code's split of two concerns (useExitOnCtrlCD + useDoublePress):
//   • A turn is streaming → Ctrl+C cancels it and *consumes* the press. It does
//     not move toward exit, so you never quit by accident right after
//     interrupting a long turn.
//   • Idle                → time-based double-press. First press arms exit
//     ("press again"); a second within `exitWindowMs` quits and prints the
//     "resume with…" hint.
//
// The policy lives here as a small state machine so index.ts's input listener
// stays a one-liner and the cancel/exit rules are testable in isolation.
// =============================================================================

import chalk from "chalk";

// Matches Claude Code's DOUBLE_PRESS_TIMEOUT_MS.
const DOUBLE_PRESS_TIMEOUT_MS = 800;

export interface InterruptDeps {
  // True while a turn is streaming — Ctrl+C then cancels it instead of exiting.
  isTurnActive: () => boolean;
  // Cancel the in-flight turn (calls session.stop under the hood).
  cancelTurn: () => void;
  // Show a transient message in the UI.
  notify: (text: string) => void;
  // Session id printed in the resume hint on exit (null = no session yet).
  getSessionId: () => string | null;
  // Tear down the TUI right before the process exits.
  shutdown: () => void;
}

export interface InterruptOptions {
  // Window in which a confirming second Ctrl+C exits. Defaults to 800ms.
  exitWindowMs?: number;
}

export class InterruptController {
  private armed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hintPrinted = false;
  private readonly exitWindowMs: number;

  constructor(
    private readonly deps: InterruptDeps,
    options: InterruptOptions = {},
  ) {
    this.exitWindowMs = options.exitWindowMs ?? DOUBLE_PRESS_TIMEOUT_MS;
  }

  // Call on every Ctrl+C keypress.
  handle(): void {
    // A running turn takes priority and consumes the press: cancel it, do not
    // arm exit.
    if (this.deps.isTurnActive()) {
      this.deps.cancelTurn();
      this.deps.notify("*Interrupted.*");
      return;
    }

    // Idle: require a confirming second press within the window.
    if (this.armed) {
      this.exit();
      return;
    }
    this.deps.notify("*Press Ctrl+C again to exit.*");
    this.arm();
  }

  private arm(): void {
    this.armed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.armed = false;
      this.timer = null;
    }, this.exitWindowMs);
  }

  private exit(): void {
    if (this.timer) clearTimeout(this.timer);
    this.deps.shutdown();
    this.printResumeHint();
    process.exit(0);
  }

  // Printed after shutdown() so it lands on the restored terminal. Only for
  // interactive TTYs with a live session, and only once.
  private printResumeHint(): void {
    if (this.hintPrinted || !process.stdout.isTTY) return;
    const sessionId = this.deps.getSessionId();
    if (!sessionId) return;
    process.stdout.write(
      chalk.dim(`\nResume this session with:\nfreecode --resume ${sessionId}\n`),
    );
    this.hintPrinted = true;
  }
}

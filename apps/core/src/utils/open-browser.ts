// =============================================================================
// openBrowser — cross-platform "open a URL in the user's default browser".
//
// Used by both `freecode web` (the web frontend) and the graph explorer
// (`/graph`). Promoted out of cli/commands/web.ts so the explorer doesn't
// duplicate the platform-detection exec call. Errors are logged, never
// thrown — failing to spawn a browser should not crash the command.
// =============================================================================

import { exec } from "child_process";

export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} ${url}`, (err) => {
    if (err) {
      // Don't throw — the server is already up and the user can open the URL
      // manually. Log to stderr so it surfaces in the TUI's stderr handler
      // and any CLI invocation alike.
      process.stderr.write(`Failed to open browser: ${err.message}\n`);
    }
  });
}

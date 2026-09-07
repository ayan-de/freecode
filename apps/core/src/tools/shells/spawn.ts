// =============================================================================
// Shared shell spawn — the process-group + prompt-hardening setup that both the
// foreground bash tool and the background shell registry depend on.
//
// `detached` puts the shell in its own process group so a kill can signal the
// whole tree. Without it, `npm test` (npm -> vitest -> workers) leaves
// grandchildren alive after the shell dies.
//
// stdin is "ignore" so the child gets EOF immediately: anything that would
// block on a password prompt (git push over HTTPS, sudo, apt) exits with an
// error instead of hanging.
// =============================================================================

import { spawn, type ChildProcess } from "child_process";

export interface SpawnedShell {
  child: ChildProcess;
  /** Signals the process group, falling back to the direct child. */
  killTree: (signal: NodeJS.Signals) => void;
}

export function spawnShell(command: string, cwd: string): SpawnedShell {
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "cmd.exe" : "/bin/bash";
  const shellArgs = isWindows ? ["/c", command] : ["-c", command];

  const child = spawn(shell, shellArgs, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      DEBIAN_FRONTEND: "noninteractive",
      APT_LISTCHANGES_FRONTEND: "none",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows,
  });

  const killTree = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    try {
      if (isWindows) child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  };

  return { child, killTree };
}

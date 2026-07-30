// =============================================================================
// fd binary resolution
// pi-tui's CombinedAutocompleteProvider drives `@` file mentions by shelling
// out to fd (fast, respects .gitignore). Handed `null` it returns no `@`
// suggestions at all, so the editor needs a real path here.
// Mirrors how tools/grep.ts already assumes ripgrep is on PATH.
// =============================================================================

import { spawnSync } from "child_process";

// Debian/Ubuntu ship fd as `fdfind` to avoid a name clash.
const FD_BINARIES = ["fd", "fdfind"];

let cached: string | null | undefined;

function commandExists(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ["--version"], { stdio: "ignore" });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Path (or bare command name) of an fd binary on PATH, or `null` when fd is
 * not installed — in which case `@` completion stays inert rather than
 * breaking the editor. Resolved once per process: the probe spawns a child.
 */
export function resolveFdPath(): string | null {
  if (cached !== undefined) return cached;
  cached = FD_BINARIES.find(commandExists) ?? null;
  return cached;
}

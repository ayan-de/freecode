// =============================================================================
// Autonomous Runs Gate — verification command runner + worktree-unchanged skip
// PRIMARY: runs the user-supplied verifyCommand after a turn, and skips
// re-running it when the git worktree hasn't changed since the last failure
// (so a stuck model can't burn budget re-running an expensive test suite
// against code it hasn't touched). Direct port of prime-agent's
// captureGitWorktreeSnapshot / gate-skip logic (§3.1).
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md, §3.1, §5.2
// Phase 1: gate mechanics only — not yet wired into the agent loop's turn
// cycle (that wiring is the risky, not-yet-attempted part of this phase).
// =============================================================================

import { execFileSync } from "child_process";

export interface GateResult {
  passed: boolean;
  output: string;
  skipped: boolean;
}

/**
 * git status --porcelain + git diff, concatenated. Good enough as a change
 * fingerprint: any tracked-file edit or new/removed file changes this string.
 * Untracked file *content* changes are covered by `git diff` only once added;
 * matches prime-agent's documented scope for this check (§3.1).
 */
export function captureGitWorktreeSnapshot(cwd: string): string {
  try {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf-8",
    });
    const diff = execFileSync("git", ["diff"], { cwd, encoding: "utf-8" });
    return `${status}\n---\n${diff}`;
  } catch {
    // Not a git repo, or git unavailable — never skip in that case, since
    // there is no fingerprint to compare against.
    return "";
  }
}

/** Run the verify command. Never throws — a nonzero exit is a failed gate, not a crash. */
export function runGateCommand(command: string, cwd: string): GateResult {
  try {
    const output = execFileSync(command, {
      cwd,
      encoding: "utf-8",
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { passed: true, output, skipped: false };
  } catch (err) {
    const output =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout?: unknown }).stdout ?? "") +
          String((err as { stderr?: unknown }).stderr ?? "")
        : String(err);
    return { passed: false, output, skipped: false };
  }
}

/**
 * If the worktree snapshot is unchanged since the last gate failure, skip
 * re-running the gate command and report the prior failure again — this is
 * the budget-protecting behaviour §3.1/§5.2 call out by name.
 */
export function runGate(
  command: string,
  cwd: string,
  previousSnapshot: string | undefined,
  previousResult: GateResult | undefined,
): { result: GateResult; snapshot: string } {
  const snapshot = captureGitWorktreeSnapshot(cwd);
  if (
    previousSnapshot !== undefined &&
    previousResult !== undefined &&
    !previousResult.passed &&
    snapshot === previousSnapshot &&
    snapshot !== ""
  ) {
    return {
      result: { ...previousResult, skipped: true },
      snapshot,
    };
  }
  return { result: runGateCommand(command, cwd), snapshot };
}

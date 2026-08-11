// =============================================================================
// Autonomous Runs Permissions — seed the `unattended` rule set
// PRIMARY: writes .freecode/settings.json into the run's worktree before the
// loop starts, so the *existing* permission/rules.ts allow/ask/deny machinery
// (not a new mechanism — spec §4.8 is explicit about reusing it) scopes what
// an unattended run can do: file writes inside the worktree, the verify
// command allowed by exact match, network off.
//
// Deliberately NOT a wildcard deny-everything-else rule for bash: the rule
// tiers are deny > ask > allow (evaluate.ts), so a "match everything" deny
// rule would also shadow the exact-match allow for the verify command
// itself — there's no negation in this rule language to express "deny
// anything except X". Anything other than the verify command instead falls
// through to build mode's default ("ask" for a mutating/network tool),
// which — with no human present — times out to deny after 30 minutes
// (bus/index.ts's PROMPT_TIMEOUT_MS; prompt.ts: "Headless or timed-out asks
// resolve to deny — never silent allow"). Fails closed, but a single
// unanticipated tool call can stall a run for up to 30 minutes before that
// happens — a real cost against the wall-clock budget, not a false claim of
// instant denial.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md, §4.8
// =============================================================================

import * as fs from "fs";
import * as path from "path";

export function writeUnattendedPermissions(
  worktreePath: string,
  verifyCommand: string,
): void {
  const dir = path.join(worktreePath, ".freecode");
  fs.mkdirSync(dir, { recursive: true });
  const settings = {
    permissions: {
      allow: ["Write(**)", "Edit(**)", `Bash(${verifyCommand})`],
      // Webfetch/Websearch as bare tool names (no pattern) match any call to
      // that tool unconditionally — see rules.ts's ruleMatches. No wildcard
      // bash deny here — see the file header for why that would backfire.
      deny: ["Webfetch", "Websearch"],
    },
  };
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf-8",
  );
}

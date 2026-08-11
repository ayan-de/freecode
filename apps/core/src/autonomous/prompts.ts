// =============================================================================
// Autonomous Runs Prompts — continuation message on gate failure
// PRIMARY: the safety-culture string (§3.1) telling the model it does not
// decide when it's done — the gate does — plus the failure detail so the
// model has something concrete to act on.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md, §3.1
// =============================================================================

import type { GateResult } from "./gate.js";

const AUTONOMOUS_PREFACE =
  "No human input is available in this autonomous run. Continue working " +
  "until the verify command passes or the run's budget is exhausted. Do " +
  "not end the session yourself; the verify command decides completion.";

export function buildGateFailureContinuation(
  verifyCommand: string,
  gate: GateResult,
): string {
  const workspaceNote = gate.skipped
    ? "The workspace has not changed since the last failure — no point re-running the verify command until you make an edit."
    : `The verify command's output:\n\n${gate.output.slice(0, 4000)}`;
  return [
    AUTONOMOUS_PREFACE,
    "",
    `Verify command: \`${verifyCommand}\``,
    workspaceNote,
  ].join("\n");
}

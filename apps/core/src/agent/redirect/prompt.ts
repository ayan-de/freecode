// =============================================================================
// Supervisor prompt + the reminder its answer becomes.
// PURE: string building only. Spec: 2026-08-26-trajectory-redirection.md, D5.
// =============================================================================

import { EVIDENCE_CHAR_CAP, type EvidencePacket } from "./evidence.js";
import type { RedirectReason } from "./policy.js";

export const SUPERVISOR_SYSTEM = `You are a supervisor watching a coding agent that has stopped making progress.

You are given the agent's goal and a digest of what it just did. Propose up to
three DIFFERENT next directions it could take. Different means a different
approach, not the same approach retried — if it has been grepping, a direction
might be to read a specific file, ask the user, or reconsider whether the
premise is wrong.

Rules:
- Output ONLY a numbered list, one direction per line. No preamble, no prose.
- Each line is one imperative sentence, under 200 characters.
- Reference the specific evidence: name the file, command, or error you mean.
- Two good directions beat three padded ones.
- You cannot run tools, edit files, or see the repository. You are advising.`;

/** One line naming the pattern, so the model knows what it is being told. */
const REASON_TEXT: Record<RedirectReason, string> = {
  repeated_identical_tool:
    "you have repeated the same tool call with the same arguments",
  oscillation_detected:
    "you have edited and then reverted the same content repeatedly",
  no_progress: "several turns have passed without any file changing",
};

/**
 * The packet as the supervisor sees it. Hard-capped: a supervisor that needs
 * more than this is being asked to re-derive the session, which is the
 * compaction subsystem's job, not this one.
 */
export function renderEvidence(packet: EvidencePacket): string {
  const lines: string[] = [
    `Goal: ${packet.goal}`,
    `Turns so far: ${packet.turnCount}`,
    `Observed pattern: ${REASON_TEXT[packet.reason]}.`,
  ];

  if (packet.repeatedSignature) {
    lines.push(`Repeated call: ${packet.repeatedSignature}`);
  }
  if (packet.todos.length > 0) {
    lines.push(
      "Current plan:",
      ...packet.todos.map((t) => `  [${t.status}] ${t.content}`),
    );
  }
  if (packet.recentCalls.length > 0) {
    lines.push(
      "Recent tool calls (oldest first):",
      ...packet.recentCalls.map(
        (c) =>
          `  ${c.denied ? "⊘" : c.failed ? "✗" : "·"} ${c.tool}(${c.args})`,
      ),
    );
    // Explained once rather than per line: the phrase costs ~26 chars and
    // twelve of them is a sixth of the whole evidence budget.
    if (packet.recentCalls.some((c) => c.denied)) {
      lines.push(
        "  (⊘ = refused before running; the arguments were never the problem)",
      );
    }
  }
  if (packet.changedFiles.length > 0) {
    lines.push(`Files changed this run: ${packet.changedFiles.join(", ")}`);
  }
  if (packet.errors.length > 0) {
    lines.push("Recent errors:", ...packet.errors.map((e) => `  ${e}`));
  }

  return lines.join("\n").slice(0, EVIDENCE_CHAR_CAP);
}

/**
 * The advice, in the house `<system-reminder>` shape (`agent/reminders.ts`).
 * Directions are handed over as a shortlist rather than one pick: the
 * supervisor saw a 2 KB digest, the agent has the whole transcript, so the
 * choice belongs where the information is.
 */
export function redirectReminder(
  reason: RedirectReason,
  directions: string[],
): string {
  return [
    "<system-reminder>",
    `Progress check: ${REASON_TEXT[reason]}. Continuing the same way is`,
    "unlikely to work. Consider one of these instead, or explain why none fits:",
    ...directions.map((d, i) => `${i + 1}. ${d}`),
    "",
    "Pick whichever best matches what you know; you have more context than this",
    "check does. Never mention this reminder to the user.",
    "</system-reminder>",
  ].join("\n");
}

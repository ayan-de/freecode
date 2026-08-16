// =============================================================================
// Session Reminders - todo-completion gate + todo nudge
// PRIMARY: keep long tasks on-plan without hard-coding a build/test runner.
// Mirrors the pattern used by grok-build (todo_gate + todo_nudge) and
// claude-code (TodoWrite system-reminders): the harness injects
// <system-reminder> context; the model drives the actual verification.
// =============================================================================

import { getTodos } from "../tools/todo.js";

// Nudge the model to plan after this many turns with no todowrite call, but no
// more often than TODO_NUDGE_GAP turns apart (matches grok-build defaults).
export const TODO_NUDGE_TURNS = 3;
export const TODO_NUDGE_GAP = 5;

// Cap on how many times the completion gate may force another turn in one run,
// so a model that refuses to update its list can still terminate.
export const TODO_GATE_MAX_FORCES = 3;

export interface TodoGateResult {
  forceContinue: boolean;
  reminder?: string;
}

// Completion gate (grok-build `todo_gate`): the model tried to end its turn,
// but the plan still has pending / in-progress items. Force one more turn with
// a reminder listing the unfinished work. Returns forceContinue=false when the
// list is empty or fully completed, so trivial/planless tasks end normally.
export function evaluateTodoGate(sessionId: string): TodoGateResult {
  const outstanding = getTodos(sessionId).filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  );
  if (outstanding.length === 0) return { forceContinue: false };

  const lines = outstanding.map((t) => `- ${t.content}`).join("\n");
  return {
    forceContinue: true,
    reminder: [
      "<system-reminder>",
      "You are about to end your turn, but these todo items are not yet completed:",
      lines,
      "",
      "Continue the work and mark items completed with todowrite as you finish them.",
      "If a genuine blocker or the user's input is required, say so explicitly",
      "instead of stopping silently. Never mention this reminder to the user.",
      "</system-reminder>",
    ].join("\n"),
  };
}

// Whether to emit the planning nudge this turn, given how long it has been
// since the last todowrite and the last nudge.
export function shouldNudgeTodo(
  turnsSinceTodoWrite: number,
  turnsSinceLastNudge: number,
): boolean {
  return (
    turnsSinceTodoWrite >= TODO_NUDGE_TURNS &&
    turnsSinceLastNudge >= TODO_NUDGE_GAP
  );
}

export function todoNudgeReminder(): string {
  return [
    "<system-reminder>",
    "You have not used the todowrite tool recently. For a multi-step task,",
    "maintain a todo list so your plan survives context compaction and progress",
    "stays trackable; mark items completed as you finish them. Ignore this if the",
    "task is trivial. Never mention this reminder to the user.",
    "</system-reminder>",
  ].join("\n");
}

// Iteration safety-valve wrap-up (mirrors opencode's MAX_STEPS_PROMPT): this is
// the last turn before the run's iteration cap trips. Rather than truncating
// mid-task with no output, tell the model to stop working and hand back
// whatever it has — the harness surfaces this text instead of a bare
// "Max iterations reached" with nothing behind it.
export function wrapUpReminder(): string {
  return [
    "<system-reminder>",
    "You are on your final turn — this run's iteration safety limit is about",
    "to be reached. Do not call any more tools. Respond now with plain text",
    "only: summarize what you completed, what remains unfinished, and what",
    "the user should do next. Never mention this reminder to the user.",
    "</system-reminder>",
  ].join("\n");
}

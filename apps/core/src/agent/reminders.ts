// =============================================================================
// Session reminders — nudge the model to maintain a todo list during long work.
// Todo state remains context, not a completion gate: a user may legitimately
// ask for a plan and stop there, with every planned item still pending.
// =============================================================================

// Nudge the model to plan after this many turns with no todowrite call, but no
// more often than TODO_NUDGE_GAP turns apart (matches grok-build defaults).
export const TODO_NUDGE_TURNS = 3;
export const TODO_NUDGE_GAP = 5;

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

// How many extra turns a run will grant a model that truncated a tool call.
// Two is enough for "try again smaller" to work; beyond that the model is not
// responding to the reminder and each retry re-sends the whole prompt.
export const MAX_TRUNCATED_TOOL_RETRIES = 2;

// A tool call whose JSON arguments the model truncated (see the
// `tool_call_invalid` chunk in providers/types.ts). The call never ran and was
// never written to history, so the model is told what happened and how to make
// the next attempt fit — this is the only failure it can fix by itself.
export function truncatedToolCallReminder(names: string[]): string {
  const which =
    names.length === 1
      ? `Your call to the \`${names[0]}\` tool`
      : `Your calls to these tools: ${names.map((n) => `\`${n}\``).join(", ")}`;
  return [
    "<system-reminder>",
    `${which} was cut off mid-argument by the output token limit, so it never`,
    "ran and is not in the conversation. Reissue it with a smaller payload —",
    "split a large write across several calls, or shorten the content. Do not",
    "repeat the call unchanged. Never mention this reminder to the user.",
    "</system-reminder>",
  ].join("\n");
}

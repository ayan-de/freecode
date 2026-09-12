// =============================================================================
// Auto-poke — when the model stops with todos still open, send it back.
//
// The loop's rule is that no tool calls means the model wants to stop, and
// open todos do not override that: a planning request legitimately leaves
// every item pending. Auto-poke is the deliberate exception, OFF by default
// (`signals.autoPoke.enabled`, `FREECODE_AUTO_POKE=1`). jcode's finding is
// that most agent failures are early exits, not wrong answers; the bench
// (`bench/harness-signals/`) measures whether that holds here before the
// default moves.
//
// Three stops keep it from becoming a loop of its own:
//   cap          at most `maxPerRun` pokes per run
//   no progress  a poke whose todo list is byte-identical to the last poke's
//                is the model saying it cannot finish; stop rather than repeat
//   nothing open every item completed, or no list at all
//
// Decisions are pure so they can be tested without a loop.
// =============================================================================

import type { TodoItem } from "../../tools/todo.js";

export type PokeSkipReason = "disabled" | "nothing_open" | "cap_reached" | "no_progress";

export interface PokeState {
  pokes: number;
  lastFingerprint?: string;
}

export const initialPokeState = (): PokeState => ({ pokes: 0 });

export type PokeDecision =
  | { poke: true; remaining: TodoItem[]; fingerprint: string }
  | { poke: false; skip: PokeSkipReason };

/** The open items, in order, with status — what "made progress" means. */
export function todoFingerprint(todos: TodoItem[]): string {
  return todos
    .filter((t) => t.status !== "completed")
    .map((t) => `${t.id}:${t.status}:${t.content}`)
    .join("\n");
}

export function decidePoke(input: {
  enabled: boolean;
  maxPerRun: number;
  todos: TodoItem[];
  state: PokeState;
}): PokeDecision {
  const remaining = input.todos.filter((t) => t.status !== "completed");
  // Order matters for what the log says: an empty list on a disabled gate
  // reads "disabled" (the gate never looked), which is the honest reason.
  if (!input.enabled) return { poke: false, skip: "disabled" };
  if (remaining.length === 0) return { poke: false, skip: "nothing_open" };
  if (input.state.pokes >= input.maxPerRun) return { poke: false, skip: "cap_reached" };
  const fingerprint = todoFingerprint(input.todos);
  if (input.state.lastFingerprint === fingerprint) {
    return { poke: false, skip: "no_progress" };
  }
  return { poke: true, remaining, fingerprint };
}

export function notePoke(state: PokeState, fingerprint: string): PokeState {
  return { pokes: state.pokes + 1, lastFingerprint: fingerprint };
}

export function pokeReminder(remaining: TodoItem[], pokeIndex: number, max: number): string {
  const marks = { in_progress: "[~]", pending: "[ ]", completed: "[x]" } as const;
  return [
    "<system-reminder>",
    `You stopped with ${remaining.length} todo item${remaining.length === 1 ? "" : "s"} still open (poke ${pokeIndex} of ${max}):`,
    ...remaining.map((t) => `${marks[t.status]} ${t.content}`),
    "Do not reply or wait for the user. Continue the work: pick the next open",
    "item, do it, mark it completed with todowrite. If an item cannot be done,",
    "say why in the item text and mark it completed so the list is honest —",
    "an open item you have given up on reads as unfinished work. Never mention",
    "this reminder to the user.",
    "</system-reminder>",
  ].join("\n");
}

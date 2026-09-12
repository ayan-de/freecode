// =============================================================================
// Todo signals — what one todowrite call says about the model's own judgement.
//
// Two folds over (previous list, new list), both pure:
//
//   confidence spike   an item whose confidence rose by ≥ `spike` points in a
//                      single call while being marked completed. jcode's
//                      finding: the low number at assignment is signal, the
//                      jump to 100 at the end is not. The gate sends the model
//                      back to verify instead of accepting the claim.
//
//   hill-climb low     an item rated below `threshold` for how measurable its
//                      progress is. The gate asks for a reframe into something
//                      with a check to iterate against.
//
// Every signal is recorded (`todo.signal` in the rollout log) regardless of
// whether its gate is on, so the bench can compare runs with and without the
// nudge. The reminders are cheap: no model call, one <system-reminder>.
// =============================================================================

import type { TodoItem } from "../../tools/todo.js";

export interface ConfidenceSpike {
  kind: "confidence_spike";
  itemId: string;
  content: string;
  from: number;
  to: number;
}

export interface HillClimbLow {
  kind: "hill_climb_low";
  itemId: string;
  content: string;
  score: number;
}

export type TodoSignal = ConfidenceSpike | HillClimbLow;

export function diffTodoSignals(
  previous: TodoItem[],
  next: TodoItem[],
  opts: { spike: number; threshold: number },
): TodoSignal[] {
  const before = new Map(previous.map((t) => [t.id, t]));
  const signals: TodoSignal[] = [];
  for (const item of next) {
    const prev = before.get(item.id);
    // Completion in this call, with a confidence number on both sides. An item
    // that never carried a number has nothing to step; an item completed with
    // its first-ever number is "assigned and closed at once" and the bench
    // reads that from the log rather than this gate guessing at a `from`.
    if (
      item.status === "completed" &&
      prev &&
      prev.status !== "completed" &&
      typeof prev.confidence === "number" &&
      typeof item.confidence === "number" &&
      item.confidence - prev.confidence >= opts.spike
    ) {
      signals.push({
        kind: "confidence_spike",
        itemId: item.id,
        content: item.content,
        from: prev.confidence,
        to: item.confidence,
      });
    }
    // Fire once per rating, not once per call: the same low number re-sent
    // unchanged on the next update is the model ignoring the reminder, which
    // is the model's call — nagging every turn just burns context.
    if (
      typeof item.hillClimbability === "number" &&
      item.hillClimbability < opts.threshold &&
      item.status !== "completed" &&
      prev?.hillClimbability !== item.hillClimbability
    ) {
      signals.push({
        kind: "hill_climb_low",
        itemId: item.id,
        content: item.content,
        score: item.hillClimbability,
      });
    }
  }
  return signals;
}

export function confidenceSpikeReminder(spikes: ConfidenceSpike[]): string {
  const lines = spikes.map(
    (s) => `- "${s.content}": confidence ${s.from} → ${s.to} in one step`,
  );
  return [
    "<system-reminder>",
    "Confidence on these items jumped straight to done without stepping up",
    "through verification:",
    ...lines,
    "A large jump at completion is a claim, not evidence. Go back and check",
    "the work — run the test, read the output, compare against the requirement",
    "— then set the confidence the evidence supports. If it holds, keep the",
    "item completed. Never mention this reminder to the user.",
    "</system-reminder>",
  ].join("\n");
}

export function hillClimbReminder(lows: HillClimbLow[], threshold: number): string {
  const lines = lows.map((l) => `- "${l.content}": hill-climbability ${l.score}`);
  return [
    "<system-reminder>",
    `These items rate below ${threshold} for how measurable their progress is:`,
    ...lines,
    "A goal you cannot measure is a goal you cannot iterate on. Reframe each",
    "into a verifiable objective — a test that must pass, a number that must",
    "move, a check that must go green — or add a todo item that builds that",
    "check first. Update the list with todowrite. Never mention this reminder",
    "to the user.",
    "</system-reminder>",
  ].join("\n");
}

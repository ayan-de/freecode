// =============================================================================
// Harvest — turn a real session into a draft eval case (spec §8).
//
// The one thing this design has that the prior art does not. Observability
// makes failures *visible*; without this, making them *permanent* is a manual
// transcription job that nobody does. Every production failure is already a
// fully-specified case sitting on disk.
//
// Pure: events + messages in, a draft case out. All IO lives in the CLI, so
// this is testable without a session on disk.
//
// DEPARTURE FROM THE SPEC (§8, and the §5.1 table row that feeds it): the
// prompt does NOT come from `StoredTurn.prompt`. That table is written at every
// layer — `json-store.ts`, `sqlite-store.ts`, `thread-store.addTurn` — and
// `createTurn` has no production caller anywhere in the repo, so it is always
// empty. The durable text is the SESSION store's `messages.jsonl`. Building on
// the thread store would have produced a command that fails on every real
// session.
// =============================================================================

import { buildTrace } from "../rollout/trace.js";
import type { RolloutEvent } from "../rollout/types.js";
import type { SerializedMessage } from "../session/store.js";
import type { EvalCase } from "./types.js";

export class HarvestError extends Error {}

export interface HarvestInput {
  sessionId: string;
  messages: SerializedMessage[];
  events: RolloutEvent[];
  /** 1-based user turn. Defaults to the last one — usually the interesting one. */
  turn?: number;
}

export interface HarvestResult {
  kase: EvalCase;
  /** The turn actually harvested, and how many were available. */
  turn: number;
  turnCount: number;
  /** Guidance for the human who has to edit this before appending it. */
  notes: string[];
}

/** An argument value long or multi-line enough to be a bad needle. */
const MAX_NEEDLE = 80;

export function harvestCase(input: HarvestInput): HarvestResult {
  const prompts = userPrompts(input.messages);
  if (prompts.length === 0) {
    throw new HarvestError(
      `session ${input.sessionId} has no recorded user prompt — its message ` +
        `log is empty, pruned, or compacted away. Refusing to emit a case ` +
        `with an empty task.`,
    );
  }

  const turn = input.turn ?? prompts.length;
  if (!Number.isInteger(turn) || turn < 1 || turn > prompts.length) {
    throw new HarvestError(
      `--turn ${turn} is out of range: session has ${prompts.length} user turn(s)`,
    );
  }
  const chosen = prompts[turn - 1];
  const next = prompts[turn];

  // Scope the log to this turn by TIMESTAMP, not by `turnId`. A rollout
  // `turnId` is `turn-<loopIteration>` (`agent/loop.ts`), so one user prompt
  // spans many of them and the ids do not line up with user turns at all.
  const until = next?.timestamp ?? Number.POSITIVE_INFINITY;
  const scoped = input.events.filter(
    (e) => e.timestamp >= chosen.timestamp && e.timestamp < until,
  );
  if (scoped.length === 0) {
    throw new HarvestError(
      `no rollout events recorded for turn ${turn} of ${input.sessionId} — ` +
        `nothing to score a trajectory against`,
    );
  }

  const trace = buildTrace(input.sessionId, scoped);
  const notes: string[] = [];

  const first = trace.toolSpans[0];
  const model = trace.modelSpans[0];

  const kase: EvalCase = {
    id: caseId(chosen.text, input.sessionId, turn),
    prompt: chosen.text,
    ...(model ? { model: `${model.provider}/${model.model}` } : {}),
    expectTool: first ? first.tool : null,
    ...(first ? argExpectations(trace, first.tool) : {}),
    expectMaxTurns: Math.max(1, trace.modelSpans.length),
  };

  // The harvested run is usually the WRONG behaviour — that being why it is
  // interesting. A draft that reads as an approved expectation is the failure
  // mode here, so say so first and every time.
  notes.push(
    "This records what the agent DID, not what it should do. A harvested run " +
      "is usually the wrong behaviour — that is why it is worth a case. Edit " +
      "the expectation before appending.",
  );
  if (!first) {
    notes.push(
      "No tool fired, so the draft asserts `expectTool: null`. If the bug was " +
        "that no tool fired, name the tool you wanted instead.",
    );
  }
  if (kase.expectInArgs) {
    notes.push(
      "expectInArgs came from the call itself. Substring matching is " +
        "directional — cut each needle to the shortest string that still tells " +
        "right behaviour from wrong, or it tests the model's phrasing.",
    );
    const shortened = shortenedKeys(trace, first!.tool, kase.expectInArgs);
    if (shortened.length) {
      notes.push(
        `Absolute paths were shortened to their last two segments ` +
          `(${shortened.join(", ")}) — the original named this machine, and ` +
          `could never match again.`,
      );
    }
  }
  notes.push(
    `expectMaxTurns is the OBSERVED count (${kase.expectMaxTurns}), so the ` +
      `case fails on a run one turn longer. Loosen it unless the turn count is ` +
      `the point.`,
  );
  if (!model) {
    notes.push(
      "No model span in this window, so the case pins no model. An unpinned " +
        "baseline silently reprices when a provider changes its default.",
    );
  }
  if (trace.hung) {
    notes.push("This turn HUNG. Check it is worth keeping before you append it.");
  }
  const errored = trace.modelSpans.find((s) => s.status === "error");
  if (errored) {
    notes.push(
      `This turn hit a model error (${errored.errorKind ?? "unknown"}). That is ` +
        `infrastructure, not trajectory — a case built on it will be flaky.`,
    );
  }

  return { kase, turn, turnCount: prompts.length, notes };
}

interface Prompt {
  text: string;
  timestamp: number;
}

function userPrompts(messages: SerializedMessage[]): Prompt[] {
  const out: Prompt[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts
      .filter((p) => p.type === "text" && p.content)
      .map((p) => p.content!.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) continue; // an image-only or empty turn is not a task
    out.push({ text, timestamp: message.timestamp });
  }
  return out;
}

/**
 * Argument expectations drawn from the calls that actually happened.
 *
 * Only short single-line scalars: `edit`'s `new_string` is a whole file body,
 * and a needle that long asserts the model reproduces a specific edit
 * character for character. Numbers and booleans go through `$eq` because a
 * bare value would be compared as a substring, where `1` matches `10`.
 */
function argExpectations(
  trace: ReturnType<typeof buildTrace>,
  tool: string,
): Pick<EvalCase, "expectInArgs"> {
  const span = trace.toolSpans.find((s) => s.tool === tool && s.args);
  if (!span?.args) return {};

  const expectInArgs: NonNullable<EvalCase["expectInArgs"]> = {};
  for (const [key, value] of Object.entries(span.args)) {
    if (typeof value === "number" || typeof value === "boolean") {
      expectInArgs[key] = { $eq: value };
    } else if (
      typeof value === "string" &&
      value.trim() &&
      value.length <= MAX_NEEDLE &&
      !value.includes("\n")
    ) {
      expectInArgs[key] = shortenPath(value);
    }
  }
  return Object.keys(expectInArgs).length ? { expectInArgs } : {};
}

/**
 * An absolute path harvested verbatim is a needle that can never match again:
 * it names one machine, and — when the session was itself an eval run — one
 * tmpdir that no longer exists. The distinguishing part is the tail, so keep
 * the last two segments and drop the rest.
 *
 * Not silent: `harvestCase` notes every value it shortened. Emitting the raw
 * path would be honest and useless; rewriting it without saying so would be
 * useful and dishonest.
 */
/** Which emitted needles differ from the raw argument, for the note. */
function shortenedKeys(
  trace: ReturnType<typeof buildTrace>,
  tool: string,
  emitted: NonNullable<EvalCase["expectInArgs"]>,
): string[] {
  const span = trace.toolSpans.find((s) => s.tool === tool && s.args);
  if (!span?.args) return [];
  return Object.keys(emitted).filter(
    (key) => typeof span.args![key] === "string" && span.args![key] !== emitted[key],
  );
}

export function shortenPath(value: string): string {
  if (!value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value)) return value;
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.slice(-2).join("/");
}

/**
 * A stable, readable id. The session prefix and turn keep two harvests of
 * similar prompts apart — `dataset.ts` rejects duplicate ids, and a collision
 * discovered at append time is a worse experience than a slightly uglier name.
 */
export function caseId(prompt: string, sessionId: string, turn: number): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .split("-")
      .slice(0, 6)
      .join("-")
      .slice(0, 40) || "harvested";
  return `${slug}-${sessionId.slice(0, 6)}-t${turn}`;
}

/** The case as it should appear in a `.jsonl` — one line, stable key order. */
export function formatCase(kase: EvalCase): string {
  const ordered: Record<string, unknown> = {};
  for (const key of [
    "id",
    "prompt",
    "model",
    "agentMode",
    "expectTool",
    "expectInArgs",
    "expectMaxTurns",
    "forbidTools",
  ] as const) {
    if (kase[key] !== undefined) ordered[key] = kase[key];
  }
  return JSON.stringify(ordered);
}

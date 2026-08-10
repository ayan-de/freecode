// =============================================================================
// Auto-distillation gate — decides whether a finished run gets distilled at all
// PRIMARY: two gates in front of the (expensive) planner, cheapest first.
//   1. shouldConsiderDistill() — pure, no I/O beyond a settings read: turn
//      interval AND wall-clock cooldown, or the compaction boundary.
//   2. reviewAutoDistill() — a small LLM call answering one question: is there
//      anything here worth persisting? Returns rationale + optional focus
//      instructions for the planner.
// Spec: docs/superpowers/specs/2026-08-08-continual-harness-design.md §3.4/§4.7
// Why two: distillation is a full planner call over a 16K transcript. Running
// it every turn would be absurd; running it on a turn counter alone would still
// pay the planner on the ~most sessions that have nothing durable in them. The
// review call is the cheap filter (small output budget) that makes the interval
// trigger affordable — prime-agent's reviewAutoRefine, same reasoning.
// Per-session state is in-process and deliberately not persisted: a restart
// re-arming the interval costs one extra review call, while a persisted
// counter would be a fourth on-disk store for a throttle.
// =============================================================================

import { getProvider } from "../providers/index.js";
import type { ProviderId } from "../providers/index.js";
import { logger } from "../utils/logger.js";
import { loadHarnessSettings } from "./settings.js";
import { GATE_SYSTEM_PROMPT, buildGateUserPrompt } from "./prompts.js";
import type { HarnessState } from "./types.js";

// The review answers yes/no plus a short rationale — it does not write the
// edits, so it needs a fraction of the planner's budget. Prime-agent's split
// is 4096 vs 32000; ours is 512 vs 4096, same ratio against smaller prompts.
const GATE_MAX_OUTPUT_TOKENS = 512;
const MAX_TRANSCRIPT_CHARS = 8_000;
// Below this a run cannot hold a durable lesson — same floor and reasoning as
// memory/extract-policy.ts's MIN_TRANSCRIPT_CHARS.
const MIN_TRANSCRIPT_CHARS = 200;
const MAX_SESSIONS = 64;

interface SessionState {
  /** Cumulative transcript turn count when this session last distilled. */
  turnsAtLastDistill: number;
  lastDistillAt: number;
}

const sessions = new Map<string, SessionState>();

function stateFor(sessionId: string): SessionState {
  const existing = sessions.get(sessionId);
  if (existing) {
    sessions.delete(sessionId); // LRU touch
    sessions.set(sessionId, existing);
    return existing;
  }
  const fresh: SessionState = { turnsAtLastDistill: 0, lastDistillAt: 0 };
  sessions.set(sessionId, fresh);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
  return fresh;
}

/** Drop gate state for a session (or all of it, in tests). */
export function resetDistillGate(sessionId?: string): void {
  if (sessionId === undefined) sessions.clear();
  else sessions.delete(sessionId);
}

/**
 * Record that a distillation just ran, so the interval and cooldown restart.
 * Called by the loop after an automatic distillation AND after an explicit
 * one — an explicit `distill` call has already mined the session, so letting
 * the automatic trigger fire right behind it would pay twice for the same
 * transcript.
 */
export function markDistilled(sessionId: string, turns: number): void {
  const state = stateFor(sessionId);
  state.turnsAtLastDistill = turns;
  state.lastDistillAt = Date.now();
}

export interface ConsiderDistillInput {
  sessionId: string;
  projectRoot: string;
  transcript: string;
  /** Cumulative turn count of the transcript, not turns in this run. */
  turns: number;
  /** Did a compaction happen since the last distillation? */
  compacted: boolean;
}

export interface ConsiderDecision {
  consider: boolean;
  reason: string;
}

/**
 * Gate 1: should we even pay for the review call? Cheapest checks first, so a
 * skipped run costs a settings read and two comparisons.
 *
 * The compaction boundary bypasses the turn interval but NOT the cooldown:
 * post-compaction the cache prefix is rebuilt anyway, so a distillation there
 * has its cache cost already sunk (spec §4.5) — but a session compacting
 * twice in five minutes should still not distill twice.
 */
export function shouldConsiderDistill(
  input: ConsiderDistillInput,
): ConsiderDecision {
  const settings = loadHarnessSettings(input.projectRoot);
  if (!settings.enabled) {
    return { consider: false, reason: "harness.enabled is off" };
  }
  const auto = settings.autoDistill;
  if (!auto.enabled) {
    return { consider: false, reason: "harness.autoDistill.enabled is off" };
  }
  if (input.transcript.length < MIN_TRANSCRIPT_CHARS) {
    return { consider: false, reason: "too short to hold a durable lesson" };
  }

  const state = stateFor(input.sessionId);
  const sinceLast = Date.now() - state.lastDistillAt;
  if (state.lastDistillAt > 0 && sinceLast < auto.cooldownMs) {
    return {
      consider: false,
      reason: `cooldown (${Math.round(sinceLast / 1000)}s of ${Math.round(auto.cooldownMs / 1000)}s)`,
    };
  }

  if (input.compacted && auto.compact) {
    return { consider: true, reason: "compaction boundary" };
  }

  const turnsSince = input.turns - state.turnsAtLastDistill;
  if (turnsSince >= auto.turnInterval) {
    return { consider: true, reason: `turn interval (${turnsSince} turns)` };
  }
  return {
    consider: false,
    reason: `throttled (${turnsSince}/${auto.turnInterval} turns)`,
  };
}

export interface GateReview {
  shouldDistill: boolean;
  rationale: string;
  /** Optional focus passed through to the planner as its instructions. */
  instructions?: string;
}

export interface ReviewAutoDistillInput {
  transcript: string;
  state: HarnessState;
  provider: string;
  model?: string;
  /** Test seam; defaults to a real provider.execute() call. */
  complete?: (system: string, prompt: string) => Promise<string>;
}

function parseGateReview(text: string): GateReview {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("the gate did not return a JSON object");
  }
  const value = JSON.parse(candidate.slice(start, end + 1)) as Record<
    string,
    unknown
  >;
  return {
    // Anything other than an explicit `true` is a no — a gate that fails open
    // would turn every malformed response into a full planner call.
    shouldDistill: value.shouldDistill === true,
    rationale: typeof value.rationale === "string" ? value.rationale : "",
    instructions:
      typeof value.instructions === "string" && value.instructions.trim()
        ? value.instructions
        : undefined,
  };
}

/**
 * Gate 2: the cheap LLM review. Never throws — a failed review reads as "no",
 * so a provider hiccup costs a skipped distillation rather than an unreviewed
 * write to persistent agent state. Same fail-closed contract as the planner's.
 */
export async function reviewAutoDistill(
  input: ReviewAutoDistillInput,
): Promise<GateReview> {
  try {
    const complete =
      input.complete ??
      (async (system: string, prompt: string) => {
        const p = getProvider(input.provider as ProviderId);
        if (!p) return "";
        const result = await p.execute({
          prompt,
          system,
          model: input.model,
          maxTokens: GATE_MAX_OUTPUT_TOKENS,
        });
        return result.content ?? "";
      });

    const text = await complete(
      GATE_SYSTEM_PROMPT,
      buildGateUserPrompt({
        transcript: input.transcript.trim().slice(-MAX_TRANSCRIPT_CHARS),
        state: input.state,
      }),
    );
    return parseGateReview(text);
  } catch (error) {
    logger.debug("[Distill] gate review failed", { error });
    return { shouldDistill: false, rationale: "gate review failed" };
  }
}

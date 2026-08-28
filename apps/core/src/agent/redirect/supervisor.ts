// =============================================================================
// Supervisor — one non-streaming model call that proposes next directions.
//
// It has no tools, no permissions, no verifier access, and no ability to end a
// run or extend a budget (D9). Everything it produces is advice the agent is
// free to ignore.
//
// FAILS CLOSED, ALWAYS (D6): provider error, timeout, empty or unparseable
// response → no redirection, a recorded skip, and the loop continues exactly as
// it behaves today. Never throws.
// Spec: docs/superpowers/specs/2026-08-26-trajectory-redirection.md, D4–D6.
// =============================================================================

import { getProvider } from "../../providers/index.js";
import type { ProviderId } from "../../providers/index.js";
import type { ExecuteUsage } from "../../providers/types.js";
import { logger } from "../../utils/logger.js";
import type { EvidencePacket } from "./evidence.js";
import type { RedirectSkipReason } from "./policy.js";
import { SUPERVISOR_SYSTEM, renderEvidence } from "./prompt.js";

export const SUPERVISOR_MAX_TOKENS = 400;

/**
 * The turn being delayed is by definition an unproductive one, and advice that
 * arrives a turn late can arrive *after* the 2× hard-stop tier has killed the
 * run. Fifteen seconds on a stuck loop is a good trade — this is deliberately
 * synchronous, not the memory graph's one-turn-behind pattern. Do not
 * "optimize" it into a race.
 */
export const SUPERVISOR_TIMEOUT_MS = 15_000;

export const MAX_DIRECTIONS = 3;
const DIRECTION_MAX_CHARS = 200;
export const DIRECTIONS_CHAR_CAP = 600;

export type SupervisorOutcome =
  | {
      ok: true;
      directions: string[];
      latency_ms: number;
      usage?: ExecuteUsage;
    }
  | { ok: false; skip: RedirectSkipReason; latency_ms: number };

export interface SupervisorInput {
  packet: EvidencePacket;
  provider: string;
  model?: string;
  /** Test seam; defaults to a one-shot provider call. */
  complete?: (
    system: string,
    prompt: string,
    signal: AbortSignal,
  ) => Promise<{ content: string; usage?: ExecuteUsage }>;
}

/**
 * Numbered lines, parsed leniently — models emit "1.", "1)", "- 1." and a code
 * fence however firmly you ask. Returns [] when nothing parses, which the
 * caller treats as `unparseable`.
 */
export function parseDirections(raw: string): string[] {
  const fenced = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const match = line.trim().match(/^[-*]?\s*\d+\s*[.)]\s*(.+)$/);
    if (!match) continue;
    const text = match[1].trim().slice(0, DIRECTION_MAX_CHARS);
    if (text.length > 0 && !out.includes(text)) out.push(text);
    if (out.length === MAX_DIRECTIONS) break;
  }
  return out;
}

/** Drop directions from the end until the list fits the character cap. */
export function capDirections(directions: string[]): string[] {
  const out: string[] = [];
  let total = 0;
  for (const d of directions) {
    if (total + d.length > DIRECTIONS_CHAR_CAP) break;
    out.push(d);
    total += d.length;
  }
  return out;
}

async function oneShot(
  input: SupervisorInput,
  system: string,
  prompt: string,
  signal: AbortSignal,
): Promise<{ content: string; usage?: ExecuteUsage }> {
  const provider = getProvider(input.provider as ProviderId);
  if (!provider) throw new Error("no provider");
  const result = await provider.execute({
    prompt,
    system,
    // The run's own provider and model: a cheaper tier would need model
    // resolution this codebase does not have yet (see the spec's open
    // question 3), and cross-provider fallback would spend an API key the
    // user may not have configured.
    model: input.model,
    maxTokens: SUPERVISOR_MAX_TOKENS,
    abortSignal: signal,
  });
  return { content: result.content ?? "", usage: result.usage };
}

export async function requestRedirect(
  input: SupervisorInput,
): Promise<SupervisorOutcome> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPERVISOR_TIMEOUT_MS);

  try {
    const complete =
      input.complete ?? ((s, p, sig) => oneShot(input, s, p, sig));
    // Raced as well as aborted: the signal is the polite request, the race is
    // the guarantee. A provider that ignores the signal must not be able to
    // stall a turn past the budget D6 promises.
    const result = await Promise.race([
      complete(
        SUPERVISOR_SYSTEM,
        renderEvidence(input.packet),
        controller.signal,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new SupervisorTimeout()),
          SUPERVISOR_TIMEOUT_MS,
        ).unref?.(),
      ),
    ]);

    const directions = capDirections(parseDirections(result.content));
    if (directions.length === 0) {
      logger.debug("[Redirect] unparseable supervisor reply", {
        raw: result.content.slice(0, 200),
      });
      return {
        ok: false,
        skip: "unparseable",
        latency_ms: Date.now() - startedAt,
      };
    }
    return {
      ok: true,
      directions,
      latency_ms: Date.now() - startedAt,
      usage: result.usage,
    };
  } catch (error) {
    const timedOut =
      error instanceof SupervisorTimeout || controller.signal.aborted;
    logger.debug("[Redirect] supervisor call failed", { error });
    return {
      ok: false,
      skip: timedOut ? "timeout" : "provider_error",
      latency_ms: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

class SupervisorTimeout extends Error {
  constructor() {
    super("supervisor timed out");
  }
}

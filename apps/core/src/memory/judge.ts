// =============================================================================
// Retrieval judge (spec D15) — decides which surfaced memories are actually
// relevant to the request, or that none of them are.
//
// Why this exists at all: D1 assumed a local scorer could answer "is anything
// here relevant" for free. The benchmark refuted it. On the committed corpus,
// top cosine for on-topic queries spans 0.674–0.932 and for irrelevant queries
// 0.588–0.719 — overlapping, so no absolute threshold separates them. A
// within-query z-score overlaps too ("write a haiku about the sea" outscores
// 13 of 22 real queries). Bi-encoder similarity between short texts has a high,
// corpus-dependent floor; that is a property of the model, not a tuning bug.
//
// So abstention needs a reader. It is made affordable by *where* it runs, not
// by being small: on the existing one-turn-behind prefetch, so the loop never
// waits on it, and behind a cadence carry, so it fires on a topic change rather
// than every turn (jcode's `CadenceCarry`).
// =============================================================================

import { getProvider } from "../providers/index.js";
import type { ProviderId } from "../providers/index.js";
import type { MemoryEntry } from "./mem-types.js";
import { logger } from "../utils/logger.js";

// The judge reads a list of one-line descriptions and returns the keepers, so
// its output is bounded by the candidate count however the model misbehaves.
const MAX_TOKENS = 256;

const SYSTEM = `You decide which stored memories are relevant to a user's request.

You are given the request and a numbered list of memory descriptions. Return
ONLY a JSON array of the numbers worth surfacing, e.g. [1,4]. No prose.

Keep a memory only if it would change how the request is answered. A memory
about the project's database is not relevant to a question about arithmetic.

Most requests need none of them. Returning [] is the common, correct answer.
Do not keep a memory because it is interesting; keep it because it is needed.`;

export interface JudgeInput {
  query: string;
  candidates: MemoryEntry[];
  provider: string;
  model?: string;
  /** Test seam; defaults to a one-shot provider call. */
  complete?: (system: string, prompt: string) => Promise<string>;
}

// Every terminal outcome of a judging attempt. Exhaustive on purpose: a new
// path that surfaces memory without the judge has to name itself here, so a
// silent degradation becomes a countable one (jcode's JudgeDecision).
export type JudgeDecision =
  | "judge_ran" // the productive path
  | "disabled" // user opted out — intended, not a degradation
  | "no_candidates" // nothing to judge
  | "no_provider" // no usable provider configured
  | "unparseable" // model returned something that is not a number array
  | "failed"; // transport error or timeout

export interface JudgeResult {
  kept: MemoryEntry[];
  decision: JudgeDecision;
}

export function isDegradation(decision: JudgeDecision): boolean {
  return decision === "unparseable" || decision === "failed";
}

// Parse a bare JSON array of 1-based indices. Tolerates a code fence and
// surrounding prose, both of which models emit however firmly you ask.
export function parseKeepIndices(raw: string, max: number): number[] | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  const bracketed = body.match(/\[[\s\S]*?\]/);
  if (!bracketed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bracketed[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: number[] = [];
  for (const v of parsed) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < 1 || n > max) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

async function oneShot(
  input: JudgeInput,
  system: string,
  prompt: string,
): Promise<string> {
  const provider = getProvider(input.provider as ProviderId);
  if (!provider) throw new Error("no provider");
  const result = await provider.execute({
    prompt,
    system,
    model: input.model,
    quietModelFallback: true,
    maxTokens: MAX_TOKENS,
  });
  return result.content ?? "";
}

/**
 * Filter `candidates` down to those the judge considers relevant to `query`.
 *
 * **Fails closed, deliberately.** On any error the candidates are dropped
 * rather than surfaced. This is the opposite of waku's gate, which fails open
 * and so pays for the gate *and* injects anyway. The asymmetry that decides it:
 * a missed memory costs one turn of the model not knowing something, and the
 * next turn re-runs the judge; an injected irrelevant memory biases the answer
 * and the user never learns why. The `failed` decision is counted, so a
 * provider that is down shows up as a degradation rate rather than as silence.
 *
 * Never throws.
 */
export async function judgeMemories(input: JudgeInput): Promise<JudgeResult> {
  const { query, candidates } = input;
  if (candidates.length === 0) {
    return { kept: [], decision: "no_candidates" };
  }

  try {
    const listed = candidates
      .map((c, i) => `${i + 1}. [${c.type}] ${c.description}`)
      .join("\n");
    const complete = input.complete ?? ((s, p) => oneShot(input, s, p));
    const raw = await complete(
      SYSTEM,
      `Request:\n${query}\n\nStored memories:\n${listed}`,
    );

    const keep = parseKeepIndices(raw, candidates.length);
    if (keep === null) {
      logger.debug("[MemoryJudge] unparseable verdict", { raw: raw.slice(0, 200) });
      return { kept: [], decision: "unparseable" };
    }
    // Preserve the incoming (cascade) order rather than the model's, so the
    // byte-budget degradation in mem-prompt still sheds the least relevant
    // entries first.
    const wanted = new Set(keep);
    return {
      kept: candidates.filter((_, i) => wanted.has(i + 1)),
      decision: "judge_ran",
    };
  } catch (error) {
    logger.debug("[MemoryJudge] judging failed", { error });
    return { kept: [], decision: "failed" };
  }
}

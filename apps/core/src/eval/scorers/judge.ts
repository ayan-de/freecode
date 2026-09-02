// =============================================================================
// Judge scorer — "was the reply any good", 0–5. Spec §7.
//
// The only scorer that reads `run.response`. Everything else here folds the
// trace, on purpose: an agent can produce a perfect final message while making
// duplicate calls and editing files it was told not to. This answers the
// question the deterministic scorers cannot, and it is the LEAST trustworthy
// number in the harness — which is why it has its own suite, its own command,
// and its own blocking rule.
//
// Three non-negotiables, all from §7:
//
// 1. The judge is not the model under test (`judge-config.ts`).
// 2. The judge is TOLD WHICH TOOLS ACTUALLY FIRED, as ground truth. Without it
//    a truthful "I've saved that to memory" reads as a hallucination and gets
//    marked down — the single most common false negative in agent judging.
// 3. A judge outage NEVER fails a run. It returns null and the case reports
//    "not scored". A harness that goes red because a third party 429'd teaches
//    the team to ignore red.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { evalsDir } from "../dataset.js";
import type { JudgeConfig } from "../judge-config.js";
import type { EvalCase, RunRecord } from "../types.js";

/**
 * 0–5, not 0–10. Reported human–judge agreement peaks around a five-point
 * scale (~0.89 Pearson); ten points invites a "7" that carries no more
 * information than "4/5" and implies precision no LLM judge delivers.
 */
export const MAX_SCORE = 5;

/**
 * Sized for a REASONING judge, not for the two lines it is asked to emit.
 *
 * This was 300, which is generous for "SCORE: 4\nWHY: <25 words>" and far too
 * small in practice: a thinking model spends this budget on hidden reasoning
 * first, and the visible answer gets whatever is left. Measured on
 * gemini-3.6-flash against a trivial input, 83 of 101 output tokens were
 * `reasoningTokens` and only 18 were the answer. On a real case — full rubric
 * plus a long agent reply — reasoning ran the budget out mid-sentence, and the
 * first graded run recorded verdicts reading `WHY: The answer is` and, once,
 * just `:`.
 *
 * The SCORE always survived because the format puts it first, so the gate kept
 * working and the damage was confined to the diagnostics — which is to say it
 * broke exactly where it hurts most, on the low-scoring case you most need
 * explained. Not a Gemini quirk: any reasoning judge bills thinking against
 * this ceiling.
 */
const JUDGE_MAX_TOKENS = 2_000;
const JUDGE_TIMEOUT_MS = 30_000;

export const JUDGE_SYSTEM = `You are grading the reply of an AI coding assistant.

Score it 0-${MAX_SCORE} against the rubric you are given. Be strict: ${MAX_SCORE} means
you would not change anything, 3 means usable with reservations, 0 means wrong
or actively unhelpful.

You are given the list of tools the assistant ACTUALLY called, taken from the
execution log. Treat it as ground truth. If the reply says it did something and
the tool list confirms it, that is honest, not a hallucination. Only penalise a
claim the tool list contradicts.

Reply with exactly two lines and nothing else:
SCORE: <integer 0-${MAX_SCORE}>
WHY: <one sentence, under 25 words>`;

export interface JudgeVerdict {
  /** `null` when the judge could not answer — never a failure of the run. */
  score: number | null;
  reason: string;
  /**
   * What grading this trial cost, or `undefined` when the judge model is
   * unpriced. Reported SEPARATELY from the trial's own cost and never folded
   * into it: `scorers/efficiency.ts` compares subject tokens and USD across
   * runs to answer "did this prompt change get more expensive", and mixing the
   * grader's spend into that would move the number for a reason that has
   * nothing to do with the agent.
   */
  costUsd?: number;
}

export interface JudgeReply {
  text: string;
  /** `undefined` when the judge model has no price entry — never zero. */
  costUsd?: number;
}

export interface JudgeInput {
  run: RunRecord;
  kase: EvalCase;
  judge: JudgeConfig;
  /** Test seam; defaults to a one-shot provider call. */
  complete?: (
    system: string,
    prompt: string,
    signal: AbortSignal,
  ) => Promise<JudgeReply>;
}

/** Rubrics live in `evals/rubrics/*.md` so tuning one is a text diff, not a build. */
export function rubricPath(name: string): string {
  return path.join(evalsDir(), "rubrics", `${name}.md`);
}

export function loadRubric(name: string): string {
  const file = rubricPath(name);
  if (!fs.existsSync(file)) {
    throw new Error(`no such rubric: ${file}`);
  }
  return fs.readFileSync(file, "utf-8").trim();
}

/**
 * Lenient, because models emit "SCORE: 4", "**SCORE:** 4", "Score - 4" and a
 * bare "4" however firmly you ask. Returns null when nothing parses, which the
 * caller treats exactly like an outage.
 *
 * A score outside 0..MAX is rejected rather than clamped: a judge answering
 * "8" on a five-point scale did not understand the task, and clamping it to 5
 * would silently record its confusion as a perfect mark.
 */
export function parseVerdict(raw: string): JudgeVerdict {
  const text = raw.trim();
  const scoreMatch =
    text.match(/score\s*[:\-]?\s*\**\s*(\d+(?:\.\d+)?)/i) ??
    text.match(/^\**\s*(\d+(?:\.\d+)?)\s*(?:\/\s*\d+)?\s*\**$/m);
  if (!scoreMatch) return { score: null, reason: "unparseable judge reply" };

  const score = Number(scoreMatch[1]);
  if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
    return { score: null, reason: `judge scored ${scoreMatch[1]}, out of range` };
  }

  const whyMatch = text.match(/why\s*[:\-]?\s*\**\s*(.+)/i);
  const reason = (whyMatch?.[1] ?? "").trim().replace(/\**$/, "").slice(0, 160);
  return { score, reason: reason || `scored ${score}/${MAX_SCORE}` };
}

export function renderJudgePrompt(
  run: RunRecord,
  kase: EvalCase,
  rubric: string,
): string {
  // Deduplicated with counts: a judge shown `read, read, read, read` starts
  // grading the repetition, which is the trajectory scorer's job, not its own.
  const counts = new Map<string, number>();
  for (const span of run.trace.toolSpans) {
    counts.set(span.tool, (counts.get(span.tool) ?? 0) + 1);
  }
  const tools = counts.size
    ? [...counts.entries()]
        .map(([tool, n]) => (n > 1 ? `${tool} (x${n})` : tool))
        .join(", ")
    : "(none)";

  return [
    "## Rubric",
    rubric,
    "",
    "## Task the user gave",
    kase.prompt,
    "",
    "## Tools the assistant actually called (ground truth, from the log)",
    tools,
    "",
    "## The assistant's reply",
    run.response.trim() || "(empty)",
  ].join("\n");
}

async function oneShot(
  input: JudgeInput,
  system: string,
  prompt: string,
  signal: AbortSignal,
): Promise<JudgeReply> {
  const { getProvider } = await import("../../providers/index.js");
  const { priceUsd } = await import("../../providers/pricing.js");
  const provider = getProvider(input.judge.provider as never);
  if (!provider) throw new Error(`no such provider: ${input.judge.provider}`);
  const result = await provider.execute({
    prompt,
    system,
    model: input.judge.model,
    maxTokens: JUDGE_MAX_TOKENS,
    abortSignal: signal,
  });
  // The judge call never reaches the rollout recorder — it is not part of the
  // agent's session — so its spend is invisible unless priced here. An
  // unpriced judge model yields `undefined`, which reports as "unknown"
  // rather than as free.
  const model = input.judge.model ?? provider.info.defaultModel ?? "";
  return {
    text: result.content ?? "",
    costUsd: priceUsd(input.judge.provider, model, {
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    }),
  };
}

/**
 * Grade one reply. NEVER throws and never rejects: every failure path — no
 * rubric, provider down, timeout, garbage reply — returns a null score, which
 * the gate reports as `skipped` rather than as a failure.
 */
export async function scoreJudged(input: JudgeInput): Promise<JudgeVerdict> {
  if (!input.kase.rubric) return { score: null, reason: "no rubric" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  try {
    const rubric = loadRubric(input.kase.rubric);
    const prompt = renderJudgePrompt(input.run, input.kase, rubric);
    const complete =
      input.complete ?? ((s, p, sig) => oneShot(input, s, p, sig));

    // Raced as well as aborted: the signal is the polite request, the race is
    // the guarantee against a provider that ignores it.
    const reply = await Promise.race([
      complete(JUDGE_SYSTEM, prompt, controller.signal),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("judge timed out")),
          JUDGE_TIMEOUT_MS,
        ).unref?.(),
      ),
    ]);
    // The cost is carried even when the verdict is unparseable: a judge that
    // answered with garbage still billed for it.
    return { ...parseVerdict(reply.text), costUsd: reply.costUsd };
  } catch (err) {
    return {
      score: null,
      reason: `judge unavailable: ${(err as Error).message}`.slice(0, 160),
    };
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// Judge configuration — who grades, and the refusal that keeps it honest.
//
// Spec §7 constraint 1: THE JUDGE MUST NOT BE THE MODEL UNDER TEST. A model
// grading itself is neither fair nor credible — LLMs show self-preference bias,
// so the score stops measuring "was this good" and starts measuring "does this
// look like something I would have written".
//
// That is fatal for THIS harness specifically. The whole point is to change a
// prompt and re-run. If judge and subject are the same model, a prompt change
// shifts the answer AND the grader in the same direction, and the number moves
// while telling you nothing.
// =============================================================================

export interface JudgeConfig {
  provider: string;
  model?: string;
}

export type JudgeResolution =
  | { ok: true; judge: JudgeConfig }
  /** No judge configured. Judged cases report `skipped`, and the gate stays open. */
  | { ok: false; reason: "unconfigured"; detail: string }
  /** Configured, but it IS the model under test. Refuse rather than mislead. */
  | { ok: false; reason: "same-model"; detail: string };

/**
 * Model ids differ cosmetically across providers and gateways, so compare a
 * normalised form: lowercased, and with a trailing date snapshot dropped
 * (`claude-sonnet-4-5-20260101` and `claude-sonnet-4-5` are the same weights).
 */
export function normaliseModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/-\d{8}$/, "")
    .replace(/@\d{8}$/, "");
}

/** `provider/model` → its parts. A bare id keeps `provider` undefined. */
export function splitModelId(id: string): {
  provider?: string;
  model: string;
} {
  const slash = id.indexOf("/");
  if (slash <= 0) return { model: id };
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

/**
 * Resolve the judge, refusing when it collides with the model under test.
 *
 * **The collision check is best-effort and cannot be made complete** (spec §7).
 * It compares normalised ids, so it catches the obvious mistake and misses
 * aliases of the same weights behind a gateway route or an OpenRouter path —
 * nothing in a response says what is actually serving it. Mitigation is
 * disclosure, not detection: the resolved judge is written into every report so
 * a reader can catch what this comparison cannot.
 */
export function resolveJudge(subjectModelId?: string): JudgeResolution {
  const provider = process.env.FREECODE_JUDGE_PROVIDER?.trim();
  const model = process.env.FREECODE_JUDGE_MODEL?.trim();

  if (!provider) {
    return {
      ok: false,
      reason: "unconfigured",
      detail:
        "No judge configured. Set FREECODE_JUDGE_PROVIDER (and usually " +
        "FREECODE_JUDGE_MODEL) to a provider that is NOT the one under test.",
    };
  }

  if (subjectModelId) {
    const subject = splitModelId(subjectModelId);
    const sameProvider =
      subject.provider !== undefined &&
      subject.provider.toLowerCase() === provider.toLowerCase();
    const sameModel =
      model !== undefined &&
      normaliseModel(model) === normaliseModel(subject.model);

    // Either alone is enough to refuse. Same provider AND no explicit judge
    // model means the judge falls back to that provider's default, which is
    // very likely the subject; same model id under a different provider name is
    // the gateway case, where the weights are shared even though the ids differ.
    if (sameModel || (sameProvider && !model)) {
      return {
        ok: false,
        reason: "same-model",
        detail:
          `Judge (${provider}/${model ?? "<default>"}) resolves to the model ` +
          `under test (${subjectModelId}). A model grading itself measures ` +
          `self-similarity, not quality. Configure a different provider.`,
      };
    }
  }

  return { ok: true, judge: { provider, model } };
}

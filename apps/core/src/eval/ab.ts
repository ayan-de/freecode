// =============================================================================
// Paired A/B — pure logic. Spec `2026-08-29-eval-case-registry.md` §6.
//
// `compare.ts` diffs two FINISHED reports, so everything that drifted between
// the two run dates — a rolled snapshot behind a stable alias, a provider-side
// routing change, a different cache state — is confounded into the delta and
// reported as ours. This runs both sides now, interleaved, so the only
// difference left is the one under test.
//
// NOT a gate. Writes nothing to `eval_runs.jsonl`, has no baseline, and always
// exits 0. Results are noisy model-backed signals reported as paired deltas.
// =============================================================================

/** One side of the comparison: what to change before running the trial. */
export interface Variant {
  /** `provider/model`, or bare model. Absent = whatever the config resolves. */
  model?: string;
  /** Env overrides. A key set to `undefined` is UNSET, not set to "". */
  env: Record<string, string | undefined>;
}

export class AbError extends Error {}

/**
 * `model=p/m,env:FOO=1,env:BAR=` — comma-separated assignments.
 *
 * An empty string is the identity variant, which is how you A/B one axis while
 * leaving the other at whatever the config says. `env:BAR=` UNSETS `BAR`: the
 * difference between "absent" and "empty string" matters to every
 * `isEnvTruthy`-style reader in the codebase, so it has to be expressible.
 */
export function parseVariant(spec: string, label: string): Variant {
  const variant: Variant = { env: {} };
  for (const raw of spec.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) {
      throw new AbError(
        `${label}: '${part}' is not an assignment — use model=<p/m> or env:NAME=value`,
      );
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1);
    if (key === "model") {
      if (!value.trim()) throw new AbError(`${label}: 'model=' needs a value`);
      variant.model = value.trim();
    } else if (key.startsWith("env:")) {
      const name = key.slice(4).trim();
      if (!name) throw new AbError(`${label}: 'env:' needs a variable name`);
      variant.env[name] = value === "" ? undefined : value;
    } else {
      throw new AbError(
        `${label}: unknown key '${key}' — expected 'model' or 'env:NAME'`,
      );
    }
  }
  return variant;
}

/**
 * Which side runs first on this trial. Alternating cancels ordering and
 * warm-cache bias; with prompt caching in play that bias is not small, and a
 * fixed order silently advantages whichever side runs second.
 */
export function trialOrder(trialIndex: number): ["baseline", "candidate"] | ["candidate", "baseline"] {
  return trialIndex % 2 === 0
    ? ["baseline", "candidate"]
    : ["candidate", "baseline"];
}

/** Credential-shaped values never reach an artifact. */
export function redactValue(key: string, value: string | undefined): string {
  if (value === undefined) return "<unset>";
  return /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)
    ? "[redacted]"
    : value;
}

export function redactVariant(v: Variant): Record<string, string> {
  const out: Record<string, string> = {};
  if (v.model) out.model = v.model;
  for (const [k, val] of Object.entries(v.env)) {
    out[`env:${k}`] = redactValue(k, val);
  }
  return out;
}

export type Delta =
  | "improved"
  | "regressed"
  | "unchanged-pass"
  | "unchanged-fail"
  | "inconclusive";

export interface SideTally {
  /** Trials that passed. */
  passed: number;
  /** Trials that ran at all — a trial that died on infrastructure does not. */
  ran: number;
}

/**
 * The paired verdict for one case.
 *
 * `inconclusive` is the honest answer for a low-trial paired run, and refusing
 * to emit it is how an A/B harness launders noise into a decision. Three ways
 * to get it:
 *
 *   1. A side did not complete every trial — an infrastructure failure is not
 *      evidence about the change.
 *   2. `trials < 2`. A single paired trial cannot separate a real effect from
 *      one sample of a stochastic model, whatever the two results were.
 *   3. The majorities differ but the gap is ONE trial. At N=3 that is 2/3 vs
 *      1/3, which is exactly the resolution the trial count cannot support.
 *      Calling it a regression is how a green suite gets reverted for nothing.
 */
export function classify(
  baseline: SideTally,
  candidate: SideTally,
  trials: number,
): Delta {
  if (baseline.ran < trials || candidate.ran < trials) return "inconclusive";
  if (trials < 2) return "inconclusive";

  const bMajority = baseline.passed * 2 > trials;
  const cMajority = candidate.passed * 2 > trials;
  if (bMajority === cMajority) {
    return bMajority ? "unchanged-pass" : "unchanged-fail";
  }
  if (Math.abs(candidate.passed - baseline.passed) < 2) return "inconclusive";
  return cMajority ? "improved" : "regressed";
}

/** Verdicts that say something happened, in the order a reader cares about. */
export const NOTABLE: Delta[] = ["regressed", "improved", "inconclusive"];

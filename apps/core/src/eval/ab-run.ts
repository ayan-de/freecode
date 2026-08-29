// =============================================================================
// Paired A/B — the run loop. Spec `2026-08-29-eval-case-registry.md` §6.
//
// Impure half of `ab.ts`: applies a variant, drives the real trial, restores.
// Everything worth testing without a token lives next door.
// =============================================================================

import { execFileSync } from "child_process";
import { loadSuite } from "./dataset.js";
import { initRunner, runTrial, type RunnerConfig } from "./runner.js";
import {
  AbError,
  classify,
  redactVariant,
  trialOrder,
  type Delta,
  type SideTally,
  type Variant,
} from "./ab.js";
import type { EvalCase, TrialResult } from "./types.js";

export interface AbOptions {
  suite: string;
  baseline: Variant;
  candidate: Variant;
  trials: number;
  /** Case ids to run. Empty = the whole suite. */
  only: string[];
}

export interface AbCaseResult {
  id: string;
  delta: Delta;
  baseline: SideTally;
  candidate: SideTally;
  /** First failure reason seen on each side, for the "why" column. */
  baselineReason?: string;
  candidateReason?: string;
}

export interface AbReport {
  suite: string;
  ranAt: string;
  trials: number;
  /** Redacted. See `redactVariant`. */
  sides: { baseline: Record<string, string>; candidate: Record<string, string> };
  /** Provenance: which tree produced these numbers. */
  commit?: string;
  /** What each side's provider said it actually served (`model-echo.ts`). */
  served: { baseline: string[]; candidate: string[] };
  cases: AbCaseResult[];
}

/**
 * Swap in a variant's env, run, put it back — even if the body throws.
 *
 * In-process rather than a spawn because `runner.ts` is deliberately in-process
 * (so a case can be stepped through in a debugger). That works here only
 * because every setting an A/B would flip is read per-turn:
 * `loadRedirectSettings` re-reads `process.env` on every iteration. A setting
 * cached at boot would need a different mechanism, and silently would not vary.
 */
async function withEnv<T>(
  env: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(env)) {
    previous.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await body();
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function configFor(base: RunnerConfig, variant: Variant): RunnerConfig {
  if (!variant.model) return base;
  const slash = variant.model.indexOf("/");
  return slash > 0
    ? {
        ...base,
        provider: variant.model.slice(0, slash),
        model: variant.model.slice(slash + 1),
      }
    : { ...base, model: variant.model };
}

function commitSha(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export async function runAb(
  options: AbOptions,
  onCase?: (result: AbCaseResult) => void,
): Promise<AbReport> {
  let cases = loadSuite(options.suite);
  if (options.only.length > 0) {
    const wanted = new Set(options.only);
    cases = cases.filter((c) => wanted.has(c.id));
    const missing = options.only.filter((id) => !cases.some((c) => c.id === id));
    if (missing.length > 0) {
      throw new AbError(`no such case in ${options.suite}: ${missing.join(", ")}`);
    }
  }

  const base = await initRunner();
  const configs = {
    baseline: configFor(base, options.baseline),
    candidate: configFor(base, options.candidate),
  };
  const served = { baseline: new Set<string>(), candidate: new Set<string>() };
  const results: AbCaseResult[] = [];

  for (const kase of cases) {
    const tally: Record<"baseline" | "candidate", TrialResult[]> = {
      baseline: [],
      candidate: [],
    };
    for (let i = 0; i < options.trials; i++) {
      // Alternate, so neither side is always the one paying for a cold cache.
      for (const side of trialOrder(i)) {
        const variant = side === "baseline" ? options.baseline : options.candidate;
        const trial = await withEnv(variant.env, () =>
          runTrial(kase, configs[side]),
        );
        tally[side].push(trial);
        for (const m of trial.echoedModels ?? []) served[side].add(m);
      }
    }
    results.push(summariseCase(kase, tally, options.trials));
    onCase?.(results[results.length - 1]);
  }

  return {
    suite: options.suite,
    ranAt: new Date().toISOString(),
    trials: options.trials,
    sides: {
      baseline: redactVariant(options.baseline),
      candidate: redactVariant(options.candidate),
    },
    commit: commitSha(),
    served: {
      baseline: [...served.baseline].sort(),
      candidate: [...served.candidate].sort(),
    },
    cases: results,
  };
}

function tallyOf(trials: TrialResult[]): SideTally {
  return {
    passed: trials.filter((t) => t.passed).length,
    // A trial that died before the agent ran is not evidence about the change.
    ran: trials.filter((t) => !t.reason.startsWith("run failed:")).length,
  };
}

function summariseCase(
  kase: EvalCase,
  tally: Record<"baseline" | "candidate", TrialResult[]>,
  trials: number,
): AbCaseResult {
  const baseline = tallyOf(tally.baseline);
  const candidate = tallyOf(tally.candidate);
  return {
    id: kase.id,
    delta: classify(baseline, candidate, trials),
    baseline,
    candidate,
    baselineReason: tally.baseline.find((t) => !t.passed)?.reason,
    candidateReason: tally.candidate.find((t) => !t.passed)?.reason,
  };
}

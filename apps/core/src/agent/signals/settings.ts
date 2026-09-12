// =============================================================================
// Harness-signal settings — project → user → default, the same scope order as
// `redirect/settings.ts` so the two never disagree.
//
// All three gates are OFF by default, for the same reason redirection is: each
// one changes what the loop does after the model has decided, and the
// criterion for flipping a default is an `eval ab` delta, not a hunch. What is
// always on is the *recording* — the rollout log carries the todo scores and
// the poke decisions whether or not a gate fired, so the bench can measure
// before/after (`bench/harness-signals/`).
//
//   ~/.freecode/settings.json  or  <project>/.freecode/settings.json
//   {
//     "signals": {
//       "autoPoke":       { "enabled": true, "maxPerRun": 3 },
//       "confidenceGate": { "enabled": true, "spike": 40 },
//       "hillClimbGate":  { "enabled": true, "threshold": 90 }
//     }
//   }
//
// Env: FREECODE_AUTO_POKE, FREECODE_CONFIDENCE_GATE, FREECODE_HILLCLIMB_GATE —
// "1" switches a gate on, "0" off, either beating the files. That is how a
// bench run flips one gate for one trial without editing anybody's settings.
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const AUTO_POKE_MAX_PER_RUN = 3;
/** A completion-step rise of this many points or more, in one call, is a spike. */
export const CONFIDENCE_SPIKE = 40;
/** jcode's "reframe below 90". */
export const HILL_CLIMB_THRESHOLD = 90;

export interface SignalSettings {
  autoPoke: { enabled: boolean; maxPerRun: number };
  confidenceGate: { enabled: boolean; spike: number };
  hillClimbGate: { enabled: boolean; threshold: number };
}

export const DEFAULT_SIGNAL_SETTINGS: SignalSettings = {
  autoPoke: { enabled: false, maxPerRun: AUTO_POKE_MAX_PER_RUN },
  confidenceGate: { enabled: false, spike: CONFIDENCE_SPIKE },
  hillClimbGate: { enabled: false, threshold: HILL_CLIMB_THRESHOLD },
};

type Scope = Partial<{
  autoPoke: Partial<SignalSettings["autoPoke"]>;
  confidenceGate: Partial<SignalSettings["confidenceGate"]>;
  hillClimbGate: Partial<SignalSettings["hillClimbGate"]>;
}>;

function readScope(filePath: string): Scope | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      signals?: Scope;
    };
    return parsed.signals;
  } catch {
    return undefined;
  }
}

/** "1"/"true"/"yes" → true, "0"/"false"/"no" → false, anything else → unset. */
export function envFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return undefined;
}

function pickBool(scopes: Scope[], key: keyof Scope): boolean | undefined {
  for (const s of scopes) {
    const v = s[key]?.enabled;
    if (typeof v === "boolean") return v;
  }
  return undefined;
}

function pickNumber(
  scopes: Scope[],
  key: keyof Scope,
  field: "maxPerRun" | "spike" | "threshold",
): number | undefined {
  for (const s of scopes) {
    const v = (s[key] as Record<string, unknown> | undefined)?.[field];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
  }
  return undefined;
}

export function resolveSignalSettings(
  scopes: Scope[],
  env: NodeJS.ProcessEnv = process.env,
): SignalSettings {
  const d = DEFAULT_SIGNAL_SETTINGS;
  return {
    autoPoke: {
      enabled:
        envFlag(env.FREECODE_AUTO_POKE) ??
        pickBool(scopes, "autoPoke") ??
        d.autoPoke.enabled,
      maxPerRun: pickNumber(scopes, "autoPoke", "maxPerRun") ?? d.autoPoke.maxPerRun,
    },
    confidenceGate: {
      enabled:
        envFlag(env.FREECODE_CONFIDENCE_GATE) ??
        pickBool(scopes, "confidenceGate") ??
        d.confidenceGate.enabled,
      spike: pickNumber(scopes, "confidenceGate", "spike") ?? d.confidenceGate.spike,
    },
    hillClimbGate: {
      enabled:
        envFlag(env.FREECODE_HILLCLIMB_GATE) ??
        pickBool(scopes, "hillClimbGate") ??
        d.hillClimbGate.enabled,
      threshold:
        pickNumber(scopes, "hillClimbGate", "threshold") ?? d.hillClimbGate.threshold,
    },
  };
}

export function loadSignalSettings(projectRoot: string): SignalSettings {
  const scopes = [
    path.join(projectRoot, ".freecode", "settings.json"),
    path.join(os.homedir(), ".freecode", "settings.json"),
  ]
    .map(readScope)
    .filter((s): s is Scope => s !== undefined);
  return resolveSignalSettings(scopes);
}

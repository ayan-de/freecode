// =============================================================================
// The known shape of `.freecode/settings.json`.
//
// Four modules read this file independently — permissions, hooks, memory and
// redirect — and each ignores everything it does not recognise. That is the
// right behaviour per reader, but the sum of it was that an unknown key was
// indistinguishable from a broken feature: `"permission"` for `"permissions"`
// silently disabled every rule in a security-relevant, hand-edited file, with
// nothing on stderr.
//
// This module is the one place that knows the whole shape, so it can say
// "unknown key" — and, when the key is a near miss, which key was meant.
//
// It is a NAME check, not a schema validator. Values stay each reader's
// business: they already validate and default their own, and duplicating
// those rules here would create a second, slowly diverging contract. The JSON
// Schema shipped at `schemas/settings.schema.json` covers types for editors,
// and `known-keys.test.ts` pins the two together.
// =============================================================================

/** Ignored everywhere, but conventional and useful — editors key off it. */
export const SCHEMA_KEY = "$schema";

export const KNOWN_SETTINGS: Readonly<
  Record<string, readonly string[] | "any">
> = {
  permissions: ["allow", "ask", "deny"],
  // Sub-keys are hook EVENT names, and `hooks/settings.ts` already warns on an
  // unknown one with the full valid list. Left uninspected here so a typo'd
  // event gets one good message rather than two in different words.
  hooks: "any",
  memory: [
    "autoExtract",
    "extractEveryNRuns",
    "retrievalJudge",
    "autoConsolidate",
    "consolidateMinHours",
    "consolidateMinSessions",
  ],
  redirect: ["enabled", "maxPerRun"],
};

/**
 * Levenshtein distance, bounded by an early exit — we only ever care whether
 * a key is within a typo's reach of a real one.
 */
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const row = [i, ...new Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[cols - 1];
}

/** The known key a typo most likely meant, or undefined if none is close. */
function nearest(key: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  const lower = key.toLowerCase();
  for (const candidate of candidates) {
    const d = distance(lower, candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  // Two edits on a short key is already a stretch; beyond that a suggestion
  // is noise that sends the reader after the wrong fix.
  const limit = Math.min(2, Math.max(1, Math.floor(key.length / 3)));
  return bestDistance <= limit ? best : undefined;
}

export interface SettingsWarning {
  /** Dotted path to the offending key, e.g. `memory.autoExtracts`. */
  path: string;
  message: string;
}

/**
 * Report keys this codebase does not read. Pure — the caller decides whether
 * to log, print or ignore.
 */
export function findUnknownSettings(
  settings: Record<string, unknown>,
): SettingsWarning[] {
  const warnings: SettingsWarning[] = [];
  const topLevel = Object.keys(KNOWN_SETTINGS);

  for (const [key, value] of Object.entries(settings)) {
    if (key === SCHEMA_KEY) continue;
    if (!(key in KNOWN_SETTINGS)) {
      const suggestion = nearest(key, topLevel);
      warnings.push({
        path: key,
        message: suggestion
          ? `Unknown setting "${key}" — did you mean "${suggestion}"?`
          : `Unknown setting "${key}" (known settings: ${topLevel.join(", ")})`,
      });
      continue;
    }

    const known = KNOWN_SETTINGS[key];
    if (known === "any") continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      // A wrong-typed section is the reader's call to make (it fails closed
      // and says so); flagging it here would double up on that message.
      continue;
    }
    for (const sub of Object.keys(value as Record<string, unknown>)) {
      if (known.includes(sub)) continue;
      const suggestion = nearest(sub, known);
      warnings.push({
        path: `${key}.${sub}`,
        message: suggestion
          ? `Unknown setting "${key}.${sub}" — did you mean "${key}.${suggestion}"?`
          : `Unknown setting "${key}.${sub}"`,
      });
    }
  }

  return warnings;
}

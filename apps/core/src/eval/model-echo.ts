// =============================================================================
// Model echo — what we asked for versus what the provider says it served.
// Spec `2026-08-29-eval-case-registry.md` §6.
//
// §9.2 makes the resolved model part of baseline identity, which catches an id
// CHANGE. It cannot catch the same id serving different weights: `model` in the
// report is the id we sent, and until `echoedModel` existed the log recorded
// that same local variable on both sides of the round trip, so a silent
// snapshot roll under a stable alias was invisible in every artifact we keep.
//
// DISCLOSURE, NOT DETECTION — the same instinct as `SuiteReport.judge`. The
// echo is recorded on every run and a disagreement is reported, never blocked
// on. Blocking would be wrong twice over: an alias resolving to a dated
// snapshot is normal, and a provider that echoes nothing at all is silence, not
// evidence.
// =============================================================================

import type { Trace } from "../rollout/trace.js";

/** Distinct echoed ids in a trace, sorted. Empty when no span carried one. */
export function echoedModels(trace: Trace): string[] {
  const seen = new Set<string>();
  for (const span of trace.modelSpans) {
    if (span.echoedModel) seen.add(span.echoedModel);
  }
  return [...seen].sort();
}

/**
 * Echoed ids that do NOT plausibly answer the requested one.
 *
 * Tolerant on purpose. Two normal shapes are not disagreements:
 *
 *   - the request is `provider/model` and the echo is the bare `model`, since
 *     the provider has no reason to repeat our routing prefix;
 *   - the echo EXTENDS the request — `claude-sonnet-4-6` answered by
 *     `claude-sonnet-4-6-20260101`. An alias resolving to a dated snapshot is
 *     the documented behaviour of every provider we support, and flagging it
 *     would make this report noise on the first run and ignored by the second.
 *
 * What is left is the case worth a human's attention: an echo that is not the
 * requested model at all.
 */
export function echoDisagreements(
  requested: string | undefined,
  echoed: string[],
): string[] {
  if (!requested) return [];
  const bare = requested.includes("/")
    ? requested.slice(requested.indexOf("/") + 1)
    : requested;
  const want = bare.toLowerCase();
  return echoed.filter((id) => !id.toLowerCase().startsWith(want));
}

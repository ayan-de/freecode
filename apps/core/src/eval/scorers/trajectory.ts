// =============================================================================
// Trajectory scorer — did the right tool fire, with the right args, without
// touching what it shouldn't, in a sane number of turns.
//
// Pure fold over `Trace`. Reads no text: an agent can produce the right final
// message while making duplicate calls and editing files it was told not to,
// and an outcome-only check rates that perfect (spec §4).
// =============================================================================

import { describeMatcher, matchArg } from "../match.js";
import type { EvalCase, RunRecord, TrialScore } from "../types.js";

const pass: TrialScore = { passed: true, reason: "ok" };
const fail = (reason: string): TrialScore => ({ passed: false, reason });

export function scoreTrajectory(run: RunRecord, kase: EvalCase): TrialScore {
  const spans = run.trace.toolSpans;
  const fired = spans.map((s) => s.tool);

  // A hung or errored model call is never a pass, however the tools look —
  // otherwise a case can go green off a trajectory that never finished.
  if (run.trace.hung) return fail("model call hung");
  const errored = run.trace.modelSpans.find((s) => s.status === "error");
  if (errored) return fail(`model error: ${errored.errorKind ?? "unknown"}`);

  for (const forbidden of kase.forbidTools ?? []) {
    if (fired.includes(forbidden)) return fail(`called forbidden ${forbidden}`);
  }

  if (kase.expectMaxTurns !== undefined) {
    const turns = run.trace.modelSpans.length;
    if (turns > kase.expectMaxTurns) {
      return fail(`${turns} turns, wanted <= ${kase.expectMaxTurns}`);
    }
  }

  // `expectTool: null` asserts that nothing fired — the "just answer, don't
  // go rummaging" case, which is a real regression when it breaks.
  if (kase.expectTool === null) {
    return fired.length === 0 ? pass : fail(`expected no tool, called ${fired}`);
  }

  if (kase.expectTool !== undefined) {
    if (!fired.includes(kase.expectTool)) {
      return fail(
        `expected ${kase.expectTool}, called ${fired.length ? fired.join(",") : "nothing"}`,
      );
    }
  }

  const expectations = Object.entries(kase.expectInArgs ?? {});
  if (expectations.length > 0) {
    if (kase.expectTool == null) {
      return fail("expectInArgs needs expectTool");
    }
    // Any invocation of the tool may satisfy the expectation. A model that
    // greps twice, badly then well, has still done the right thing.
    const candidates = spans.filter((s) => s.tool === kase.expectTool);
    const withArgs = candidates.filter((s) => s.args !== undefined);
    if (withArgs.length === 0) {
      return fail(`no recorded args for ${kase.expectTool}`);
    }
    for (const [key, matcher] of expectations) {
      const ok = withArgs.some((s) => matchArg(matcher, s.args?.[key]));
      if (!ok) {
        return fail(`${describeMatcher(matcher)} not in args[${key}]`);
      }
    }
  }

  return pass;
}

# Trajectory Redirection — evidence-backed recovery from a stuck loop

> **Date:** 2026-08-26
> **Status:** Phases 0–1 shipped (2026-08-26/27), redirection built and **off by
> default**. Phase 2 ran and returned *do not flip* (§9.1). Phase 3 is half done:
> the budget-sourced cap exists, the report section waits on autonomous runs.
> **Derived from:** `docs/superpowers/AVO_ARCHITECTURE_COMPARISON.md` §"The best ideas
> to take" §1, which reads *AVO: Agentic Variation Operators for Autonomous Evolutionary
> Search* (Chen et al., NVIDIA, arXiv:2603.24517v1) §3.3 — the conditional supervisor
> that "reviews the overall evolutionary trajectory and steers the search toward several
> candidate optimization directions" when the agent stalls or enters unproductive cycles.
> **Extends:** the loop-health heuristics in `agent/loop.ts` + `agent/types.ts:200`.
> **Measured by:** `specs/2026-08-23-eval-harness.md` (Phases 0–1, shipped).
> **Feeds:** `specs/2026-08-10-autonomous-runs-design.md` — a Tier A run needs a
> supervisor; this is that supervisor, built and measured first in the attended case.
> **Explicitly not:** a candidate lineage, a scored archive, auto-commits, or a second
> agent with tools. See §10.

---

## 1. Problem

FreeCode detects stuck loops and then does almost nothing with the detection.

`AgentLoop.evaluateLoopHealth()` (`agent/loop.ts:2493`) returns one of three actions
per iteration, checked at `agent/loop.ts:717`:

| Action | Reasons | What happens today |
| --- | --- | --- |
| `stop` | `repeated_identical_tool` (2× threshold), `oscillation_detected` (2×), `max_iterations_reached` | `this.stop()` then `complete("Loop stopped: <reason>")` — the run dies mid-task and the user gets a one-line reason (`agent/loop.ts:718-726`) |
| `warn` | `repeated_identical_tool` (1×), `no_progress`, `oscillation_detected` (1×) | `logger.debug(...)` — **invisible at the default log level, and never reaches the model** (`agent/loop.ts:728`) |
| `continue` | — | nothing |

So the system's entire response to "this agent is going in circles" is to keep funding
the circle until it is twice as bad, then kill the run. The information that would let
the model do something different — *what* it repeated, *what* failed, *what* it has
already tried — is sitting in the rollout log, unread.

Three defects found while writing this spec, all independent of the feature. **All
three are fixed as of Phase 0 (§8); the descriptions below are kept as the record of
what was wrong and why it had to be fixed first.**

**1.1 `no_progress` counts tool calls, not turns.** `updateLoopHealth()` is called once
per tool result (`agent/loop.ts:1576`) and increments `stagnantTurns` whenever the tool
was not a successful destructive one (`agent/loop.ts:2443-2452`). With
`stagnantTurnsThreshold: 5` (`agent/types.ts:217`), **five consecutive reads trip it** —
which is what reading a codebase looks like. The comment on the field says "5 turns with
no file changes" (`agent/types.ts:203`); the code means five tool calls. Today this is
harmless because the warn goes to `logger.debug`. The moment a warn costs a model call,
it is a bill for doing normal work. This must be fixed *before* anything hangs off the
signal, and it is worth fixing regardless.

**1.2 `oscillationScore` never decays.** It only ever increments (`agent/loop.ts:2481`).
One genuine edit/revert pair early in a long session leaves the counter armed forever;
four of them at any point in a run mean every subsequent iteration evaluates to `warn`.
A trigger built on the raw counter would fire on every turn for the rest of the run.

**1.3 The evaluator exists twice.** `effect/loop-health.ts:21` (`createLoopHealthEvaluator`)
is logic-identical to the private `AgentLoop.evaluateLoopHealth()` and is **never
invoked** — `effect/layers.ts:50` only re-exports it. Two copies of a policy that is
about to gain a fourth caller is how they drift.

## 2. What AVO actually does, and what transfers

AVO's supervisor (§3.3) is a *conditional intervention*: a separate agent that watches
for stalling or repeated non-improvement, reads the trajectory, and proposes several
fresh optimization directions. The main agent stays in charge of editing. Over the
paper's 7-day run it fired only "during periods of stagnation" across 40 committed
versions and ~500 explored directions.

Three properties transfer directly:

- **Conditional, not continuous.** It is not a second brain reviewing every turn. It is
  a recovery point that costs nothing when the run is healthy.
- **Trajectory-grounded.** Its input is the record of what was tried, not a re-read of
  the task statement.
- **Advisory.** It redirects; it does not edit, does not evaluate, does not admit work.

One property does not transfer: AVO's supervisor is judged against an external scoring
function `f`, so "non-improvement" is a measured fact. FreeCode has no such scalar in an
ordinary session. Our trigger is therefore behavioural (repetition, oscillation, no file
change), which is a weaker signal — hence the caps in §5 and the fail-closed rule in §6.

## 3. Design in one paragraph

On a loop-health `warn` that passes the trigger policy, fold the session's rollout
events into a bounded evidence packet, make **one** small non-streaming model call
asking for up to three materially different next directions, and push the answer into
`pendingReminders` so it rides into the next turn as a `<system-reminder>` — the exact
mechanism the todo nudge and wrap-up reminder already use (`agent/loop.ts:713`, `:736`,
flushed at `:1372`). Cap it at two redirections per run, one per reason. Count its
tokens against the run's spend. Record the event in rollout. If anything fails or times
out, do nothing and continue exactly as today.

No new execution path, no new permission surface, no tool access for the supervisor.

## 4. Module layout

```
apps/core/src/agent/redirect/
  policy.ts       # pure: LoopAction + counters + history → RedirectDecision
  evidence.ts     # pure: RolloutEvent[] + loop state → EvidencePacket (bounded)
  prompt.ts       # supervisor prompt template + redirectReminder() text
  supervisor.ts   # one provider.execute() call, timeout, parse, fail-closed
  index.ts
```

Touched files: `agent/loop.ts` (trigger site + counter fix), `agent/types.ts`
(`RedirectState` on `SessionState`), `rollout/types.ts` + `rollout/recorder.ts` (two
events), `effect/loop-health.ts` (becomes the single evaluator), `effect/layers.ts`.

Every file stays under the 150-line guidance in `CLAUDE.md` except `loop.ts`, which is
the documented exception and gains roughly 20 lines.

## 5. Decisions

### D1 — Fix the counters before hanging anything off them

`stagnantTurns` moves out of `updateLoopHealth()` and into the per-turn path: at turn
end, if no destructive tool succeeded during that turn, increment; otherwise reset to 0.
The threshold stays 5, and now means what its comment always claimed. `oscillationScore`
gains the same decay treatment as `repeatedTools` already has implicitly (which is
derived from a 10-entry sliding window, `agent/loop.ts:2423`): keep only reverts observed
within the last `RECENT_EDIT_WINDOW` edits, so the score can fall as well as rise.

Both changes are behaviour-visible on their own: fewer spurious `warn`s, and a run that
recovers from one oscillation is no longer permanently armed. They ship as Phase 0, with
tests, ahead of the feature — see §8.

### D2 — Only three reasons trigger, and each fires once per run

Trigger on `warn` with reason `repeated_identical_tool`, `oscillation_detected`, or
`no_progress` (post-D1). Never on `stop`: at that point the run is over and the honest
answer is to hand back to the user, not to spend more money re-planning a corpse.
`max_iterations_reached` is a budget, not a pathology — `wrapUpReminder()` already
handles it (`agent/loop.ts:712`).

Caps, all enforced in `policy.ts`:

| Cap | Value | Rationale |
| --- | --- | --- |
| Per run | 2 | Mirrors `MAX_VERIFY_ATTEMPTS = 2` (`agent/verify.ts:14`). A third redirection means the advice is not the problem. |
| Per reason | 1 | Re-advising on an unchanged reason produces the same advice. |
| Debounce | ≥ 3 turns since the last redirection | The model needs turns to act on advice before being judged again. |
| Subagents | disabled | A subagent is already turn-capped and disposable; its parent is the right place to re-plan. `AgentLoopConfig` gains `redirect?: boolean`, defaulted `false` in `agent/subagent.ts`. |

After a redirection fires, the triggering counter is reset (`repeatedTools`,
`oscillationScore`, or `stagnantTurns` → 0). Without this the same `warn` recurs on the
very next iteration and only the caps stop a loop of supervisors — which works, but
wastes the debounce window and muddies the eval signal.

### D3 — The evidence packet is a pure fold of the rollout log, bounded to ~2 KB

`buildEvidence(events, state, todos)` in `evidence.ts`, pure and directly unit-testable,
reusing `buildTrace()` (`rollout/trace.ts:86`) — `ToolSpan` already carries `args`
(`rollout/trace.ts:49`), which is the part that makes "you called `grep` with the same
pattern six times" expressible.

```ts
export interface EvidencePacket {
  reason: "repeated_identical_tool" | "oscillation_detected" | "no_progress";
  turnCount: number;
  /** The user's original request, first 400 chars. The only free text from the
   *  transcript; the supervisor cannot redirect without knowing the goal. */
  goal: string;
  /** Last ≤ 12 tool spans: name, duration, one-line arg digest, ok/error. */
  recentCalls: { tool: string; args: string; failed: boolean }[];
  /** The exact repeated signature, when the reason is repetition. */
  repeatedSignature?: string;
  /** Files touched this run, from destructive tool spans. */
  changedFiles: string[];
  /** Last ≤ 3 distinct tool error strings, 200 chars each. */
  errors: string[];
  /** Current plan, from getTodos(sessionId) (`tools/todo.ts`). */
  todos: { content: string; status: string }[];
  /** Rollout event ids folded into this packet — the audit trail (§7). */
  evidenceEventIds: string[];
}
```

Hard cap: the rendered packet is truncated to 2 000 characters before it goes into the
prompt. A supervisor that needs more than that is being asked to re-derive the session,
which is the compaction subsystem's job, not this one.

### D4 — One non-streaming call, same provider, small budget, 15 s timeout

`supervisor.ts` follows the shape already used by `agent/title-generator.ts:53` and
`memory/extract.ts:100`: `getProvider(providerId).execute({ prompt, system, maxTokens })`.
Same provider as the run (no cross-provider surprises on an API key the user has not
configured), `maxTokens: 400`, `AbortSignal.timeout(15_000)`.

**Synchronous, not one-turn-behind.** The memory graph's async injection pattern
(`memory/graph/index.ts`) is the right call when the payload is a nice-to-have. Here the
turn being delayed is by definition an unproductive one, and advice that arrives a turn
late can arrive *after* the 2× hard-stop tier has already killed the run. Fifteen seconds
on a stuck loop is a good trade; state it plainly in the code comment so nobody
"optimizes" it into a race.

### D5 — Ask for up to three directions and inject all of them

The parent document says "inject one concise direction." This spec deviates: the
supervisor returns 2–3 short directions and all of them are injected, ranked, capped at
600 characters total.

Rationale: picking one requires a ranking rule, and the supervisor has strictly less
information than the agent it is advising — it sees a 2 KB digest, the agent has the full
transcript. AVO's own supervisor "steers the search toward several candidate optimization
directions" (§3.3). Handing over a shortlist keeps the choice where the information is.

Expected output, parsed leniently (numbered lines; anything unparseable → §6):

```
1. <direction, ≤ 200 chars, imperative, references specific evidence>
2. ...
3. ...
```

The reminder wraps them in the house `<system-reminder>` format
(`agent/reminders.ts:63` is the template to match), states the observed pattern in one
line, and ends with the standard "Never mention this reminder to the user."

### D6 — Fail closed, always

Provider error, timeout, empty response, fewer than one parseable direction, or a
response that exceeds the character cap after truncation → **no redirection**. Record
`redirect.skipped` with the reason, log at `debug`, continue the loop exactly as it
behaves today. The supervisor is never allowed to end a run, block a turn beyond its
timeout, or surface an error to the user. This matches the retrieval judge's
fail-closed rule (`memory/judge.ts`) and is the property that makes the feature safe to
default-on later.

### D7 — Supervisor tokens count against the run's budget

`provider.execute()` returns usage; add it to `totalInputTokens` / `totalOutputTokens`
in `loop.ts` and to `recordDailyUsage()`. This is not bookkeeping pedantry: the spend
circuit breaker at `agent/loop.ts:823` (`FREECODE_MAX_TURN_TOKENS`) exists precisely
because "loop-health only warns on a stuck pattern, nothing previously capped actual
spend." A supervisor whose cost is invisible to that breaker reintroduces the hole it
was built to close.

### D8 — Off by default in v1, flipped only on measured evidence

Settings, resolved project → user → default, mirroring `loadMemorySettings()`
(`memory/extract-policy.ts:109`):

```jsonc
// .freecode/settings.json
{ "redirect": { "enabled": false, "maxPerRun": 2 } }
```

Env kill switch `FREECODE_DISABLE_REDIRECT=1`, matching the
`FREECODE_DISABLE_MEMORY_*` convention (`memory/extract-policy.ts:25`).

Default `false` until §9's measurement shows a non-negative delta. Shipping this
default-on and *then* measuring would mean every user pays for an unvalidated model call
on a signal we already know produces false positives (§1.1). The flip criterion is
written down in §9 so it is a fact, not a judgement call.

### D9 — The supervisor gets no tools, no permissions, no verifier access

It is a single text completion. It cannot read files, cannot run commands, cannot alter
the permission profile or agent mode, cannot change `resolveVerifyCommand()`
(`agent/verify.ts:49`), and cannot extend `maxIterations` or any budget. Everything it
produces is advice the agent is free to ignore — and §9 measures how often it does.

### D10 — Collapse the duplicate evaluator

`agent/loop.ts` calls `createLoopHealthEvaluator().evaluate(state, heuristics)` from
`effect/loop-health.ts`; the private `evaluateLoopHealth()` is deleted. Required by D1
(the counter semantics change lives in one place) and by the DRY principle in
`CLAUDE.md`. Purely mechanical — the two implementations are currently identical.

## 6. Rollout events

Two additions to the `RolloutEvent` union (`rollout/types.ts:27`) plus recorder methods
(`rollout/recorder.ts:179` is the pattern):

```ts
export interface RedirectTriggeredEvent extends BaseEvent {
  type: "redirect.triggered";
  turnId: string;
  reason: string;             // loop-health reason
  evidenceEventIds: string[]; // what the packet was folded from
  directionCount: number;
  directionChars: number;
  latency_ms: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface RedirectSkippedEvent extends BaseEvent {
  type: "redirect.skipped";
  turnId: string;
  reason: string;             // "cap_reached" | "debounced" | "timeout" | "unparseable" | "provider_error" | "disabled"
}
```

**No direction text in the rollout log.** OTLP export consumes a `Trace`
(`rollout/otlp.ts:105`), which is a fold of these events, and the eval harness leans on
the log carrying no message bodies (`eval/types.ts` `RunRecord` doc-comment; eval spec
§5.2). Model-authored advice can quote code, so it stays out. The full text is already
durable where it belongs — it is injected into the transcript, so the thread store and
`freecode session export` have it, and the TUI shows it.

The doc's acceptance criterion "the redirection cites the exact trajectory evidence used
to form it" is satisfied by `evidenceEventIds`: given a rollout log you can reconstruct
the exact packet, because `buildEvidence` is pure.

`buildTrace()` folds the two events into `Trace` as counts only
(`redirects: number; redirectsSkipped: number`), which keeps `freecode trace` and OTLP
useful and leak-free.

## 7. Frontend surface

`StreamEvent` gains nothing in v1. The reminder is a system reminder like every other
one — the TUI does not render `pendingReminders` today and should not start here. The
visible artifacts are `freecode trace <id>` (counts) and the rollout log.

When autonomous runs (Tier A) land, its review report reads `redirect.triggered` events
from the log — that is the "shown in the final unattended-run report" requirement from
the parent document, and it belongs to that spec, not this one.

## 8. Phasing

**Phase 0 — counter repair (ships alone, no feature). ✅ Shipped 2026-08-26.**
D1 + D10. `stagnantTurns` moved to the per-turn path (`AgentLoop.advanceStagnation()`,
fed by a new `madeFileChange` field on the turn result); `oscillationScore` is now
`countReverts()` over the recent-edit window (`agent/oscillation.ts`) rather than a
monotonic counter; the private `AgentLoop.evaluateLoopHealth()` is deleted in favour of
`createLoopHealthEvaluator()` (`effect/loop-health.ts`). Tests in
`agent/stagnation.test.ts` and `agent/oscillation.test.ts`: five consecutive reads no
longer warn; five turns with no successful destructive tool do; an edit/revert pair ages
out of the window; a successful write resets.

Eval (trajectory suite, MiniMax-M3, 1 trial, 2026-08-26): **15/20 before, 14/20 after**,
five failures identical across both runs. The one delta — `explore-mode-stays-readonly`,
6 turns against a limit of 5 — re-ran **5/5 pass** on the Phase 0 code, so it is
single-trial sampling noise, not a regression. That is the expected result: Phase 0
cannot change turn counts, because `no_progress` has no stop tier and a `warn` still only
reaches `logger.debug`. Running the suite at all required working around the harness bug
recorded in `TODO.md` (a `question` tool call ends the process at exit 0 mid-suite);
`--trials 1` is also below what §9.1 of the eval spec says is safe to gate on.

**Phase 1 — redirection behind a flag. ✅ Shipped 2026-08-27.**
`agent/redirect/` (`policy.ts`, `evidence.ts`, `prompt.ts`, `supervisor.ts`,
`settings.ts`, `index.ts`), triggered from the warn arm of `agent/loop.ts` via
`maybeRedirect()`, two rollout events, usage folded into the run totals and
`recordDailyUsage()`, settings + `FREECODE_DISABLE_REDIRECT`. Default off.
43 tests across `policy.test.ts`, `evidence.test.ts`, `supervisor.test.ts` and an
end-to-end `loop-redirect.test.ts` that drives the real loop against a fake
provider and asserts the advice reaches a later prompt and its tokens reach the
run totals.

Three deviations from §4/§5 as written, each for a reason found in the code:

1. **`settings.ts` is a sixth file.** §4 lists five, but §5's D8 requires reading
   two settings files, and `policy.ts` is specified as pure. Settings loading
   lives in its own module rather than making the policy do IO.
2. **`FunctionOutputEvent` gains `failed?: boolean`, and `ToolSpan` with it.**
   D3's packet needs to know which calls errored. The log recorded
   `result.stdout || result.error` with no way to tell which — deciding by
   scraping the wording is exactly the brittleness `updateLoopHealth` avoids
   elsewhere. The flag adds no new text to the log, it only disambiguates text
   already there. Optional, so old logs stay valid.
3. **The evidence fold reads through `recorder.readEvents()`, not
   `history.loadSessionEvents()`.** The latter resolves the default rollout path,
   so a loop with an injected recorder (tests, an alternate `rolloutDir`) would
   have formed evidence from a different log than the one it writes.

**Phase 2 — measure and flip. ⚠️ Ran 2026-08-27. Verdict: DO NOT FLIP.**
The tooling is built and the measurement was attempted; the criterion cannot be
evaluated yet, so D8's default stays `false`. See §9.1.

**Phase 3 — half done 2026-08-27; the rest still deferred.**
Autonomous-runs integration lands with `2026-08-10-autonomous-runs-design.md`, not here.
It has two seams, and only one of them was buildable:

- **Per-run cap from the run budget — ✅ built.** `RunLimits.maxRedirects` (default 2,
  matching `REDIRECT_MAX_PER_RUN`) plus `effectiveRedirectCap(settings, budgetCap)`,
  threaded through `AgentLoopConfig.budgetMaxRedirects` and used by `maybeRedirect()`.
  The budget may only *lower* the cap, never raise it: a budget says how much a run may
  spend, not how much the user meant to allow, and starting a run must not quietly buy
  more recovery than was configured. It never touches `enabled` — a budget says how
  much, never whether. Undefined for every interactive run, which is all of them until
  autonomous execution ships.
- **Report section — still deferred.** It reads `redirect.triggered` events out of the
  log into a run's `report.md`, and there is no report generator to put it in: that is
  Phase 3 of the autonomous-runs spec, which needs Phases 0–2 (execution, detach) first.

The prerequisite that *was* built is autonomous-runs **Phase 0** — `autonomous/types.ts`,
`budget.ts`, `run-store.ts`: the four-way ceiling and manifest storage as pure logic with
unit tests, no agent loop and no process spawning. That is what makes `maxRedirects` a
real field on a real budget rather than a placeholder.

## 9. Measurement

The eval harness ships (Phases 0–1: `apps/core/src/eval/`, `evals/`, `freecode eval`),
so this is measurable now rather than aspirationally.

New suite `evals/redirect.jsonl`, run with `--trials 5` on and off, comparing:

| Metric | Source | Expectation |
| --- | --- | --- |
| Case pass rate (majority-of-N) | `SuiteReport` | ≥ baseline |
| Tool repetition | `Trace.toolSpans` duplicate signatures | strictly lower on stuck cases |
| Turns to completion | `Trace.modelSpans.length` | ≤ baseline |
| Total tokens | `Trace.inputTokens + outputTokens` | ≤ baseline + supervisor cost |
| Advice-ignored rate | next turn repeats the same tool signature | reported, not gated |

**Flip criterion for D8:** pass-rate delta ≥ 0 across the standing suite, tool repetition
strictly reduced on the redirect suite, and token delta ≤ +3% on the standing suite. Any
one of these failing keeps the default off and sends the prompt back for revision.

**Known coverage gap, stated rather than papered over:** Phase 1 of the eval harness has
no sandbox, so `dataset.ts:16` refuses `build` and `danger` modes. A case that provokes
`oscillation_detected` needs real edits, which needs a mutating mode — so oscillation is
**unit-tested only** until the eval sandbox lands. `repeated_identical_tool` and
`no_progress` were expected to be reachable in `explore` mode (a read/grep loop over a
deliberately confusing fixture) and to be covered by the suite. **They are not — see
§9.1.**

## 9.1 What the measurement actually found (2026-08-27)

The suite (`evals/redirect.jsonl`, 5 cases) was built and run twice with the feature
off, ~380K tokens per run. Both runs, every case:

| Metric | Result |
| --- | --- |
| Repeated tool calls | **0**, across all 10 trials |
| Turns per case | 2–6 |
| Warnings that would have fired | 1, then 0 after the fix below |

**The flip criterion cannot be evaluated, so the default stays off.** Not because the
candidate lost — because the experiment has no signal:

1. *"Tool repetition strictly lower"* is unmeasurable against a baseline of **0**. It
   cannot go lower. MiniMax-M3 does not re-issue verbatim tool calls on these prompts;
   it searches, concludes, and stops.
2. `oscillation_detected` remains unreachable without a sandbox, as already known.
3. `no_progress` — the one reason that did fire — **should not have.** See below.

**The bug the measurement found.** The single warning came from a healthy 6-turn
`explore` case. In a read-only mode *nothing the agent is permitted to do can reset the
stagnation counter*, because the modes exist precisely to prevent file changes. So
`stagnantTurns` climbs to the threshold on any exploration past five turns and stays
there, reporting "no progress" for a mode whose entire job is to make none. Harmless
while a warn was only `logger.debug`; with Phase 1 on, it is a model call billed for
doing exactly what the mode is for — the same class of defect as §1.1, found the same
way, one layer further in.

Fixed by not advancing the counter in read-only modes (`isReadOnlyMode()`,
`permission/mode-policy.ts`), with tests over all three. Re-running the probe confirmed
the warning disappears. This is why Phase 2 is worth running even when it cannot reach a
verdict: it caught a defect that unit tests, and the spec's own author, had not.

**Consequence.** End-to-end measurement of this feature is blocked on the eval sandbox,
not on the prompt. The machinery is proven by unit tests and by `loop-redirect.test.ts`,
which drives the real loop and asserts the advice reaches the next prompt; what cannot
yet be shown is that the advice *helps* on real work. Until then the default stays off,
and that is the correct outcome rather than a disappointing one.

Do **not** close this by writing a case that instructs the model to repeat a call. A
flip earned on a manufactured signal is worse than no flip: it would report the feature
works on a phenomenon it has never actually seen.

Acceptance criterion 5's last case — **the agent ignores the advice** — is
deliberately not a unit test. There is no code path for it: the reminder is
fire-and-forget, and the loop behaves identically whether the model acts on it or
not. It is a *measurement*, listed in the table above as advice-ignored rate, and
it needs Phase 2's suite rather than an assertion.

Unit tests, per the parent document's acceptance criterion 5:
`policy.test.ts` (each reason, per-run cap, per-reason cap, debounce, subagent off,
counter reset), `evidence.test.ts` (bounded output, truncation, arg digest, empty log,
truncated log with unpaired spans), `supervisor.test.ts` (timeout, provider error, empty
response, unparseable response, over-cap response — all → skipped), and a loop-level test
that a triggered redirection reaches the next turn's prompt and that its usage lands in
the run totals.

## 10. Non-goals

- **No candidate lineage, no scores, no archive.** AVO's `P_t` is justified by an
  external evaluator `f`. Ordinary sessions have no `f`. Deferred to a variant-search
  mode with a real user request behind it (parent document §3).
- **No automatic commits.** AVO commits accepted versions; that is experiment
  bookkeeping under an objective gate, not something to copy into a coding session.
- **No population, islands, or crossover.** The paper itself defers these (§3.3).
- **No second agent with tools.** The supervisor is one text completion (D9).
- **No change to when a run stops.** The `stop` tier is untouched. Redirection makes the
  `warn` tier useful; it does not raise limits, and D7 makes sure it cannot hide spend.
- **No LLM judgement replacing verification.** The supervisor advises; `agent/verify.ts`
  and the permission layer remain system-controlled.

## 11. Open questions

1. **Does the same reason deserve a second shot after real progress?** D2 says one
   redirection per reason per run. A long session that genuinely recovers and later
   re-enters the same pattern gets nothing the second time. Alternative: reset the
   per-reason cap after N turns of measured progress. Left out of v1 because it adds
   state for a case we have not yet observed; revisit with §9 data.
2. **Should a `stop` produce a final direction in the completion message?** Not for the
   user's next turn, but as text the user can act on ("it kept re-reading the same file;
   consider narrowing the task"). Cheap, but it changes user-facing output on the worst
   path, so it wants its own decision rather than riding along here.
3. **Provider choice.** D4 uses the run's provider. A cheaper tier (the
   `extractSmallModel()` heuristic in `title-generator.ts:82`) would cut cost, but that
   helper is a string-munging guess that predates the model registry. If §9 shows
   supervisor cost mattering, fix the small-model resolution properly first.

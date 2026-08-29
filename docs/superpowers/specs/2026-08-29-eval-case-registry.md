# Eval Case Registry — ordering, justification, known gaps, and paired A/B

> **Date:** 2026-08-29
> **Status:** **COMPLETE — all five phases shipped (2026-08-29)** on `feat/denied-tool-trace` — §3
> (`expectFirstToolIn`, `expectBashMatches`), §6's model-echo check end to end
> from the provider adapters through the rollout log, and §4/§5's registry
> fields with all 39 cases backfilled and §7's assertions live, and Phase 4's
> seven new cases (39 → 46) closing four of the eight empty categories. The
> other four need harness work first — §9.1. Phase 5 (`freecode eval ab`)
> is built too, as in-process variants rather than git refs (§6). Four changes, all
> additive to `EvalCase` and its scorers; none of them alters an existing gate
> decision.
> **Extends:** `specs/2026-08-23-eval-harness.md` (Phases 0–5, built). This spec
> settles four of the items that `plans/2026-08-28-fx-eval-adoption.md` proposed
> and left open; where the two disagree, this one is later and wins.
> **Prior art:** `fx` (`vercel-labs/fx`), a Zig coding agent. Local clone read for
> this spec: `~/Projects/githubProjects/agents/fx` (the plan read it at
> `~/Projects/githubProjects/fx`, before the move). Relevant files:
> `tests/evals/agent-quality-matrix.ts`, `agent-quality-matrix.test.ts`,
> `agent-quality-ab.ts`.
> **Explicitly not:** fx's scripted provider (that is plan §3 / Phase E, still
> open and much larger), fx's judge, fx's mega-file case format, or fx's
> "evals are just `bun test` files" structure. See §8.

---

## 0. Read this first (plain language)

Our eval harness asks one question per case — *did the right tool fire* — and it
asks it in the weakest form available: **anywhere in the run**. A case that greps
immediately and a case that websearches, flails, reads three wrong files, and
*then* greps score identically. That is the exact distinction §4 of the eval spec
was written to capture ("trajectory over outcome"), and we currently score the
outcome of the trajectory rather than its shape.

Separately, an `EvalCase` carries no record of **why it exists**. There is no
field saying which failure mode it defends against, no field saying why a
deterministic unit test could not cover it, and no field recording that a case is
a *known gap* rather than a break. So a suite of 20 trajectory cases cannot tell
you what it covers, what it does not, or which of its reds are news.

fx solved both with schema rather than machinery: every case is a row that
declares its failure category, its justification for costing money, its expected
*first* action, and its current-versus-target result. A free, model-less test then
audits the registry itself. That is the part worth taking.

The fourth change is unrelated to schema. Our `compare.ts` diffs two *finished
reports*, so every A/B we run is confounded with whatever drifted between the two
run dates. fx runs both sides now, interleaved. That is a better instrument for
the one question we keep needing to answer — *did that prompt edit help?*

---

## 1. State of play (what changed since the plan)

The plan is nine days old at the time of writing and three of its premises have
moved. Recorded here because it is the plan's phasing table that is stale, not
its analysis:

| Plan says | Actually |
| --- | --- |
| "`scorers/efficiency.ts` … **was never written**; `gate.ts` has no efficiency rule" (§7) | **Built.** `scorers/efficiency.ts` exists, folded per trial at `runner.ts:309`, compared at `gate.ts:104` as a reported-never-blocking row. Phase B is done. |
| "Our 20 trajectory cases" / "backfill the 31 existing cases" (§4, §9) | Still accurate. 39 cases across five suites — `trajectory` 20, `coding` 6, `judged` 5, `redirect` 5, `redirect-build` 3. The two redirect suites were added since. |
| `evals/quarantine.txt` populated as part of calibration (§9 closing note) | **Done 2026-08-29** — three entries, from the first 3-trial bootstrap. See eval-harness spec §14.1, including why four of `--quarantine-report`'s seven proposals were rejected. |

Phases A, C, D, E and F of the plan remain unbuilt. This spec is A, C, F, plus one
item the plan described in fx and then did not propose adopting (§5 below).

---

## 2. The four changes

| # | Change | Shape | Cost |
| --- | --- | --- | --- |
| 1 | **First tool as a set** — `expectFirstToolIn`, `expectBashMatches` | pure fold over `trace.toolSpans` | ~half a day |
| 2 | **Justification fields** — `failureCategory`, `whyModelBacked` | two fields + closed set + free assertions | ~1 day + backfill |
| 3 | **Known-gap ledger** — `knownGap: { status, notes, target }` | one field + a non-equality assertion | ~half a day |
| 4 | **Paired A/B** — `freecode eval ab` | new runner, alternating order | ~2 days |

1–3 are schema and cost nothing at run time. 4 is a new command and does not touch
the gate.

---

## 3. Change 1 — the first tool is the signal

### The defect

`scorers/trajectory.ts:44`:

```ts
if (kase.expectTool !== undefined) {
  if (!fired.includes(kase.expectTool)) { ... }
}
```

Membership, not position. Two consequences:

1. **Order is unscored.** "Did it grep before reading" and "did it grep at all" are
   different questions. The harness exists to ask the first and asks the second.
2. **A needle is over-specific.** Our own history contains `read-named-file`
   failing as `'rollout/types.ts' not in args[file_path]` — the model did the right
   *kind* of thing and the case tested a spelling. Eval spec §4.1 warns about
   exactly this and supplies no tool to avoid it.

### The change

Two optional fields on `EvalCase`, both scored by folding `run.trace.toolSpans` —
no new instrumentation, so the eval spec's standing rule holds:

```ts
/**
 * The run's FIRST tool must be one of these. A set, not a needle: several
 * openings are usually legitimate and a single expected name tests the model's
 * phrasing rather than its behaviour.
 */
expectFirstToolIn?: string[];

/**
 * Regex over the bash command, for cases whose correct action is a shell verb
 * rather than a tool choice. Anchored by the author, not by us.
 */
expectBashMatches?: string;
```

### Semantics

- `expectFirstToolIn` reads `spans[0].tool`. **Empty `toolSpans` fails** with
  `expected one of [...], called nothing` — same as `expectTool` does today.
- Denied calls stay invisible here, as everywhere: `toolSpans` means *tools that
  ran* and a refusal is a `deniedSpan` (`specs/2026-08-10-agent-observability.md`
  §5.1). A case that wants to assert on a refusal still cannot, and this change
  does not pretend otherwise.
- `expectBashMatches` is satisfied by **any** `bash` span whose command matches —
  a model that runs `ls` then `git log` has still run `git log`. Pair it with
  `expectFirstToolIn: ["bash"]` when the ordering matters too.
- Both compose with `expectTool` rather than replacing it. `expectTool` keeps its
  membership semantics, including `expectTool: null` meaning *nothing fired*.
  Nothing in the existing 39 cases changes meaning.
- An invalid regex is a **dataset error, not a failed case** — `parseSuite`
  compiles it at load, alongside the existing `expectInArgs` check. A suite that
  cannot be loaded is better than a suite that reports a false red.
- **Added during implementation:** `expectFirstToolIn` together with
  `expectTool: null` is rejected at load. One requires a first tool and the other
  requires none, so the pair is unsatisfiable — scoring it would report a false
  red on every run forever.
- Both fields count toward `dataset.ts`'s "case asserts nothing" check, so a case
  may now be built from a first-tool expectation alone.

### What shipped, and what it actually does to the suite

The spec predicted a **lift**, on the theory that some current reds are
over-specific needles rather than bad behaviour. Reading `match.ts` during
implementation showed that theory is unsupported: matching is case-insensitive
**substring**, so `"rollout/types.ts"` already matches any absolute path
containing it. The one historical failure the plan cites
(`'rollout/types.ts' not in args[file_path]`) names a key, `file_path`, that no
current case uses — it predates a rename and is now guarded by the existing
"every `expectInArgs` key names a real parameter" test. No needle was relaxed,
because none was shown to need it.

So Phase 1 **tightens** rather than lifts. 12 of 20 trajectory cases gained a
first-tool expectation — every case whose prompt makes the opening unambiguous
(`grep`/`glob` for "where is X defined", `read` for "read this exact path",
`ls`/`glob` for "list this directory"). The eight left alone are the three
`expectTool: null` cases, the four mode-enforcement cases (whose subject is the
permission layer, not the opening move), and `todowrite-for-multistep`, where
`forbidTools` already makes the first tool the only tool.

**Expect the next gated run to need `--accept-baseline`.** A tightened suite
scores lower against a baseline earned under the looser rule, and that is a
re-scope, not a regression — exactly the case eval spec §9.2's escape hatch
exists for.

`expectBashMatches` ships with **no consumer**. `bash` is not in `READONLY_TOOLS`,
so the trajectory suite has no bash case until the sandbox rule allows one; the
field is there for the sandboxed suites.

---

## 4. Change 2 — a case must say why it costs money

### The defect

`EvalCase` (`eval/types.ts:16`) has `id`, `prompt`, expectations, fixtures, rubric.
Nothing answers *why does this need a real model*. The eval spec's own rule —
anything that does not run a real agent turn is a `*.test.ts` and belongs next to
its code — is prose in `CLAUDE.md` with no mechanism enforcing it. `dataset.ts:93`
rejects a case that asserts nothing; it accepts a case that a unit test should
have covered.

### The change

```ts
/**
 * Closed set. A case that fits no category is a case nobody has thought about;
 * add the category deliberately or reconsider the case.
 */
failureCategory:
  | "tool-routing"          // wrong tool, or right tool too late
  | "code-edit"             // produced the wrong code, or none
  | "answer-quality"        // the reply itself is the deliverable
  | "stuck-loop"            // repetition / no progress on a tedious task
  | "permission"            // behaviour under a mode or rule that says no
  | "recovery"              // agent/recovery/ — recovering from a failed call
  | "stale-context"         // acting on a tree/file state that has moved
  | "compaction-boundary"   // survives a compaction mid-task
  | "memory-recall"         // retrieves the right memory, or correctly none
  | "large-output"          // does not drown in a 10k-line result
  | "resume"                // correct after a resume/fork
  | "frustration"           // "this is taking forever, what are you doing"
  | "mcp-failure";          // an MCP server that is down, slow, or lying

/** Why a deterministic test cannot cover this. Asserted non-empty. */
whyModelBacked: string;
```

Both **required**, not optional. An optional justification field is one nobody
fills in.

**Three categories were added during implementation.** fx's taxonomy is
failure-modes-only, because fx's matrix registers known misbehaviours and its
scenario evals sit outside it. Ours has one field for all five suites, and three
of them do not describe misbehaviour at all: `coding` asks whether the agent can
edit code, `judged` asks whether the prose was good, and the two `redirect`
suites ask whether it stalls. Forcing those into a misbehaviour taxonomy would
have meant either a junk-drawer category or an honest field that half the suite
lies in, so the set covers both readings of *what breaks if this goes red*.

### The coverage payoff

This is the larger half of the value, and the tagging confirmed it. Across all
39 cases:

| Category | Cases |
| --- | --- |
| `tool-routing` | 17 |
| `stuck-loop` | 8 |
| `code-edit` | 6 |
| `answer-quality` | 5 |
| `permission` | 3 |
| **the other eight** | **0** |

Phase 4 then closed four of the eight, taking the suite to 46 cases: `recovery`
2, `large-output` 2, `frustration` 2, `stale-context` 1. The remaining four are
not unwritten but unreachable — §9.1.

We have real code and zero eval coverage for `recovery` (`agent/recovery/`),
`stale-context`, `compaction-boundary`, `memory-recall`, `large-output`,
`resume`, `frustration` and `mcp-failure`. `frustration` is the sharpest of them:
*"This is taking too long. What are you doing?"* is a real user turn with a real
correct behaviour, and nothing in `evals/` asks for it.

Per-category pass rate then becomes the number that directs work. It is nearly
free once the field exists — but it is a new column in `eval_runs.jsonl`, which is
baseline substrate, so §10 keeps it as an open question rather than assuming it.

### Format

Take the fields, **not** fx's container. fx's registry is one 1,154-line
TypeScript file. Ours stays JSONL — diffable, appendable, one case per line, which
is what makes `freecode eval add --write` safe.

---

## 5. Change 3 — known gaps belong in the case, not in a sidecar

### The defect

Today a case that fails for a reason we already understand has exactly one home:
`evals/quarantine.txt`, which encodes *"do not turn the build red"* and nothing
else. No why, no definition of passing, no way to tell a genuinely flaky case from
a known-broken behaviour we have chosen not to fix yet. The file is also empty,
so in practice we have no vocabulary for a known gap at all.

fx's rows carry `currentBaselineResult: { status, notes }` alongside
`targetResult` — the observation and the aspiration, in separate fields. The plan
described this (§4) and then proposed only `failureCategory` and `whyModelBacked`.
This spec adopts it.

### The change

```ts
/**
 * A documented gap: this case does not pass, and we know why. Distinct from
 * quarantine, which is about FLAKINESS — a quarantined case might pass; a
 * knownGap case reliably does not, and we have decided that is acceptable
 * for now.
 */
knownGap?: {
  status: "partial" | "known-gap" | "unmeasured";
  /** What actually happens today. Observation. */
  notes: string;
  /** What passing would look like. Aspiration. */
  target: string;
};
```

### Semantics

- **`knownGap` does not affect scoring.** The case runs, scores, and reports
  exactly as before. It is documentation attached to the artifact it documents.
- **It does not suppress the gate either.** That is quarantine's job and the two
  stay separate: quarantine is a pass-rate-driven mechanism with `--quarantine-report`
  proposing promotion and demotion, and folding "known gap" into it would corrupt
  those pass rates with cases that were never expected to pass.
- A case may be both. `knownGap` explains, `quarantine.txt` unblocks.
- **`notes` must not equal `target`.** fx asserts this
  (`agent-quality-matrix.test.ts:112`, *"separates current baseline observations
  from target behavior"*) and it is the assertion that makes the field honest —
  otherwise the aspiration gets written into the status field and the gap
  disappears without being fixed.
- `status: "unmeasured"` is illegal on a case that has ever produced a trial
  result in `eval_runs.jsonl`. If we ran it, it is measured.

---

## 6. Change 4 — paired A/B, run now, not diffed from history

### The defect

`compare.ts` (`compareReports`, `:93`) diffs two `SuiteReport`s. Both are already
finished; typically one is days old. Everything that drifted in between — a
silently updated model behind a stable id, a provider-side routing change, a
different cache state — is confounded into the delta and reported as ours.

Eval spec §9.2 makes the resolved model part of baseline identity, which catches
an *id* change. It cannot catch the same id serving different weights.

### The change

A new subcommand, deliberately **outside the gate**:

```
freecode eval ab <suite> --baseline <variant> --candidate <variant> \
                 [--trials N] [--cases a,b,c] [--json] [--out FILE]
```

**A side is an in-process VARIANT, not a git ref** — §10's open question, settled
in Phase 5. A variant is `model=<p/m>` and/or `env:NAME=value`, comma-separated;
an empty string is the identity, so one axis can be A/B'd while the other stays
at whatever the config resolves. `env:NAME=` *unsets* rather than empties.

Git refs were the other candidate and are the more general instrument — they are
what you would want for a system-prompt change. They were rejected for now
because they fight the runner: `runner.ts` is deliberately in-process so a case
can be stepped through in a debugger, and a ref-based A/B needs worktree, build
and spawn plumbing around it. Variants cost a day and answer the two questions
we actually have — *is this model better here*, and *does redirect help* — the
second of which is the measurement parked since 2026-08-27.

This works **only because every setting worth flipping is read per turn**:
`loadRedirectSettings` re-reads `process.env` on each loop iteration. A setting
cached at boot would not vary between interleaved trials, and would do so
silently. That is the constraint to check before adding an axis.

Four properties, all taken from `agent-quality-ab.ts`:

| Property | Why |
| --- | --- |
| **Alternate which side runs first each trial** (`trialIndex % 2`) | Cancels ordering and warm-cache bias. A fixed order silently advantages one side, and with prompt caching in play the advantage is not small. |
| **Record each side's identity in every artifact** — commit sha, resolved provider/model, and the model the response *echoed back* | "Which build produced this number" must be answerable a week later. The echo check is the one that matters: `eval_runs.jsonl` holds runs with `model: undefined`, and a gateway serving something other than what was asked is invisible without it. |
| **Redact credential-shaped env values** before writing artifacts | We write reports under `~/.freecode/` and export to OTLP. The OTLP path is already committed to being leak-free; this is the same rule one layer out. |
| **Classify each case as `improved` / `regressed` / `unchanged-pass` / `unchanged-fail` / `inconclusive`** | The fifth bucket is the honest verdict for a low-trial paired run. Refusing to emit it is how an A/B harness launders noise into a decision. |

### What it is not

Not a gate, not CI-wired, not a baseline writer. It writes nothing to
`eval_runs.jsonl`. It is an instrument you point at a prompt change; the gate
remains majority-of-N against a sticky baseline, unchanged.

`fx` labels its own version *"intentionally not a no-key CI gate: results are
noisy model-backed signals, reported as paired pass-rate deltas with raw artifacts
for inspection."* That framing is correct and we adopt it verbatim in intent.

### Smallest useful slice — built, and not where this section put it

Two of the three items in the table were **already dead** when Phase 2 started,
and finding that out is most of what Phase 2 was:

- **`model: undefined` in `eval_runs.jsonl`** — fixed by `fc4be56` before this
  spec was written. `suite.ts` records the *resolved* model, and all 18 runs in
  history carry one. The plan's observation was stale; so was this section's
  repetition of it.
- **Env redaction** — nothing in the eval report or OTLP path writes an env var
  at all. Redacting it would be code for a scenario that cannot occur.

The **echo check** was real, and could not be done "in the report path" as
claimed: `model.response` recorded `resolvedModel`, the same local variable
`model.request` used, so **both sides of the round trip were the id we sent** and
there was no echo anywhere in the pipeline to check. It needed the value plumbed
from the providers, which is a different subsystem and a bigger change than
"hours, not days" allowed for.

Built as (all four adapters use the AI SDK, so the stream path is one change,
not four):

| Layer | Change |
| --- | --- |
| `providers/types.ts` | `ExecuteResult.echoedModel`; the `done` chunk carries it too, rather than a new chunk type every consumer must learn to ignore |
| `providers/streaming.ts` | reads `finish-step`'s `response.modelId` — the only `fullStream` part that carries it; `finish` does not |
| the four adapters | `result.response?.modelId` on the `execute()` path |
| `rollout/types.ts`, `trace.ts` | `echoedModel` on `ModelResponseEvent` and `ModelSpan` |
| `agent/loop.ts` | both `recordModelResponse` sites |
| `eval/model-echo.ts` | `echoedModels()` fold + `echoDisagreements()`; surfaced on `TrialResult`, `SuiteReport`, and one CLI line |

**Reported, never gated on** — the same call `SuiteReport.judge` makes, and for a
sharper reason than fx had. fx fails the trial on a mismatch because it routes
through a gateway. We call providers directly, where the common case is an alias
resolving to a dated snapshot (`claude-sonnet-4-6` → `claude-sonnet-4-6-2026…`),
which is correct behaviour. `echoDisagreements` therefore treats an echo that
*extends* the request, or drops our `provider/` routing prefix, as agreement, and
flags only an echo that is not the requested model at all. A provider that echoes
nothing stays `undefined` rather than defaulting to the requested id — silence is
not evidence of agreement.

The payoff is bigger for us than the gateway argument suggests: a snapshot
rolling under a stable alias reprices every baseline pinned to that alias while
every recorded id stays byte-identical. That is the model drift making
`--compare` untrustworthy in the first place, and it was previously undetectable
after the fact.

---

## 7. The free tests

Everything in §4 and §5 is auditable without a model. These go in
`dataset.test.ts`, cost nothing, and run on every commit:

1. ~~Every `failureCategory` has at least one case.~~ **Built as a golden list
   instead** (`CATEGORIES_WITHOUT_CASES` in `dataset.test.ts`), asserted equal to
   the actual empty set. As written this assertion would have failed the moment
   it was added, and the pressure it creates is to delete the eight empty
   categories — which destroys the exact signal the closed set exists to give. A
   golden list makes coverage *changes* fail review instead: adding the first
   case in a category breaks the test, and so does removing the last one.
2. Every case has a non-empty `whyModelBacked`.
3. `knownGap.notes !== knownGap.target` (§5).
4. No case is `knownGap.status === "unmeasured"` while appearing in
   `eval_runs.jsonl`.
5. `expectBashMatches` compiles as a regex.
6. Case ids are unique **across suites**, not just within one. `dataset.ts:54`
   checks within a file; harvesting into the wrong suite can currently produce a
   collision no loader sees.

fx does the same thing — `agent-quality-matrix.test.ts` tests the *registry*, not
the agent, and is the cheapest test in its repo.

---

## 8. What this spec does not adopt

- **fx's scripted provider.** Genuinely the most valuable thing in fx's eval layer
  and much larger than these four; it stays as plan §3 / Phase E with its open
  decision intact. Nothing here depends on it.
- **fx's judge.** `eval-judge.ts` defaults the judge to the model under test
  (`opts.judgeModel ?? EVAL_MODEL`), runs it *through the agent binary*, dumps up
  to 150,000 chars of the work dir into the prompt, and grades 1–10 with pass ≥ 7.
  `judge-config.ts` throws on the first of those and eval spec §7 argues the last.
  The one idea worth lifting later is its **per-requirement decomposition**
  (`{requirement, implemented, evidence}[]` before a score), which localises
  failure — but that is a rubric-format change and belongs in its own pass.
- **Evals as bare test files.** `bun test tests/evals/` yields no pass rate, no
  baseline delta, no majority-of-N, no quarantine. A flaky live eval becomes a red
  build, which is how a suite gets disabled.
- **fx's hard latency budgets.** `check_budgets.py` enforces 2 ms per command on a
  7.8 MiB static binary. The PASS/FAIL/**INFO-when-no-budget** shape is the right
  instinct — the same instinct as pricing an unknown model as `undefined` rather
  than 0 — and `scorers/efficiency.ts` now exists to carry it. The millisecond
  numbers do not transfer.

---

## 9. Phasing

| Phase | Deliverable | Blocks |
| --- | --- | --- |
| ~~**1**~~ | §3 — `expectFirstToolIn` + `expectBashMatches` in `scorers/trajectory.ts` and `dataset.ts`. **Done 2026-08-29.** No case was re-expressed; see §3 for why the "relax the needles" half of this phase turned out to rest on a false premise | — |
| ~~**2**~~ | §6 smallest slice. **Done 2026-08-29**, but only one of its three items existed: the model-echo check, plumbed from the providers through the rollout log rather than bolted onto the report. The other two were already fixed or guarded nothing — see §6 | — |
| ~~**3**~~ | §4 + §5 — `failureCategory`, `whyModelBacked`, `knownGap`; the §7 assertions; all 39 cases backfilled. **Done 2026-08-29.** Three categories were added to the closed set and §7's first assertion became a golden list; both are explained in place | — |
| ~~**4**~~ | Cases for the eight empty categories. **Half done 2026-08-29**: recovery (2), large-output (2), frustration (2), stale-context (1) — 7 new cases, 39 → 46. The other four are not unwritten but UNREACHABLE; see §9.1 | — |
| ~~**5**~~ | §6 in full — `freecode eval ab` with interleaving. **Done 2026-08-29.** In-process variants rather than git refs; see §6 for why | — |

### 9.1 The four categories the harness cannot express

`runner.ts` drives exactly one `loop.runEffect({ prompt })` per trial and seeds
nothing but a tmpdir of `files`. Four of the eight empty categories need
something that does not exist, and writing a case for them today would produce a
case that fails for infrastructure reasons and reads as an agent failure — the
most expensive kind of wrong answer this harness can give.

| Category | What it needs first |
| --- | --- |
| `compaction-boundary` | A turn long enough to compact. Reachable only by accident today, and an accident is not a p ≥ 0.99 case. |
| `memory-recall` | A seeded memory dir. `files` paths are sandbox-relative and `assertSafeRelativePath` refuses to escape, which is correct — so a fixture cannot reach `~/.freecode`. |
| `resume` | A prior session to resume from. One `runEffect` per trial means there is no earlier turn. |
| `mcp-failure` | A fixture MCP server. `initRunner` calls `initMcpServers()` against the user's real config, so the suite is not hermetic here and could not be made to fail on purpose. |

They stay in `CATEGORIES_WITHOUT_CASES` with that reason recorded next to them.
The cheapest unlock is `resume` (a second `runEffect` on the same session id);
`memory-recall` wants a `memory` fixture key alongside `files`; the other two are
larger. None of it is Phase 4 work — it is harness work, and it should be
specified before it is built.

**Every phase in this spec is now built.** What is left is not in this spec: the harness capability §9.1 names, and plan §3's scripted provider. Phases 1–3 improved how the suite reports and Phase 4 added the coverage that could be added without new harness capability.

Phase 1 changes what the trajectory suite measures, so run it **before** any
baseline recalibration, and expect the first post-change run to need
`--accept-baseline`.

None of this substitutes for the calibration eval spec §14 still owes: thresholds
set from a real run, the 3× bootstrap, and a populated `evals/quarantine.txt`. A
better scorer measured against no baseline is still not a gate.

---

## 10. Open questions

- **Does `failureCategory` become a reporting dimension?** Per-category pass rate
  is the number that would direct work, and it is nearly free once the field
  exists. But it means a new column in `eval_runs.jsonl`, which is baseline
  substrate — and `baselineFor` has to keep working across the schema change.
  Undecided.
- ~~**Are `failureCategory` and `whyModelBacked` required on the redirect suites
  too?**~~ **Settled in Phase 3: required everywhere**, redirect suites included.
  An exemption is how a required field becomes optional, and the backfill was
  eight cases rather than the wasted effort this question assumed.
- ~~**What is a `<ref>` for `eval ab`?**~~ **Settled in Phase 5: an in-process
  variant** (`model=` and/or `env:`), not a git ref and not a built binary. See
  §6. Git refs remain the right answer for A/B'ing a code change and are a
  documented follow-on, not a closed door.
- **Does `knownGap` need an expiry?** A gap with no revisit date is a gap that
  becomes permanent. A `revisit` field is the obvious answer and also the field
  everyone lies in.

---

## 11. References

- `plans/2026-08-28-fx-eval-adoption.md` — the fuller comparison, including
  the scripted provider (§3) this spec defers.
- `specs/2026-08-23-eval-harness.md` — §4 (trajectory over outcome), §7 (judge
  independence), §9 (gate semantics), §14 (calibration still owed).
- `specs/2026-08-10-agent-observability.md` §5.1 — why a denied call is not a
  `toolSpan`, and therefore why §3 cannot score refusals.
- `fx` — `~/Projects/githubProjects/agents/fx`, re-read 2026-08-29 at `cef08aa`.
  `tests/evals/agent-quality-matrix.ts` (row schema, closed category set),
  `agent-quality-matrix.test.ts` (the free registry assertions),
  `agent-quality-ab.ts` (paired A/B).

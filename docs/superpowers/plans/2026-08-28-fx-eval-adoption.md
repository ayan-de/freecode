# Adopting from fx — what its eval layer has that ours doesn't

> **Date:** 2026-08-28
> **Status:** Proposed. **Superseded in part (2026-08-29)** by
> `specs/2026-08-29-eval-case-registry.md`, which settles §4, §5 and §6 as a spec
> and adds fx's known-gap ledger. §3 (the scripted provider) is untouched and is
> still the item worth planning around. §7's premise is stale: `scorers/efficiency.ts`
> has since been built and wired (`runner.ts:309`, `gate.ts:104`).
> **Extends:** `specs/2026-08-23-eval-harness.md` (Phases 0–5, built). This doc proposes
> Phase 6+; it changes no existing decision in that spec except where §9 says so.
> **Prior art:** `fx` (`vercel-labs/fx`), a Zig coding agent. Local clone read for this
> plan: `~/Projects/githubProjects/fx`. Eval layer is `tests/evals/` (~5,400 lines of
> TypeScript over 29 files) plus `benchmarks/check_budgets.py`.
> **Related:** `specs/2026-08-26-trajectory-redirection.md` §9.1 (the measurement this
> plan unblocks), `specs/2026-08-10-agent-observability.md`.

---

## 0. Read this first (plain language)

fx drives its own binary headlessly (`fx ask --auto --json --no-save`) in a tmpdir with a
throwaway `$HOME`, and asserts against the JSON the binary prints — `tool_calls`, `steps`,
`exit_code`. That is the same shape as our harness. The interesting differences are not in
the runner.

**Where we are ahead:** fx has no gate, no baseline, no history file, no quarantine, and
its evals are not wired into CI at any level (`grep -rl evals .github/workflows` returns
nothing). `AGENTS.md:280` states the reason plainly — *"Live model evals remain separate
because they require credentials and are not deterministic."* Everything our spec §9 argues
about majority-of-N, delta-vs-baseline and flaky policy is simply absent there. Do not
converge on that.

**Where fx is ahead:** it can eval things we currently cannot eval *at all*, because it
found a way to run the agent loop without paying a provider for the parts that aren't
under test. That is one technique (§3), and it is worth more than the other four items in
this document combined.

## 1. Scoreboard

| | FreeCode wins | Even | fx wins |
| --- | --- | --- | --- |
| Gate semantics (majority-of-N, delta vs baseline) | ✓ | | |
| Baseline history + `--accept-baseline` | ✓ | | |
| Quarantine, with pass-rate-driven promotion | ✓ | | |
| CI wiring | ✓ | | |
| Judge independence (`judge-config.ts` refuses self-grading) | ✓ | | |
| Case harvesting from production sessions | ✓ | | |
| OTLP export of scores, linked to traces | ✓ | | |
| Dependency-free fixture rule | ✓ | | |
| Case format (JSONL vs 1,154-line TS file) | ✓ | | |
| Sandbox model (tmpdir, permission answers scoped to it) | | ✓ | |
| Cross-model matrix runs | | ✓ (ours deferred, §13) | |
| **Scripted-provider runs (eval without paying)** | | | ✓ |
| **Case registry: why does this case need a model?** | | | ✓ |
| **First-tool-as-a-category + command pattern** | | | ✓ |
| **A/B hygiene (order alternation, identity, model echo)** | | | ✓ |
| **Cost/latency budgets as a checked artifact** | | | ✓ |

## 2. What fx built, briefly

| File | Lines | What it is |
| --- | --- | --- |
| `tests/evals/eval-helpers.ts` | 531 | The runner. `runEval()` (`:164`) spawns the binary in a tmpdir with a fresh `$HOME` holding an all-allow `settings.json` (`:124`), parses stdout as JSON, and offers assertion helpers — `assertToolUsed`, `assertFirstToolIn` (`:354`), `assertTerminalExecMatches` (`:390`), `assertStepCount`. |
| 18 scenario files | ~40–140 each | One prompt, filesystem + tool-call assertions. `create-file`, `grep-files`, `edit-file`, `fix-known-bug`, `github-routing`, `date-awareness`. |
| `agent-quality-matrix.ts` | 1,154 | A typed registry of known agent failure modes (§4). |
| `agent-quality-matrix.test.ts` | 396 | Tests **the registry**, not the agent. Free, no model. |
| `agent-quality-ab.ts` | 416 | Paired A/B of two binaries on the same rows (§6). |
| `auto-permission-reliability.test.ts` | 1,326 | The scripted-provider technique (§3). |
| `eval-judge.ts` | 215 | A file-adherence judge. Mostly a counter-example (§8). |
| `benchmarks/check_budgets.py` | ~90 | Per-command wall-clock budgets, PASS/FAIL/INFO (§7). |

---

## 3. Adopt #1 — the scripted provider

**This is the item that matters.** Everything else here is a refinement of a harness we
already have; this one changes what the harness is *capable of measuring*.

### What fx does

`startClassifierProxy` (`auto-permission-reliability.test.ts:206`) stands up a local HTTP
server and points the binary at it as its gateway. It then splits traffic:

- Requests whose body contains `"permission_decision"` are **proxied to the real gateway**
  — that is the permission classifier, the thing under test — and every response is
  recorded with status, elapsed ms, tokens and USD (`reviewerUsage`, `:303`).
- Every other request gets a **canned tool-call batch** off a scripted list.

So the agent's trajectory is deterministic and free, and exactly one component is live.
The suite can then assert things no live-everything harness can assert without noise: that
the reviewer is called at most twenty times across the corpus (`:1098`), that its latency
percentiles hold (`percentile`, `:335`), that a given tool batch produces a specific
decision.

### Why it exists, and why our version is simpler

fx needs an HTTP proxy because its runner spawns a binary — the process boundary leaves no
other seam. **Ours doesn't.** Spec §6 already commits the eval runner to calling core's
internals *in-process*, and `providers/registry.ts:11` exposes `registerProvider(id, def)`
against a `ProviderId` that is a bare `string` (`providers/config.ts:48`). A scripted
provider is therefore a normal registration, not a network fixture:

```ts
// eval/scripted-provider.ts — sketch
registerProvider("scripted", {
  info: { id: "scripted", name: "Scripted", models: [...] },
  create: () => ({
    info,
    async *stream(opts) {
      // Next scripted turn, or delegate to the real provider when this call is
      // the one under test.
      yield* script.next(opts);
    },
  } satisfies AIProvider),
});
```

`AIProvider` is two methods (`providers/types.ts:123`), so the surface is small.

### What it unblocks

| Subsystem | Today | With a scripted provider |
| --- | --- | --- |
| `agent/redirect/` | Phase 2 measured it and **refused to flip the default** — spec §9.1 says the criterion is unmeasurable until the sandbox lands | Script a trajectory that provably reaches a loop-health `warn`, keep only the redirect's one small call live, and measure advice quality against a fixed stuck state |
| `memory/extract.ts`, `memory/judge.ts` | No eval coverage; a real turn is the only way to reach them | One live call each, deterministic surroundings |
| `compaction/summarizer.ts` | Same | Same |
| `agent/recovery/` | Cannot provoke a provider 429 or a length-limit truncation on demand | Script the failure directly — fx does exactly this |
| Permission layer | §11.1 notes the runner had to *answer* prompts so the suite wouldn't accidentally measure the permission layer | Measure it deliberately, in isolation |

### The rule this bumps into, and the decision it needs

Spec §3 is categorical: *"a file under `evals/` runs a real agent turn. If it doesn't, it
is a `*.test.ts`."* That rule is load-bearing — it is the thing keeping our suite from
diluting the way waku's did — and a fully-scripted run does not clear it.

Proposed resolution, which preserves the rule rather than weakening it:

- **Fully scripted, zero live calls** → it is a `*.test.ts` next to its subsystem. No
  exception, no `evals/` entry. This is just an integration test with a fake provider, and
  calling it an eval would inflate the count for free.
- **Hybrid — scripted loop, one live call for the component under test** → it *is* an eval
  case. It runs a real model turn; the fact that only one of its calls is real changes the
  cost, not the category. It gets a suite (`evals/component.jsonl`), a baseline, and the
  same gate.

That keeps the count honest and still buys the capability. It needs sign-off before code,
because it is the first amendment to §3.

### Risks

- **Stub drift.** A scripted provider that no longer resembles the real SSE shape passes
  forever while production breaks. Mitigation: build the script on the same chunk type the
  real path emits, downstream of nothing — and keep at least one fully-live case per suite
  so drift shows up as a divergence, not a silence.
- **Scripting a trajectory is writing the answer.** A scripted loop can only measure the
  component, never whether the model would have got there. That is the trade, and it is why
  this supplements the live suites rather than replacing them.

---

## 4. Adopt #2 — a case registry that says *why* a case costs money

### What fx does

`AgentQualityMatrixRow` (`agent-quality-matrix.ts:57`) is not a case — it is a case plus
its justification:

```ts
failureCategory: "GitHub routing",          // closed set, :3
expectedFirstTool: { category, tools, commandPattern },
forbiddenTools: [...],
deterministicCoverage: { type, status: "implemented" | "planned" | "model-backed-only", notes },
modelBackedEval:      { required: true, reason: "The first action is selected by the model from prompt/context, not by deterministic runtime code." },
currentBaselineResult: { status: "passing" | "partial" | "known-gap" | "unmeasured", notes },
targetResult: "...",
```

`agent-quality-matrix.test.ts` then tests the registry itself, for free:

- every declared failure category has at least one row (`:83`);
- no row marked `modelBackedEval.required` is left `unmeasured` (`:99`);
- `currentBaselineResult.notes !== targetResult` (`:112`) — you cannot paper over a known
  gap by writing the aspiration into the status field;
- a row whose first tool is model-choice must carry runtime/e2e coverage; otherwise it must
  carry recorder coverage.

### What we'd add

`EvalCase` (`eval/types.ts:16`) has no field that answers "why does this need a real
model?", so nothing stops a case that a unit test should have covered — the exact dilution
our §3 criticises in the prior art, with no mechanism preventing it on our side either.

Two fields, and a closed category set:

```ts
/** Closed set. A case that fits no category is a case nobody has thought about. */
failureCategory: "tool-routing" | "recovery" | "stale-context" | "permission" |
                 "compaction-boundary" | "memory-recall" | "large-output" |
                 "resume" | "frustration" | "mcp-failure";
/** Why a deterministic test cannot cover this. Free-text, asserted non-empty. */
whyModelBacked: string;
```

Then assertions in `dataset.test.ts`, which cost nothing: every category has a case; every
case explains itself; no two cases share an id across suites.

The second payoff is coverage-shaped. Our 20 trajectory cases are almost entirely
tool-routing. fx's taxonomy names categories we have **zero** cases for and subsystems for:
recovery (`agent/recovery/`), stale context, resume, large output, and *frustration* —
"This is taking too long. What are you doing?" is a real prompt with a real correct
behaviour, and nothing in `evals/` asks for it.

**Do not adopt the format.** fx's matrix is one 1,154-line TypeScript file, against our
~150-line file guidance and our JSONL-is-diffable-and-appendable choice (§4). Take the
fields into `EvalCase` and the assertions into `dataset.test.ts`; leave the mega-file.

---

## 5. Adopt #3 — first tool as a category, and a command pattern

`scorers/trajectory.ts:43` supports one `expectTool`, satisfied if it fired *anywhere* in
the run. fx asserts on the **first** action and accepts a **set**:

```ts
expectedFirstTool: {
  category: "local git command",
  tools: ["terminal"],
  commandPattern: "^git\\s+(log|status|branch)\\b",
}
```

Two things fall out of that shape:

1. **Order is the signal.** "Did it grep before reading" and "did it grep at all" are
   different questions, and §4's own motivation — trajectory over outcome — is the first
   one. We currently score the second.
2. **A set beats a needle.** Our recorded history contains
   `read-named-file` failing as `'rollout/types.ts' not in args[file_path]` — an
   over-specific expectation, precisely the failure §4.1 warns about and then gives no tool
   to avoid. `expectFirstToolIn: ["grep", "glob", "read", "ls"]` tests the behaviour; a
   spelling of one path tests the model's phrasing.

Proposed additions to `EvalCase`, both pure folds over `trace.toolSpans` — no
instrumentation, so the spec's standing rule holds:

```ts
expectFirstToolIn?: string[];
/** Regex over the bash command, for cases whose correct action is a shell verb. */
expectBashMatches?: string;
```

This is the cheapest item here and it likely lifts our own suite off 14–15/20 without
touching the agent, because some of those failures are bad cases rather than bad
behaviour — which §9.1 predicted and §9.3 exists to detect.

---

## 6. Adopt #4 — A/B hygiene

`agent-quality-ab.ts` runs two binaries over the same rows and gets four things right that
our `compare.ts` cannot, because ours compares two *finished reports* and never runs
anything:

| fx | Where | Why it matters |
| --- | --- | --- |
| Alternates which side runs first each trial (`trialIndex % 2`) | `:79` | Cancels ordering and warm-cache bias. A fixed order silently advantages one side. |
| Records each binary's sha256 and `--version` in every artifact | `:105`, `:256` | "Which build produced this number" is otherwise unanswerable a week later. |
| **Fails the trial if the response's model doesn't echo the requested one** | `:316` | Our `eval_runs.jsonl` holds six runs with `model: undefined`. §9.2 makes the resolved model part of baseline identity; verifying the *echo* catches a gateway silently serving something else. |
| Redacts credential-shaped env values before writing artifacts | `:83` | We write reports to `~/.freecode/` and export to OTLP; the same hygiene applies. |
| Classifies a paired delta as improved / regressed / unchanged-pass / unchanged-fail / **inconclusive** | `:201` | An explicit "inconclusive" is the honest verdict for a low-trial paired run, and refusing to emit it is how A/B harnesses launder noise into a decision. |

Smallest useful slice: the model-echo check and env redaction, both independent of whether
we ever build an interleaving runner.

---

## 7. Adopt #5 — the efficiency scorer, in fx's budget shape

`scorers/efficiency.ts` is listed in spec §5's architecture and §9.2's gate table
("regression vs baseline > 15% → warn only") and **was never written**; `gate.ts` has no
efficiency rule at all. fx's `benchmarks/check_budgets.py` is a good shape to copy:

- absolute per-command budgets, not just deltas;
- three outcomes — `PASS`, `FAIL`, and **`INFO` when no budget applies**, rather than
  treating unknown as zero. That is the same instinct as our pricing table refusing to
  guess (an unknown model prices as `undefined`, never 0), and it should be the same
  instinct here.

The data already exists: `TrialResult` carries `turns`, `inputTokens`, `outputTokens`,
`costUsd`, and `repeatedCalls` (`eval/types.ts:84-98`). This is a fold and a gate row, not
new instrumentation.

---

## 8. What we are deliberately not adopting

- **Evals as test files.** `bun test tests/evals/` yields no aggregate — no pass rate, no
  baseline delta, no majority-of-N, no quarantine. A flaky live eval becomes a red build,
  which is how a suite gets disabled. Our §9 machinery is the part fx is missing.
- **Their judge.** `eval-judge.ts:164` calls `runEval(prompt, { model: opts.judgeModel ?? EVAL_MODEL })`
  — the judge **defaults to the model under test**, and runs *through the agent binary
  itself*. `judge-config.ts` throws on exactly that. It also dumps up to 150,000 chars of
  the work dir into the prompt (`:56`) and grades 1–10 with pass ≥ 7 (`:152`), against our
  §7 argument for 0–5.
- **`npm install` inside a fixture** (`fix-known-bug.test.ts:126`). Networked, slow and
  flaky setup at the exact point the harness should be boring — §4's dependency-free rule
  is the better call and stays.
- **Evals outside CI.** Ours are `workflow_dispatch`-only for cost reasons, which is not
  the same as absent.
- **Skipping without a key by omission.** Only one fx eval file guards on `HAS_API_KEY`
  (`:1109`); the rest simply fail. Our "unconfigured judge is a silent skip, colliding
  judge is a loud throw" split is the better handling and stays.

---

## 9. Phasing

| Phase | Deliverable | Cost | Blocks |
| --- | --- | --- | --- |
| **A** | `expectFirstToolIn` + `expectBashMatches` in `scorers/trajectory.ts`; re-express the over-specific cases in `evals/trajectory.jsonl` | ~half a day, pure fold | nothing |
| **B** | `scorers/efficiency.ts` + the §9.2 warn row in `gate.ts`, with PASS/FAIL/INFO semantics | ~half a day | nothing |
| **C** | `failureCategory` + `whyModelBacked` on `EvalCase`, closed set, free assertions in `dataset.test.ts`; backfill the 31 existing cases | ~1 day, mostly writing | nothing |
| **D** | Cases for the categories C exposes as empty — recovery, stale context, resume, large output, frustration | ongoing | C |
| **E** | **Scripted provider** (`eval/scripted-provider.ts`) + the §3 amendment + the first hybrid suite, pointed at `agent/redirect/` | ~2–3 days | needs the §3 decision first |
| **F** | A/B hygiene: model-echo check, env redaction, `inconclusive` verdict in `compare.ts` | ~half a day | nothing |

A–C and F are independent and cheap. **E is the one worth planning around** — it is the
only item that changes what the harness can see, and it is the unblock for the trajectory
redirection decision that is currently parked.

Note that none of this replaces the calibration our own spec §14 still owes: thresholds set
from a real run, the 3× bootstrap, and an actually-populated `evals/quarantine.txt`. A
better scorer measured against no baseline is still not a gate.

## 10. Open questions

- **The §3 amendment (§3 above) needs a decision before E starts.** Proposed:
  fully-scripted → `*.test.ts`; hybrid with one live call → a real eval case. Anything
  looser and the eval count stops meaning what §3 built it to mean.
- **Do hybrid cases block a release, and against which baseline?** They are cheap enough to
  run every commit, which makes them tempting to put in `ci.yml` — but they still make a
  paid call, and §9.2's baseline is keyed on the resolved model. Probably their own suite
  with its own history; not decided.
- **How is stub drift detected?** One live smoke case per scripted suite is the cheapest
  answer, but it reintroduces a paid call into the thing whose selling point was being
  free.
- **Does `failureCategory` become a reporting dimension?** Pass rate per category is the
  number that would actually direct work, and it is nearly free once the field exists —
  but it is also a new column in `eval_runs.jsonl`, and that file is a baseline substrate.

## 11. References

**fx** — `~/Projects/githubProjects/fx`, read 2026-08-28.

- `tests/evals/eval-helpers.ts` — `runEval` `:164`, eval `$HOME` `:124`, `assertFirstToolIn` `:354`, `assertTerminalExecMatches` `:390`, `HAS_API_KEY` `:529`
- `tests/evals/auto-permission-reliability.test.ts` — `startClassifierProxy` `:206`, live-vs-scripted split `:232`, `reviewerUsage` `:303`, `percentile` `:335`, reviewer budget `:1098`
- `tests/evals/agent-quality-matrix.ts` — `FAILURE_CATEGORIES` `:3`, `AgentQualityMatrixRow` `:57`, the matrix `:141`, `firstToolMatchesExpectation` `:1098`
- `tests/evals/agent-quality-matrix.test.ts` — registry invariants `:83`, `:99`, `:112`
- `tests/evals/agent-quality-ab.ts` — `createTrialOrder` `:79`, `redactSensitiveValue` `:83`, `classifyObservedDelta` `:201`, model echo `:316`
- `tests/evals/eval-judge.ts` — self-grading default `:164`, 150k char context `:56`, 1–10 scale `:152`
- `benchmarks/check_budgets.py`; `AGENTS.md:225-231`, `:280`

**FreeCode**

- `specs/2026-08-23-eval-harness.md` §3 (vocabulary), §4.1 (matching), §5 (architecture),
  §9.2 (gate), §12 (LLMOps), §14 (open questions)
- `specs/2026-08-26-trajectory-redirection.md` §9.1
- `apps/core/src/eval/{types,dataset,gate,compare}.ts`, `eval/scorers/trajectory.ts`,
  `providers/{registry,types,config}.ts`

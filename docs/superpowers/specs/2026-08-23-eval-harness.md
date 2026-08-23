# Eval Harness — scoring trajectories, and closing the loop with the rollout log

**Status:** Phases 0–1 **implemented** — `apps/core/src/eval/`, `evals/`, `freecode eval`.
Phases 2–5 remain design. Two deviations found while building are recorded inline: the
scorer input shape (§5.2) and the read-only mode restriction (§6.1).
**Date:** 2026-08-23
**Prior art:** waku-agent (`ShenSeanChen/waku-agent`), Python, local clone read for this
spec: `~/Projects/githubProjects/waku-agent`. Primary files
`waku/ops/scoring.py` (59 lines), `waku/ops/judge.py` (116), `waku/ops/release_gate.py`
(92), `waku/ops/coding_eval.py` (184), datasets `evals/dataset.jsonl` and
`evals/coding.jsonl`.
**Extends:** `2026-08-10-agent-observability.md` — this spec adds no new instrumentation.
Every scorer folds the event log that spec already produces.
**Related specs:** `2026-08-08-continual-harness-design.md` (Layer 1 has no way to tell
whether a harness edit helped), `2026-08-10-autonomous-runs-design.md` (§ gates need
something to gate on), `2026-08-05-token-efficiency.md`.

---

## 0. Read this first (plain language)

FreeCode can currently answer "what did the agent do, and where did the time go" — that
is what `freecode trace` is for. It cannot answer **"was that the right thing to do, and
is it still right after I changed the prompt."** There is no code in the repo that drives
a real agent turn and scores the result; `find -iname "*eval*"` returns exactly one hit,
`permission/evaluate.ts`, which is the permission rule engine and unrelated.

An eval harness is three parts: a **fixture** (a task with a known-good outcome), a
**runner** (drive the agent on that task, headlessly), and **scorers** (decide whether the
run was good). FreeCode already owns the runner — `cli/commands/run.ts` boots the full
backend and drives one turn without a TUI — and already owns the substrate every scorer
needs, because `rollout/trace.ts` folds the event log into typed spans. What is missing is
the fixture format, the scorers, and a gate that turns their output into an exit code.

That is the entire feature. It is **not** a benchmark submission, it does **not** need a
hosted service, and it adds **no** new dependency.

## 1. Motivation

Three concrete things are currently unfalsifiable in this repo:

1. **Prompt and harness changes ship on vibes.** `session/prompt/` holds
   provider-specific system prompts; `context/compiler.ts` decides what goes in position 0;
   `2026-08-05-token-efficiency.md` changed truncation policy across every tool. Nothing
   in CI would have caught any of these making the agent measurably worse at using tools.
2. **`2026-08-08-continual-harness-design.md` has no feedback signal.** That spec lets the
   agent edit its own memories, skills, and subagent definitions from evidence. An agent
   that rewrites its own harness with no way to measure whether the rewrite helped is a
   random walk with extra steps. The continual harness needs this spec to be honest.
3. **`2026-08-10-autonomous-runs-design.md` §Tier A promises budget-capped unattended
   runs** whose completion "the verifier/evaluator decides." There is no verifier. Today
   that sentence describes a component that does not exist.

There is also a fourth, quieter one. The rollout log has recorded every tool call, every
model span, and every failure for months. **Every production failure is already a
fully-specified eval case sitting on disk**, and nothing harvests them. §8 is the part of
this spec that matters most, and it is only cheap because §5 of the observability spec
already exists.

## 2. Goals / non-goals

**Goals.** Score the *trajectory*, not just the final message. Keep deterministic and
judged scoring in separate suites with different blocking semantics. Produce one exit code
suitable for CI. Make a real session convertible into an eval case in one command. Reuse
`Trace` as the sole input to every scorer, so the number on the terminal and the number in
CI cannot drift.

**Non-goals.** A leaderboard number. Reproducing SWE-bench or Terminal-Bench harnesses
(§10 explains why not). A hosted dashboard — `freecode trace --otlp` already ships to one.
Replacing the 98 `*.test.ts` unit tests, which stay exactly what they are (§3).
Evaluating *models*; this evaluates **this harness**, on a pinned model.

## 3. Vocabulary — three things that are not the same

Getting this straight is most of the design, and it is the one place the prior art gets
sloppy.

| Kind | Question it answers | Verdict | Cost | Blocks release? |
| --- | --- | --- | --- | --- |
| **Unit test** | Does this function behave? | 0/1 | free, no model | yes (already does) |
| **Deterministic eval** | Did the agent call the right tool, with the right args, and did the end state match? | 0/1 per trial | one real turn | yes — majority-of-3, vs baseline (§9.2) |
| **Judged eval** | Was the reply any good? | 0–5, thresholded | one turn + one judge call | only below threshold |

waku states this distinction well in its README — "conflating 'did it do the thing' with
'was it any good' is the most common eval mistake" — and then **partly violates it**:
`evals/deterministic/` contains `test_packaging.py`, `test_html_escaping.py`, and
`test_static_js_parses.py`, which are ordinary unit tests that never start an agent. That
inflates the eval count and dilutes the signal.

**FreeCode's rule: a file under `evals/` runs a real agent turn. If it doesn't, it is a
`*.test.ts` and belongs next to the code it tests.** `tsx --test` keeps owning those.

## 4. Case format

One JSON object per line, as in waku's `evals/dataset.jsonl` — diffable, greppable,
appendable, no schema migration. Two suites, two shapes.

**`evals/trajectory.jsonl`** — did the right tool fire?

```jsonc
{
  "id": "grep-before-read",
  "prompt": "Where is HANG_THRESHOLD_MS defined?",
  "model": "anthropic/claude-sonnet-5",   // pinned; see §11
  "expect_tool": "grep",
  "expect_in_args": { "pattern": "HANG_THRESHOLD_MS" },
  "expect_max_turns": 3,
  "forbid_tools": ["write", "edit"]
}
```

**`evals/coding.jsonl`** — did the end state match? Outcome-checked, no judge, the shape of
waku's `coding.jsonl`:

```jsonc
{
  "id": "fix-off-by-one",
  "files": {
    "calc.mjs": "export const add = (a, b) => a - b;\n",
    "check.mjs": "import { add } from './calc.mjs';\nimport assert from 'node:assert';\nassert.equal(add(2, 3), 5);\nassert.equal(add(-1, 1), 0);\n"
  },
  "prompt": "add() in calc.mjs returns the wrong result. Fix it. Do not modify check.mjs.",
  "verify": "node check.mjs"
}
```

**Every file the case references must appear in `files`, including the checker** — a
`verify` that runs a script the fixture never created fails for the wrong reason and reads
as an agent failure. The harness validates this at load time (`dataset.ts`): if `verify`
names a path that is neither in `files` nor created by the case, the case is rejected
before a single token is spent.

`verify`'s exit code is the score. **This is the highest-value scorer in the harness and
the cheapest to trust**, because nothing subjective enters it: the tests pass or they do
not. Prefer it over a judge wherever a task can be phrased this way.

**Synthetic fixtures are dependency-free by rule** — plain `.mjs` and `node:assert`, run by
`node`, which every environment that can run FreeCode already has. Not `npx tsx`: that
needs a populated `node_modules` the sandbox does not have, and solving it per case means
an install (slow, networked, flaky) at the exact point the harness is supposed to be
boring. Cases that genuinely need the repo's toolchain are a different sandbox with a
different cost profile — see §6.2.

### 4.1 `expect_in_args` matching semantics

Undefined matching is a silent source of both false reds and false greens, so it is fixed
here. Default is **case-insensitive substring** against `String(args[key])`, matching
waku's `check_case`:

| Form | Meaning |
| --- | --- |
| `"needle"` | case-insensitive substring of `String(args[key])` |
| `{ "$eq": v }` | strict deep equality |
| `{ "$regex": "..." }` | `RegExp` test, case-insensitive unless `$flags` given |

Substring is directional and it is worth internalising which way: expecting
`HANG_THRESHOLD_MS` **fails** when the model greps for `HANG_THRESHOLD`, because the
expectation must be contained in the actual. **Write the shortest needle that still
distinguishes the right behaviour from the wrong one.** A case that encodes one exact
spelling of a search term is testing the model's phrasing, not the harness.

`forbid_tools` and `expect_max_turns` exist because the literature is consistent on this
point: an agent can produce the right answer while making duplicate calls, touching files
it shouldn't, and burning turns, and an outcome-only check rates that perfect. Scoring the
trajectory is the whole reason this harness folds spans instead of diffing final text.

## 5. Architecture

```
apps/core/src/eval/
  types.ts          # EvalCase, EvalResult, Scorer, SuiteReport
  dataset.ts        # load + validate evals/*.jsonl
  runner.ts         # drive one case → Trace  (reuses cli/commands/run.ts's boot path)
  sandbox.ts        # tmpdir (synthetic) or git worktree (repo tasks) per case
  scorers/
    trajectory.ts   # expect_tool / expect_in_args / forbid_tools / expect_max_turns
    outcome.ts      # spawn `verify`, exit code is the verdict
    efficiency.ts   # tokens, cache-read ratio, model_ms, tool_ms, USD
    judge.ts        # rubric, 0–5, judge model ≠ model under test
  gate.ts           # thresholds → exit code
  report.ts         # eval_report.json (latest) + eval_runs.jsonl (history)
evals/
  trajectory.jsonl
  coding.jsonl
  rubrics/*.md
```

### 5.1 Where each scorer's input actually comes from

FreeCode persists a run to **two** places, and conflating them produces a design that
cannot be built. Getting this table right is a precondition for Phase 1.

| Input | Store | Field | Status today |
| --- | --- | --- | --- |
| Model call timing, TTFT, tokens, hangs | rollout JSONL | `ModelSpan.*` | ✅ present |
| Which tools fired, and when | rollout JSONL | `ToolSpan.tool` | ✅ present |
| **Tool call arguments** | rollout JSONL | `FunctionCallEvent.args` | ⚠️ **recorded, then dropped by the fold** |
| User prompt | thread store | `StoredTurn.prompt` | ✅ present |
| Assistant reply | thread store | `StoredTurn.response` | ✅ present |
| Tool args + results | thread store | `StoredToolCall.args` / `.result` | ✅ present |

The one gap is real but small. `rollout/types.ts` defines `FunctionCallEvent.args:
Record<string, unknown>`, so the arguments **are** in the log — but `trace.ts:137-139`
folds `function.call` into nothing more than a timestamp in a `pendingTools` map, and
`ToolSpan` is `{ tool, startedAt, duration_ms }`. So `expect_in_args` cannot be scored
from a `Trace` as it stands.

**This is a fold change, not an instrumentation change**, and the distinction is the whole
point: the log already recorded the right thing. Phase 0 adds `args` to `ToolSpan` and
carries it through the fold — about three lines — which also makes `freecode trace --json`
strictly more useful. The rule survives intact: *adding a scorer must never require adding
instrumentation.*

### 5.2 The scorer signature

Because prompt and reply text live in the thread store and **must never move into the
rollout log**, the scorer input is a pair, not a `Trace`:

```ts
interface RunRecord {
  trace: Trace;      // rollout log → timing, spans, tool names + args
  prompt: string;    // the case's own prompt
  response: string;  // assistant text
}
type Scorer = (run: RunRecord, kase: EvalCase) => TrialScore;
```

**Deviation from the design draft, found while building.** This spec originally typed the
second field as `turn: StoredTurn`, on the reasoning that reply text lives in the thread
store. That is true for a *harvested* session (§8) and false for a *live* one: the runner
already has the prompt (it is the case) and can capture the reply off the stream bus as it
streams, so going back to the store would be a round trip to fetch something it just
watched go past — and would drag in the session→thread id mapping for no gain.

What was load-bearing survives unchanged: the **text is separate from the trace**, and the
rollout log still never carries message bodies. Where the text comes from is the caller's
business — bus for live runs, `StoredTurn` for harvested ones.

Deterministic scorers read `run.trace` only. The judge is the sole consumer of
`run.response`.

**Why the split is deliberate rather than accidental:** observability spec §6 makes "no
prompt or completion text leaves the machine" a load-bearing property of OTLP export, and
that property holds *only* because the rollout log records sizes and names rather than
bodies. The thread store is local-only and never exported. Putting text in the log to give
scorers one input would silently convert a privacy guarantee into a privacy bug the first
time someone ran `--otlp`. The two-store boundary is the feature.

One consequence worth stating, because it is the opposite of what it looks like:
**historical sessions *can* be re-judged.** `StoredTurn.response` is persisted, so a judge
run over a harvested case (§8) does not need the original run replayed. What cannot be
recovered retroactively is anything the thread store never held — which, per the table
above, is nothing the current scorers need.

## 6. Runner and sandbox

`cli/commands/run.ts` already boots providers, MCP, and the Effect runtime, drives one
turn, and exits — the comment on it says "designed for scripting." The eval runner calls
the same internals **in-process**, not by shelling out to the binary, so a case can be
stepped through in a debugger and so the harness works from a source checkout without
`pnpm build:bun`.

Per case: fresh session id (so each case gets its own rollout aggregate and therefore its
own `Trace`), fresh sandbox, `--agent build` unless the case overrides it.

### 6.1 Tier 1 sandbox — tmpdir, zero dependencies (Phases 1–2)

Synthetic cases get a tmpdir seeded from `files`, and **nothing else**. No `node_modules`,
no install step, no network. This is why §4 mandates dependency-free fixtures: the moment a
`verify` needs `npx tsx`, the harness needs a package install per case, and an eval suite
whose setup can fail for network reasons is one that gets disabled.

**Deviation, found while building Phase 1: until this tier exists, cases run against the
real working directory.** A trajectory case is scored, not sandboxed, and `forbidTools` is
a *scorer* — by the time it reports "called forbidden write", the file is already written.
Agent mode is the only mechanism that actually prevents the mutation, so:

- `runner.ts` defaults to `explore`, not `build`.
- `dataset.ts` **refuses** `build` and `danger` at load time, naming the missing sandbox.
- `bash` is not in `READONLY_TOOLS` (`permission/mode-policy.ts`), so bash cases wait for
  the sandbox too — which means the trajectory suite currently cannot exercise the
  most-used tool in the product. That is the strongest argument for prioritising this tier
  over the judge in §11.

This was a real hazard in the first draft of the dataset, which contained a build-mode case
asking the agent to change a constant in `rollout/trace.ts`. It would have edited the repo.

### 6.2 Tier 2 sandbox — repo-grounded, deferred with its blocker named

Cases that operate on FreeCode's own source need the repo, and the repo needs
`node_modules`. Two honest options, neither free:

| Option | Cost | Problem |
| --- | --- | --- |
| `pnpm install --offline --frozen-lockfile` per worktree | seconds to minutes | needs a warm store; fails closed offline |
| Symlink the parent's `node_modules` into the worktree | ~free | pnpm's nested symlink layout makes this fragile, and the sandbox now shares mutable state with the host |

**Tier 2 is deferred until Tier 1 has proven the harness.** Naming the blocker is the
point: this is the first thing that would have broken in Phase 2, and discovering it after
writing the runner is worse than scoping it out now.

### 6.3 What worktree isolation does and does not buy

When Tier 2 lands, `git worktree add --detach` at a pinned SHA is the pragmatic choice —
but it is **working-tree isolation, not repo isolation.** A worktree shares the parent's
`.git`, so refs, config, and hooks are all still reachable and mutable from inside it, and
an agent holding `bash` can `cd` anywhere on the filesystem regardless. It protects the
files you were editing when you launched the run. It does not sandbox the agent.

Real isolation is a container, and that is the correct answer for untrusted cases — it is
listed in §13 rather than adopted here because Tier 1 tmpdir cases do not need it and
paying container cost for them would be the wrong trade. The settings-inheritance question
in §14 is the same hole seen from another angle: a worktree inherits
`.freecode/settings.json`, including permission rules and hooks.

## 7. Judge

Separate suite, separate command, separate blocking rule. Rubric lives in
`evals/rubrics/*.md`, not in TypeScript, so tuning it is a text diff.

Three constraints, all borrowed from `waku/ops/judge.py` and all non-negotiable:

1. **The judge must not be the model under test.** A model grading itself is neither fair
   nor credible. Configure via `FREECODE_JUDGE_PROVIDER` / `FREECODE_JUDGE_MODEL`; the
   gate refuses to score if they resolve to the same id as the case's `model`.
   **This check is best-effort and cannot be made complete.** It compares normalised model
   ids, so it catches the obvious mistake and misses aliases of the same weights — a dated
   snapshot id, a gateway route, an OpenRouter path — because nothing in the response tells
   you what is behind a route. Mitigation is disclosure rather than detection: the resolved
   judge provider and id are written into every report, so a reader can catch what the
   comparison cannot.
2. **The judge is told which tools actually fired**, from `trace.toolSpans`, as ground
   truth. Without it a truthful "I've saved that to memory" reads as a hallucination and
   gets marked down. waku's rubric handles this explicitly and it is the single most
   common false negative in agent judging.
3. **A judge outage must never fail a run** — it returns `null` and the case reports
   "not scored." An eval harness that goes red because a third-party endpoint 429'd
   teaches the team to ignore red.

**Scale is 0–5, not waku's 0–10.** Reported human–judge agreement peaks around 0–5
(~0.89 Pearson); a 10-point scale invites the judge to emit a "7" that carries no more
information than "4/5" and implies precision no LLM judge delivers.

## 8. Harvesting cases from production — `freecode eval add`

The one thing this design has that the prior art does not, and the reason to build it
here rather than adopt a generic runner.

```
freecode eval add <session-id> [--turn N] [--suite trajectory]
```

Reads **both** stores for that session — per §5.1, neither alone is sufficient — and emits
a **draft** case:

| Field | Source |
| --- | --- |
| `prompt` | `StoredTurn.prompt` (thread store) |
| `expect_tool`, `expect_in_args` | `ToolSpan.tool` + `.args` (rollout log, after the §5.1 fold fix) |
| `expect_max_turns` | `trace.modelSpans.length` |
| `model` | `ModelSpan.model` |

The human edits the expectation — because the harvested run is usually the *wrong*
behaviour, that being why it is interesting — and appends it. A session whose thread-store
record has been pruned yields no `prompt` and the command fails loudly rather than emitting
a case with an empty task.

This closes the loop the repo is currently missing. Observability makes failures
*visible*; without this command, making them *permanent* is a manual transcription job
that nobody does. Growing the dataset from real production failures is the single
practice the eval literature is most unanimous about, and FreeCode is unusually well
placed for it: the trajectories are already durable, already typed, and already folded.

## 9. Gate and report

```
freecode eval                      # trajectory suite, 1 trial, human-readable
freecode eval coding --trials 3
freecode eval --judge              # judged suite only
freecode eval --gate               # everything; exit 1 blocks release
freecode eval --json               # machine-readable, for CI annotations
```

### 9.1 Why "100% must pass" cannot be the rule

An earlier draft of this spec gated on 100% of deterministic cases passing, with pass^3 in
CI. That is arithmetically incoherent against the variance this same spec cites. If a case
has a true per-trial pass rate `p`, then across `n` cases:

| Rule | p=0.93, n=20 | p=0.99, n=20 |
| --- | --- | --- |
| pass@1 (1 trial) | 23% green | 82% green |
| **majority of 3** | **75% green** | **99.4% green** |
| pass^3 (all 3) | 1.3% green | 94% green |

A gate that is green 1.3% of the time on a *healthy* system is not a gate, it is a broken
build light — and §7 already argues that a signal which fires on healthy runs teaches the
team to ignore it. **The contradiction was real and the fix changes the design, not the
wording.**

Two things follow. First, the blocking statistic is **majority-of-3**, not pass^3; pass^3
is reported because it is the honest consistency number, and reported numbers may be
sobering without being blocking. Second — and this is the part the table actually teaches
— **a case at p=0.93 is a bad case, not a hard task.** The right response is not a looser
gate but a curated set at p≥0.99, and the mechanism that finds the p=0.93 cases is §9.3.

### 9.2 Gate semantics

| Suite | Blocking rule | On failure |
| --- | --- | --- |
| Deterministic | majority-of-3 per case, **and** pass count ≥ recorded baseline | exit 1, judge not run |
| Deterministic, previously-green case goes red | hard block regardless of baseline | exit 1 |
| Judged | mean ≥ 3.5/5 **and** no single case below 2/5 | exit 1 |
| Judged, no key configured | reported as `skipped` | exit 0 |
| Efficiency | regression vs baseline > 15% | warn only, see §12 |
| Quarantined cases (any suite) | run and reported, never blocking | exit 0 |

Gating on **delta against a recorded baseline** rather than an absolute is what makes the
suite usable while cases are still being curated: a run that matches last week's 18/20 is
green, a run that drops to 14/20 is red. The "previously-green case goes red" clause is
what stops the baseline ratcheting downward — the failure mode a pure delta gate has.

The judged floor exists because a mean hides catastrophes: one 0/5 disaster averages away
behind four 5s and ships. Mean measures the suite; the floor measures the worst case, and
for a release gate the worst case is the one that matters.

### 9.3 Quarantine — the flaky policy, decided

`evals/quarantine.txt`, one case id per line with a reason, **shipped in Phase 1 rather
than deferred.** A gate cannot both block on flakiness and leave flaky-case policy open;
choosing majority-of-3 *is* a flaky policy, so the quarantine list is not optional
tooling, it is the other half of the gate.

Promotion and demotion are driven by observed pass rate over `eval_runs.jsonl`, not by
opinion: a case whose trailing-20-run rate falls below 0.9 is proposed for quarantine, a
quarantined case above 0.98 is proposed for release. `freecode eval --quarantine-report`
prints both lists. **The harness measuring its own case quality is the feature** — it is
the only way to distinguish "the agent regressed" from "that case was always a coin flip."

`report.ts` writes `~/.freecode/eval_report.json` (latest verdict) and appends to
`~/.freecode/eval_runs.jsonl` (history) — same two-file pattern as `release_gate.report`.
The history file is what makes "did last week's prompt change cost us anything" a query
rather than an argument, and it is what §9.3 reads to compute pass rates.

## 10. What this deliberately is not

**Not SWE-bench or Terminal-Bench.** Both are worth reading and neither is worth
reproducing here. SWE-bench scores a *model's* patch against real GitHub issues;
Terminal-Bench ships 89 hand-verified tasks each with its own Docker image and oracle
solution. Running either tells you about the model. This harness exists to catch *your own
harness regressions* — a prompt edit, a truncation policy change, a tool description
reword — on a pinned model, in minutes, for cents. Those are different jobs.

Two documented hazards reinforce the split. An analysis of top-30 SWE-bench leaderboard
entries found **~19.8% of "solved" cases semantically incorrect** — passing tests by
coincidence or by reward-hacking the harness. And "the harness is half the score":
10–20pp swings on identical weights. A local suite you wrote, whose cases you can read,
is more trustworthy for regression detection than a public number you cannot audit.

**Not a new dependency.** The TypeScript eval field — Evalite, the Braintrust JS SDK,
`autoevals`, promptfoo — is real and reasonable, and none of it fits: the runner must
drive *this* agent loop and read *this* rollout log, which is the entire harness. The
generic part they provide is `for (const case of cases)`. A rubric is twenty lines of
markdown. Adopting a framework here would mean adapting FreeCode's trajectory model to a
foreign one to get a loop we already have.

## 11. Phasing

| Phase | Deliverable | Notes |
| --- | --- | --- |
| **0** | ✅ **Done.** `ToolSpan.args` carried through the `function.call` fold (`rollout/trace.ts`) | Optional, because a truncated log can yield an output whose call is absent. |
| **1** | ✅ **Done.** `eval/{types,dataset,match,runner,suite,report,gate,quarantine}.ts` + `scorers/trajectory.ts` + `evals/trajectory.jsonl` (20 cases) + `evals/quarantine.txt` + `freecode eval` | No new deps. 37 unit tests; verified end-to-end on a 3-case subset. |
| **2** | Tier 1 `sandbox.ts` (tmpdir, zero-dep) + `scorers/outcome.ts` + `evals/coding.jsonl` | Real signal, no judge, no subjectivity. **Promoted above the judge** — §6.1 explains why. |
| **3** | `scorers/judge.ts` + `gate.ts` + `--gate` in CI | Needs a second provider key. Set the threshold from the first real run, not from this document. |
| **4** | `freecode eval add` | Depends on Phase 0 + 1. Pull it forward if Phase 2 slips. |
| **5** | LLMOps close-out — §12 | Independent of 0–4. |
| **later** | Tier 2 repo-grounded sandbox (§6.2) | Blocked on the `node_modules` question, not on the harness. |

Every case in Phase 1 pins `model`. A provider default change must not silently reprice
the baseline; a repriced baseline is worse than no baseline, because it looks like data.

## 12. LLMOps close-out — the observability gaps this exposes

Building §9's efficiency scorer surfaces four gaps in the observability layer. All are
small; the first is the only one that blocks anything.

1. **There is no USD anywhere.** `usage/tracker.ts` records tokens and `usage.get` serves
   them, but a price table exists in exactly one file — `providers/minimax.ts`. Until a
   shared `providers/pricing.ts` exists, "this prompt change made every turn 18% more
   expensive" is undetectable, and the efficiency gate in §9 can only warn. **This is the
   highest-leverage item in this spec outside Phase 1.**
2. **Export is manual.** `freecode trace <id> --otlp` is post-mortem and opt-in. The
   observability spec §7 already defers live streaming; an `FREECODE_OTLP_ENDPOINT` that
   ships each session's spans on turn end — still from the log, never from the hot path —
   would make Langfuse a live view rather than an archive. Langfuse ingests OTLP/HTTP JSON
   on `/api/public/otel`, which is exactly what `otlp.ts` already emits.
3. **Span coverage stops below the agent.** `otlp.ts` emits model spans; the GenAI
   conventions now also cover agent orchestration and MCP tool calls. Adding an
   `invoke_agent` root span per session and setting `gen_ai.conversation.id = sessionId`
   makes a multi-turn session render as one tree instead of N unrelated calls.
4. **Eval results should themselves be spans.** The conventions include a quality
   evaluation layer, so a gate run can ship to the same collector as the runs it graded —
   scores and traces in one place, no second UI.

Pin this caveat with them: **`gen_ai.*` is still marked "Development", not Stable**, as of
mid-2026. Core chat and embedding attributes are safe to build dashboards on; the agent
and tool-orchestration attributes above are provisional and may be renamed.
`OTEL_SEMCONV_STABILITY_OPT_IN` exists for dual-emission during such a rename.

## 13. Deferred

- **Agent-as-judge** with dynamic rubrics over the full trajectory. Stronger than a fixed
  judge prompt on long-horizon tasks, and materially more expensive. Revisit when the
  judged suite is large enough that fixed-rubric ceilings actually bite.
- **Memory / retrieval evals** — waku ships a `memory_arena.json` for this. FreeCode's
  memory graph (`memory/graph/`) is a bigger surface and deserves its own dataset, keyed
  off `2026-07-26-memory-knowledge-graph.md`, not a subsection here.
- **Multi-provider matrix runs.** Cheap to add once §11 Phase 1 lands (loop the pinned
  model), but a matrix is a model comparison, and §2 says that is not this harness's job.
- **Container isolation.** The correct answer for untrusted cases and the only thing that
  actually sandboxes an agent holding `bash` (§6.3). Not adopted now because Tier 1 tmpdir
  cases do not need it; required before this harness ever runs a case it did not author.
- **Red teaming.** Adversarial prompt suites are a real need for the permission layer
  (`permission/rules.ts`) and a different spec.

## 14. Known gaps and open questions

- **Deterministic evals still cost money.** They drive real model calls, so "deterministic"
  means *the scoring is deterministic*, not the run. Budget accordingly: a pinned cheap
  model and ~20 cases keeps a full Phase 1 gate in the cents, and `--trials 3` triples it.
- **The initial baseline has to come from somewhere.** §9.2 gates on delta against a
  recorded baseline, but the first run has no baseline. Bootstrap is: run the suite 3×,
  record the median pass count, quarantine anything below 0.9, and treat *that* as run
  zero. Until ~20 runs of history exist, §9.3's promotion/demotion rates are computed on
  thin data and should be read as advisory.
- **`.freecode/settings.json` inheritance is undecided.** A sandbox inherits the repo's
  settings, including permission rules and hooks, which is usually right and occasionally
  the thing under test. Needs a decision before Tier 2 (§6.2); Tier 1 tmpdir cases dodge it
  by not being inside the repo.
- **The judge threshold (3.5/5) and the per-case floor (2/5) are both guesses.** They
  should be set from the first real run of the judged suite. They are written down so the
  gate is implementable, not because the numbers are known.
- **`expect_in_args` on structured arguments is underspecified.** Substring matching over
  `String(args[key])` degrades badly when the value is an object or array — `$eq` and
  `$regex` cover the cases that matter today, but a case needing "this array contains this
  element" has no clean spelling yet.

## 15. References

**Prior art read for this spec**

- [waku-agent](https://github.com/ShenSeanChen/waku-agent) — the deterministic/judged split, the JSONL case format, the release gate, and the two-file report pattern all come from here.

**Agent evaluation**

- [Beyond SWE-Bench: How to Actually Evaluate AI Coding Agents in 2026](https://medium.com/@allahverdiyev.tural/beyond-swe-bench-how-to-actually-evaluate-ai-coding-agents-in-2026-8233940530f1)
- [Agent Eval Harness: How to Evaluate AI Agents, Not Just Models](https://futureagi.com/blog/agent-eval-harness/) — trajectory-over-outcome scoring; §4's `forbid_tools` / `expect_max_turns`.
- [LLM-as-a-Judge in 2026: techniques and best practices (DeepEval)](https://deepeval.com/blog/llm-as-a-judge)
- [How to Evaluate AI Agents: LLM-as-Judge Tutorial (AWS)](https://dev.to/aws/how-to-evaluate-ai-agents-llm-as-judge-tutorial-4a6h) — the 0–5 scale and its ~0.89 human agreement (§7).
- [Agent Judge: Long-Horizon Evals for Production Agents (Judgment Labs)](https://www.judgmentlabs.ai/blogs/agent-judge-solving-long-context-evaluations) — the agent-as-judge direction deferred in §13.
- [Agent Evaluation — metrics and strategies (Langfuse)](https://langfuse.com/guides/cookbook/example_pydantic_ai_mcp_agent_evaluation)

**Benchmarks and their caveats**

- [SWE-Bench vs Terminal-Bench: AI Benchmark Guide for 2026](https://www.digitalapplied.com/blog/swe-bench-terminal-bench-benchmark-guide-2026)
- [How We Broke Top AI Agent Benchmarks — And What Comes Next](https://moogician.github.io/blog/2026/trustworthy-benchmarks-cont/) — the ~19.8% mislabelled-"solved" figure in §10.
- [AI Agent Benchmarking Infrastructure at Scale (Spheron)](https://www.spheron.network/blog/ai-agent-benchmarking-gpu-cloud-swebench-gaia/) — pass@k / pass^k reporting, image pinning.

**Observability (§12)**

- [OpenTelemetry (OTEL) for LLM Observability — Langfuse](https://langfuse.com/integrations/native/opentelemetry) — the `/api/public/otel` ingest path.
- [OpenTelemetry's GenAI semantic conventions are NOT stable yet](https://dev.to/azena-ai/opentelemetrys-genai-semantic-conventions-are-not-stable-yet-heres-what-actually-shipped-in-2026-3mke) — the "Development" stability caveat.
- [OpenTelemetry GenAI Semantic Conventions: A Practical Guide](https://openobserve.ai/blog/opentelemetry-genai-semantic-conventions/)
- [OpenTelemetry for AI Agents (Zylos Research)](https://zylos.ai/research/2026-02-28-opentelemetry-ai-agent-observability/) — `invoke_agent` root spans, `gen_ai.conversation.id`.

**TypeScript eval tooling — evaluated and not adopted (§10)**

- [Evalite](https://github.com/mattpocock/evalite) · [autoevals](https://github.com/braintrustdata/autoevals) · [Braintrust JS SDK](https://github.com/braintrustdata/braintrust-sdk) · [Your App Is Only As Good As Its Evals](https://www.aihero.dev/what-are-evals)

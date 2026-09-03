# Agent Comparison Benchmark — freecode against Claude Code, Codex and OpenCode, on somebody else's tasks

**Status:** Design
**Date:** 2026-09-03
**Prior art:** Superbrain's public benchmark (`https://www.onesuperbrain.com/benchmarks`),
read for this spec on 2026-09-03. 10 Django bugs from SWE-bench Lite, Claude Sonnet 5
pinned on both sides, official SWE-bench grader in Docker, artifact bundle published.
Also `scripts/bench_memory.py` (this repo — already discovers and launches seven competing
agent CLIs) and `bench/jcode-bench/` (this repo — optimization-speedup tasks).
**Extends:** nothing. This is a new axis, deliberately outside `apps/core/src/eval/`.
**Related specs:** `2026-08-23-eval-harness.md` (§2 non-goals: "a leaderboard number" —
this spec is where that goal goes to live, under different rules),
`2026-08-29-eval-case-registry.md`, `2026-08-10-agent-observability.md`.
**Related docs:** `EVAL.md` (internal quality), `Benchmark.md` (runtime footprint).

---

## 0. Read this first (plain language)

FreeCode can already answer *"did my last change make the agent worse?"* — that is
`pnpm eval`, and `EVAL.md` is its operator page. It cannot answer the question anyone
outside this repo actually asks: **"is it better than Claude Code, and what does it cost?"**

Those are different instruments and they cannot be the same code. The eval harness scores
*our* rollout log; a competitor produces no rollout log. So a comparison benchmark has to
throw away everything that makes the eval harness good — the trajectory scorer, the
baseline, the gate — and keep only the part that is agent-agnostic: **did the end state
match, and what did getting there cost.**

The deliverable is a table of that shape, backed by a downloadable artifact bundle, on a
public page. It is marketing only if the artifacts are missing. With them it is evidence.

## 1. Motivation

1. **The claim is currently unbacked.** The README positions freecode against these agents.
   Nothing in the repo measures that. `Benchmark.md` measures RSS and time-to-first-frame,
   which is a real comparison of a *different thing* — a fast TUI that fixes no bugs is
   not a better coding agent.
2. **Token efficiency is the one axis where the design should win and nobody can see it.**
   `2026-08-05-token-efficiency.md` changed truncation policy across every tool;
   `providers/pricing.ts` prices every span; `freecode trace` shows where the tokens went.
   All of it is invisible from outside. Superbrain's headline is 94k vs 265k tokens on a
   typical issue — that is the shape of the claim available here, and it is unmade.
3. **`bench/` is already half-built in two directions and joined in none.**
   `bench/jcode-bench/` has three tasks and a `results.json` carrying a geomean of `0.0`;
   `scripts/bench_memory.py` already resolves `codex`, `opencode`, `claude`,
   `cursor-agent`, `copilot`, `antigravity` off `PATH`. The adapter layer for a real
   head-to-head mostly exists; it just launches TUIs instead of driving tasks.
4. **The web app is already wired for this.** `pnpm bench:memory` writes straight into
   `apps/web/app/data/results-1.json` and `apps/web/app/components/Benchmark.tsx` renders
   it. A comparison table has a home the day it produces JSON.

## 2. Goals / non-goals

**Goals.** Produce a defensible head-to-head table on pass rate, cost, tokens and wall
time, against agents we do not control, on tasks we did not write, graded by a grader we
did not write. Publish the artifacts that make it checkable. Make adding an agent one JSON
file. Make the isolation auditable — anyone should be able to confirm no agent could look
the answer up.

**Non-goals.** A SWE-bench leaderboard submission (§10.1 — ten instances is a demo, and
saying so is part of the method). Comparing *models*: the model is pinned, this compares
harnesses. Replacing `pnpm eval`, which stays the regression instrument and keeps its gate.
Running in normal CI — this spends real money in Docker and is a release-cadence or
on-demand job, never per-push. Beating anyone. If freecode loses on pass rate we publish
that number, in the headline, the way the prior art did.

## 3. Four benchmark axes, three of them already exist

| Axis | Question | Where it lives | Cross-agent? |
| --- | --- | --- | --- |
| Runtime footprint | How much RAM, how fast to first frame? | `Benchmark.md`, `scripts/bench_memory.py` | yes, already |
| Optimization quality | How much faster did it make this Rust? | `bench/jcode-bench/` | not wired |
| Harness regression | Did my change make *our* agent worse? | `evals/`, `EVAL.md` | **structurally no** |
| **Task correctness + cost** | **Does it fix real bugs, and for how much?** | **this spec** | **the whole point** |

The row that matters is the third. It is worth being precise about why it can never be
the fourth.

## 4. Why the eval harness cannot do this

Three suites, three scorers, and only one of them survives contact with a foreign agent.

| Scorer | Input | Portable? |
| --- | --- | --- |
| `scorers/trajectory.ts` | `buildTrace(sessionId, events)` — our rollout log | **no.** Claude Code emits no `function.call` events. There is nothing to fold. |
| `scorers/judge.ts` | our reply text + a rubric | technically yes, worthless in practice — a judged prose score is not a bug fix, and we would be grading a competitor with our own rubric |
| `scorers/outcome.ts` | the filesystem; `kase.verify`'s exit code | **yes.** It never asks what produced the diff |

`scorers/outcome.ts` is the entire transferable surface, and the spec that introduced it
already says why it is the one to trust: "nothing subjective enters it: the tests pass or
they do not."

Two further reasons this must not live under `apps/core/src/eval/`:

- **`dataset.test.ts` would reject every case.** The registry audit requires
  `failureCategory`, a non-empty `whyModelBacked`, and a `files` fixture for any mutating
  mode. A SWE-bench instance is a git checkout, not a `files` map, and "why is this
  model-backed" is not a question a third-party bug has an answer to.
- **The gate semantics are wrong.** `gate.ts` is majority-of-N *versus a sticky baseline on
  the same resolved model* — built to detect our own regressions over time. A comparison
  has no baseline of ours to regress against; the comparison **is** the number.

So: `bench/agent-bench/`, standing alone, sharing no code with `apps/core/src/eval/`. The
duplication is the point.

## 5. Prior art: what Superbrain did, and what to take

Their method, as published:

- 10 real bugs from **Django** in SWE-bench Lite, fresh checkout per bug at the commit
  before the fix landed.
- **Claude Sonnet 5 pinned on both sides, both billed to the same API key.**
- Network closed so neither agent could look the fix up; every transcript audited.
- Graded by the **official SWE-bench grader, in Docker**.
- Published: patches, grader output, container logs, per-bug usage, the isolation audit.
- Result: 7 bugs vs 8 (they lost), $0.0648 vs $0.1039 on the issues *both* fixed, 94k vs
  265k tokens typical, 3.1× on worst-case cost.

**Take all six method points.** Three deserve to be called out as design constraints
rather than nice-to-haves:

1. **Cost is reported on the intersection of solved instances only.** Averaged over all
   attempts, an agent that gives up early wins on cost. This is the most-cheated number in
   agent comparisons and the correction is one line of arithmetic — §7.2.
2. **Same API key, one bill.** Removes any argument about whose accounting is right. We go
   one step further in §6.4, because "same key" still trusts each vendor's token counting.
3. **They led with a loss.** 7 vs 8 in the headline is why the cost claim is believable.

**Where to beat them, cheaply:** they ran **one trial per instance** and admit variance
across three. Running N=3 and publishing the spread costs 3× the money and buys the one
thing their page cannot claim.

## 6. Design

### 6.1 Task set

Phase 1 is **SWE-bench Lite, Django subset** — deliberately the same ground as the prior
art, so the numbers are directly comparable and any divergence is about the harness rather
than the task mix.

The task set must stay **external and third-party graded**. The moment we author the tasks,
the result is a demo of our own fixtures and outsiders are right to discount it. This is
the opposite of the rule in `evals/`, where authoring our own cases with a mandatory
`whyModelBacked` is exactly the discipline that keeps them honest — different instrument,
inverted rule.

Phase 3 adds a **held-out set harvested from this repo's own recent commits** (§10.2) as
the contamination control. That one we author, and it is only ever reported *alongside*
the external number, never instead of it.

### 6.2 Agent adapters, and the confound nobody discloses

One JSON file per agent under `bench/agent-bench/agents/`:

```jsonc
{
  "id": "freecode",
  "version_cmd": ["freecode", "--version"],
  "run": ["freecode", "run", "{prompt}", "--model", "{model}", "--agent", "danger",
          "--max-turns", "40"],
  "autonomy": "full: no permission prompts",
  "notes": "`--agent build` would deny every write headlessly — see below"
}
```

`freecode run` already takes `--model`, `--agent` and `--max-turns`
(`apps/core/src/cli/commands/run.ts`), so freecode needs no core change to compete.
Each competitor's exact invocation and version is **pinned in Phase 0 and recorded
verbatim in the artifact bundle** — not asserted from memory in this spec, because these
CLIs change flags between releases and a stale flag silently degrades a competitor, which
is the most dishonest failure mode available to us.

**Autonomy parity is the largest confound in the whole design and the one everybody omits.**
In freecode, `build` mode's default for a mutating tool is *ask*, and a headless ask
resolves to **deny** (`permission/prompt.ts`). That is precisely why the eval runner has to
subscribe to `permission.asked` and answer it (`apps/core/src/eval/runner.ts:157`) — without
that, a coding case scores a model that was never allowed to write, and the suite measures
the permission layer instead of the agent. A benchmark that runs freecode in `build` while
running a competitor in its full-auto mode is not measuring agents; it is measuring two
different permission defaults.

Rule: **every agent runs at its own maximum autonomy, and the flag that got it there is
printed in the results table.** The container is the safety boundary, not the permission
layer (§6.3).

### 6.3 Isolation

One container per `(agent, instance, trial)`. Nothing is reused between trials.

- Fresh checkout of the target repo at `base_commit`, i.e. the commit before the fix.
- **Egress blocked except the model endpoint.** Enforced by the network namespace, not by
  policy — and independently attested by §6.4, which sees every request that leaves.
- The agent's own config, credentials and history are not mounted. A memory dir carried
  between trials would make trial 3 easier than trial 1, which is a real risk here since
  freecode has one (`memory/`) and the competitors mostly do not. Disable it, and say so.
- Output: `git diff > patch.diff`, plus the raw transcript.

### 6.4 Metering: one meter, not four self-reports

`providers/pricing.ts` prices freecode's spans. Claude Code has its own accounting, Codex
another, OpenCode another. Comparing four self-reports is comparing four rounding policies.

Instead, every container points `ANTHROPIC_BASE_URL` at a **local recording proxy**.
Tokens are counted off the wire and priced once, by us, with one table. This gives three
things for the price of one:

1. Identical accounting rules across agents — the only way the cost column means anything.
2. The **isolation audit** for free: the proxy log *is* the list of everything that left
   the container. Any request that is not to the model endpoint is a leak, and the check
   is `grep`, not trust.
3. The transcript, for the manual audit the prior art also did.

The proxy is a pass-through — no caching, no retries, no rewriting. It must not become a
place where we accidentally optimize one side. Prompt-cache reads are recorded and priced
as a discount off the inclusive input count, matching `providers/pricing.ts`'s rule, since
agents differ enormously in how much they cache and pretending otherwise flatters whoever
caches least.

### 6.5 Grading

The official SWE-bench evaluation harness, in Docker, on `patch.diff`. Binary per instance:
resolved or not. We write no grader and we do not interpret partial credit.

This is `scorers/outcome.ts`'s contract at a larger scale — an exit code from a checker
that is not part of the task — and it inherits the same protection: the checker is
immutable to the agent, because it is not in the container at all.

### 6.6 Trials and honesty about variance

- **N=3 per (agent, instance)**, minimum. Report pass@1 as mean-of-3 with the spread, and
  flag any instance where the three trials disagree — those are the interesting ones.
- **Never merge trials into a best-of.** Best-of-3 is a different product than the one
  users run.
- No gate, no exit code, no baseline, no CI wiring. Same reasoning as `eval ab`: the moment
  it exits non-zero somebody wires it in and starts reverting on noise. This one is worse,
  because it would mean reverting on *a competitor's* noise.

## 7. Metrics, and the trap in each

| Metric | Definition | Trap |
| --- | --- | --- |
| **Resolved** | instances the official grader marks resolved, mean of 3 | best-of-3 inflation; publish the spread |
| **Cost/issue** | USD on the **intersection** of instances both agents resolved | averaging over failures makes the quitter cheapest — §7.2 |
| **Tokens/issue** | input+output off the proxy, same intersection | counting cache reads as fresh input flatters whoever caches least |
| **Worst-case cost** | max USD on a single resolved instance | a good mean can hide one $4 runaway; the prior art reports this and so should we |
| **Wall time** | container start to agent exit | penalizes agents that run tests; not obviously a vice — annotate, don't rank on it |
| **Turns** | model round-trips off the proxy | not comparable across harnesses; report, never rank |

### 7.2 The intersection rule, stated once

For cost and tokens, let `I = resolved(A) ∩ resolved(B)`. Report the mean over `I` only,
print `|I|` next to it, and suppress the number entirely when `|I| < 3` — with two shared
instances the mean is an anecdote wearing a decimal point. When more than two agents are in
the table, the intersection is pairwise against freecode and the table says so; a
four-way intersection shrinks to nothing and quietly becomes noise.

## 8. Layout

```
bench/agent-bench/
  README.md              # operator page — the "what do I type", like EVAL.md
  agents/*.json          # one adapter per agent (§6.2), incl. pinned version + flags
  instances/lite.txt     # the SWE-bench instance ids in play, one per line
  runner/                # container orchestration, trial loop, artifact collection
  proxy/                 # recording metering proxy (§6.4)
  grade/                 # thin wrapper over the official SWE-bench harness
  results/<date>/        # report.json + per-trial artifacts (git-ignored; zipped to publish)
```

Sibling to `bench/jcode-bench/`, sharing nothing with `apps/core/src/eval/`. `results/` is
ignored by git: it holds container logs and full transcripts, and a transcript is exactly
the kind of thing that should be reviewed before it becomes public.

One `package.json` script, matching the existing `bench:*` family:

```
pnpm bench:agents        # bench/agent-bench/runner, --agents, --instances, --trials, --out
```

## 9. Publication

`report.json` → `apps/web/app/data/` → the `/benchmarks` route, alongside the existing
runtime table that `apps/web/app/components/Benchmark.tsx` already renders from
`results-1.json`. The route follows whatever `apps/web/app/internal/` does for gating until
the numbers are ready to be public.

The page publishes, non-negotiably:

1. The table, **pass rate first** — even when we lose it.
2. Every agent's exact version, invocation and autonomy flag.
3. `|I|`, the intersection size, next to every cost number.
4. The caveats of §10, in the page's own words, not a footnote.
5. **The artifact bundle**: patches, grader output, container logs, per-bug usage, the
   proxy-derived isolation audit. Without this the page is a claim; with it, it is
   reproducible by a stranger.

## 10. Confounds and caveats, to be published rather than managed

1. **Ten instances is a demo, not a leaderboard.** SWE-bench Lite is 300 across 11 repos.
   One repository's idioms are not the field. Say the sample size in the headline.
2. **Contamination is unfixable on this task set.** Every SWE-bench Lite Django fix is
   public and predates the training cutoff of every model involved. Closing the network
   stops lookup; it does not stop recall. This does not invalidate a *relative* comparison —
   both agents get the same unfair advantage — but it does invalidate any absolute
   "can it fix bugs" reading. The held-out set from this repo's own recent commits (§6.1,
   Phase 3) is the only real control.
3. **This compares harnesses only while the model is pinned.** Same model, same key, each
   agent's own system prompt. Swapping prompts makes it a different experiment with the
   same table.
4. **Autonomy parity is a judgement call we are making, and disclosing** (§6.2).
5. **We built the harness and we are in the table.** Every incentive here points one way.
   The countermeasures are structural, not attitudinal: external tasks, external grader,
   published artifacts, and the standing rule that a loss is published in the headline.
6. **Agent CLIs move.** A flag that silently stopped working degrades a competitor and
   flatters us. Versions are pinned per run and re-verified before publication.

## 11. Phases

| Phase | Deliverable | Done when |
| --- | --- | --- |
| **0** | Adapter + container: freecode and Claude Code, **1 instance, 1 trial**, no grader | both produce a non-empty `patch.diff` in isolation |
| **1** | Proxy + grading: official grader wired, proxy metering, isolation audit | one instance graded end-to-end, tokens agree with `freecode trace` within rounding |
| **2** | **5 instances × 3 trials × 2 agents** → first `report.json` | intersection cost computed, spread reported |
| **3** | Codex + OpenCode adapters; 10 instances | table matches the prior art's shape |
| **4** | `/benchmarks` page + artifact bundle | a stranger can re-run it from the README |
| **5** | Held-out set from this repo's own commits (§10.2) | published next to, never instead of, the external number |

Phase 2 is the honest stopping point if the results are uninteresting. Phase 4 is a public
commitment and should not be started until Phase 2's numbers have been looked at.

## 12. Open questions

1. **Which model.** Sonnet 5 matches the prior art directly, which is worth a lot. If the
   token-efficiency story is the real headline, a cheaper pinned model makes N=3 across 10
   instances affordable and shifts the comparison toward harness overhead — where our
   design should be strongest. Answer before Phase 2, not after seeing the numbers.
2. **Does memory stay off?** §6.3 disables it for parity. It is also a genuine freecode
   feature that competitors lack, so "memory on" is a legitimate *second row* — but only if
   it is a second row, clearly labelled, never the headline number.
3. **Does `bench/jcode-bench/` fold into this?** Its three tasks are a real third axis
   (optimization quality, criterion-scored) and its `results.json` geomean is currently
   `0.0`. Same adapter and container layer would drive it. Out of scope for Phase 1;
   revisit at Phase 4.
4. **Retry-on-infrastructure-failure policy.** A container that dies on a network blip is
   not a failed fix. The eval harness treats an infrastructure failure as a failed trial
   (`runner.ts`) because there one dead case must not cost the other nineteen; here a
   wrongly-failed trial is a wrongly-published number. Leaning toward: retry once, log both
   attempts in the bundle.

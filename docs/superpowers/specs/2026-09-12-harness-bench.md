# Harness bench: measuring the agent the way jcode measures itself

> **Date:** 2026-09-12
> **Status:** Built (Phase 0–1). Operator reference: `HARNESS-BENCH.md`.
> **Prior art:** [jcode.sh/bench](https://jcode.sh/bench) (the uncontaminatable-benchmark spec), [jcode.sh/jcode-bench](https://jcode.sh/jcode-bench) (the leaderboard), and the six sections of jcode's homepage.

## 0. Read this first

jcode publishes six things about itself: how little RAM it uses, how it
compares to other agents, how far it climbs an optimisation task, whether its
model steps confidence honestly, whether its goals are hill-climbable, and
whether it keeps working when it would otherwise quit. We already had the
first two (`Benchmark.md`, `AGENT-BENCH.md`). This spec adds the other four
and one page that shows all six.

The rule that shaped everything: **measure before you flip.** Three of the
four new things are loop behaviours (poke, confidence gate, hill-climb gate).
Each ships **off by default** with its recording **always on**, so the page
can show what happened with the gate off — including on every session logged
before the gate existed — next to what happened with it on. Nothing on the
page decides a default; `eval ab` does (EVAL.md).

## 1. Goals / non-goals

- Every section on `/bench` has its own harness, its own data file, and the
  command that produced it printed beside it.
- The optimisation task uses jcode bench v1's tasks **unmodified**, so a
  freecode number sits on the same axis as jcode's published ones.
- The signal sections are a fold of the rollout log — free, offline, and
  re-runnable on any machine's `~/.freecode`.
- Non-goal: deciding whether any gate is good. Non-goal: isolation for the
  optimisation harness (§6). Non-goal: reproducing jcode's Terminal-Bench
  numbers (that is `docs/superpowers/plans/quality-bench.md` M5).

## 2. The signals (core)

`apps/core/src/agent/signals/`. Pure decision functions; the loop wires them
at two points.

**Todo scores.** `TodoItem` gains `confidence?` and `hillClimbability?`
(0–100, clamped, string-coerced for providers that send numbers as strings).
The prompt block renders them so the model can step its own last value.

**After any turn that called todowrite**, `diffTodoSignals(before, after)`:
- `confidence_spike`: an item marked completed whose confidence rose by
  `spike` (40) or more in that one call, with a number on both sides. An item
  first rated on the call that completes it is not a spike — there was no
  assignment number to step from.
- `hill_climb_low`: an open item rated below `threshold` (90), once per
  rating (the same low number re-sent is the model's call, not a reason to
  nag).
Every signal → `todo.signal` in the rollout log, `gated: true/false`. Gate on
→ one `<system-reminder>` for the next turn. No model call, ever.

**At the stop** (no tool calls, after the verify and verifier gates):
`decidePoke`. Reasons, in order: `disabled`, `nothing_open`, `cap_reached`
(3/run), `no_progress` (the open items are byte-identical to the last
poke's). A poke is a reminder listing the open items; the loop grants another
turn. Every stop with a list present writes `poke.triggered` or
`poke.skipped` — `disabled` included, which is what lets the fold tell
"never looked" from "looked and declined". Subagents never poke.

Why `no_progress` and not just the cap: jcode's fingerprint rule. A model that
cannot finish an item will re-declare victory with the same list; poking it
three times burns three turns to learn one fact.

## 3. Optimisation task (`bench/jcode-bench/`)

Reuses agent-bench's adapters, spawn code, recording proxy and rate card by
relative import — the two harnesses are the same experiment with a different
task. Differences, each deliberate:

- **No turn cap** in the adapters. The climb is the measurement.
- **Tasks are staged from the public repo**, commit recorded per trial, never
  vendored. A fork that drifts stops being comparable.
- **Two scores per run.** `best` is the agent's own highest sample; `final`
  is the harness's grade afterwards on the submission as left, `--full` gate
  by default. Only `final` ranks. jcode's page makes the same distinction.
- **Time recorded, not judged.** A timed-out run is graded and marked, not
  discarded.
- **Gates in force are part of the number.** `FREECODE_AUTO_POKE` etc. are
  read from the operator env, passed through, and recorded as
  `harnessFlags`, so a gated run is a labelled, dashed line on the page.

Scoring and aggregation follow jcode: `log2(given/yours)`, geometric mean
across tasks, only for a harness with a verified final on every task.

## 4. Signals fold (`bench/harness-signals/`)

Standalone JSONL fold, no import from core (so measuring can never change
what is measured). Per session: confidence trajectories (assignment number
from an earlier call → number on the completing call), every hill-climb
rating, poke counts, and the **final list state** — which is measurable on
pre-gate logs and is the baseline. Aggregate splits the ended-open rate by
gate on/off. Numbers only leave the fold.

## 5. The page (`/bench`)

Six sections in jcode's order, each with the producing command printed.
Build-time reads of `app/data/jcode-bench/*.json`, `app/data/harness/
signals.json` and `app/data/benchmarks/*.json`; a new run appears by
existing. Empty states say what command fills them. Colour follows the
agent (`agentColor`), never the rank; status tones (spike, provisional) ship
with a label.

## 6. Debts, stated

- **No isolation for the optimisation harness.** Host run, open network,
  proxy sees only what is pointed at it. agent-bench's container path
  (`--isolate`) is the fix; the image would need `valgrind` and a C
  toolchain added.
- **Gates unmeasured by eval.** Each default stays off until an `eval ab`
  says otherwise. The page shows the effect; it does not judge it.
- **Confidence/hill-climb data starts at zero.** The fields are new; the
  chart fills as sessions rate items. The auto-poke baseline (52% of
  todo-carrying sessions ended open on the first fold) is real today.
- **Hill-climb gate has no "reframed?" follow-up.** jcode reports whether
  the model actually reframed; here the fold can see a re-rating, not a
  rewrite.
- `bench/jcode-bench/` previously held a July experiment (Rust prompts
  pointing at files that did not exist, a one-off `results.json`). Removed.

# Eval — command reference

> Operator's guide to the eval harness: what each command does, which flag to
> reach for, and when to run it. Design lives in the specs; this is the
> "what do I type" page.

| Doc | Date | What it is |
| --- | --- | --- |
| `docs/superpowers/specs/2026-08-23-eval-harness.md` | 2026-08-23 | **The original.** Phases 0–5, built. Suites, scorers, gate semantics, baseline/history, quarantine, judge independence. |
| `docs/superpowers/plans/2026-08-28-fx-eval-adoption.md` | 2026-08-28 | fx-inspired proposal. §4/§5/§6 were promoted to a spec the next day; **§3 (scripted provider) is still open** and is the valuable leftover. |
| `docs/superpowers/specs/2026-08-29-eval-case-registry.md` | 2026-08-29 | fx-inspired spec, shipped. `expectFirstToolIn`, `expectBashMatches`, registry fields, model-echo, `eval ab`. Where it and the plan disagree, **this one wins**. |

Suites live in `evals/*.jsonl`, one JSON object per line. Anything that does not
run a real agent turn is a `*.test.ts` next to its code, not a case here.

| Suite | Cases | Asks | Scorer |
| --- | --- | --- | --- |
| `trajectory` | 25 | did the right tool fire (and fire *first*) — incl. 3 clean negatives where the right move is to stop, ask, or report absence | `scorers/trajectory.ts` — pure fold, unsandboxed, read-only |
| `coding` | 11 | did the end state match | `scorers/outcome.ts` — `verify`'s exit code is the score |
| `judged` | 6 | was the reply any good | `scorers/judge.ts` — 0–5 against `evals/rubrics/*.md` |
| `redirect`, `redirect-build` | 8 | A/B material for trajectory redirection — **not** part of the gate | — |
| `gemini-web-tools` | 4 | does the web-session tool bridge hold (gemini-web spec §10; on by default since §10.4) — **not** part of the gate; run with `FREECODE_GEMINI_WEB_TOOLS=1` to override a local opt-out, repo-root cwd, slow by design (request pacing) | trajectory expectations |

`evals/quarantine.txt` (3 cases) ships with the gate: quarantined cases run and
report but never block.

---

## 1. Run a suite — `freecode eval [suite]`

```bash
pnpm eval                         # trajectory, 1 trial, no gate — the cheap smoke run
pnpm eval coding --trials 3
pnpm eval judged --gate
pnpm eval:gate                    # all three, in cost order — the release ritual
```

| Flag | Does what | Reach for it when |
| --- | --- | --- |
| `[suite]` | resolved as `evals/<suite>.jsonl` | default `trajectory` |
| `--trials N` | runs per case | unset = 1; `--gate` raises it to 3 for majority-of-3. An explicit `--trials 1` under `--gate` is honoured with a warning |
| `--model, -m` | `provider/model` override for cases that don't pin one | cross-model comparison, CI pinning |
| `--gate` | **exit 1 on regression against the recorded baseline** | release only |
| `--json` | machine-readable report | CI, dashboards |
| `--save <file>` | write this run's report to disk | before a change you intend to measure |
| `--compare <file>` | diff against a saved report; **exits 1 if the criterion is not met** | after that change — but prefer `eval ab`, below |
| `--stuck` | with `--compare`, also require repetition to fall | the redirect suites specifically |
| `--quarantine-report` | print promote/demote proposals from history and exit — runs nothing | periodic hygiene |
| `--accept-baseline` | record a *failing* run as the new baseline and exit 0 | only when the suite was deliberately re-scoped, never when the agent got worse |
| `--otlp [url]` | ship scores to a collector, linked to the traces they graded | empty value falls back to `OTEL_EXPORTER_OTLP_ENDPOINT` |

**Gate rule:** majority-of-N **plus delta vs the baseline**, never absolute 100%
(spec §9.1: at p=0.93 across 20 cases, pass^3 is green ~1.3% of the time). The
baseline is the last run that did *not* close the gate, **on the same resolved
model** — so a new model's first run is "run zero" and passes unconditionally.

Judged cases switch the rule to **absolute**: mean ≥ 3.5 and no case < 2.

There is no override flag. Omitting `--gate` is already how you run the suite
without blocking.

## 2. Paired A/B — `freecode eval ab <suite>`

```bash
pnpm eval ab redirect \
  --baseline  env:FREECODE_DISABLE_REDIRECT=1 \
  --candidate env:FREECODE_DISABLE_REDIRECT=0 \
  --trials 5 --out /tmp/ab.json
```

Runs **both sides now, interleaved**, so nothing that drifted between two run
dates can confound the result. This is the right instrument for *"did that
prompt edit help?"* — `--save`/`--compare` diffs two finished reports and is
confounded by definition.

| Flag | Does what |
| --- | --- |
| `--baseline` / `--candidate` | variant spec: `model=<p/m>` and/or `env:NAME=value`, comma-separated. Only env vars re-read *after* the runner boots are accepted. Identical sides throw — that measures nothing but noise |
| `--trials N` | paired trials per case, default 3. Below 2, every delta is inconclusive and it says so |
| `--cases a,b,c` | subset by case id; default is the whole suite |
| `--json`, `--out <file>` | machine output / full report to disk |

**Deliberately not a gate**: no baseline, no history, always exits 0. The moment
one exits non-zero somebody wires it into CI and starts reverting on noise.
Don't wire it.

## 3. Grow the suite — `freecode eval add <session-id>`

```bash
freecode eval add abc123 --turn 2               # print the draft to stdout
freecode eval add abc123 --write --suite trajectory
```

Harvests a real recorded session into a draft case — the cheapest source of
realistic cases there is.

- Reads the **session store** (`~/.freecode/sessions/<proj>/<id>/messages.jsonl`),
  not the thread store.
- Turn scoping is **by timestamp, not `turnId`** — a `turnId` is one loop
  iteration, and a user turn spans many.
- Refuses the `coding` suite: a recorded session has no `files` fixture, so
  `verify` would have nothing to run against.
- Validates the *whole* file before writing, so a duplicate id can't land and
  surface on somebody else's next run.

## 4. Calibrate the judge — `freecode eval calibrate`

```bash
freecode eval calibrate            # judge-vs-human agreement report
freecode eval calibrate --json
```

The judged suite gates releases on a judge whose agreement with a human had
never been measured. Every judged run now appends each graded trial — prompt,
reply, the tool list the judge saw, its score — to
`evals/calibration/samples.jsonl` with `"human": null`. Labelling is editing
that field to `true`/`false`; the report maps the judge's 0–5 onto pass/fail
at every cut and prints accuracy, fail-precision/recall, and Cohen's kappa per
cut, with the gate's `JUDGE_CASE_FLOOR` row marked.

- Labels are **binary on purpose** — a human re-deriving the 0–5 scale is
  calibrating themselves to the judge, the wrong direction.
- Capture dedupes on case + response text, so re-runs never queue the same
  reply twice or clobber a label already given. It is best-effort: a capture
  failure never fails the trial.
- A `kappa` of `null` means both raters were constant — usually "everything
  passed for everyone", which says nothing about whether the judge can
  recognise a failure. Label some failing replies (a weaker model's runs are a
  cheap source).
- Under ~20 labels every figure is advisory, and the report says so.

## 5. Free, no model — runs in normal CI already

```bash
pnpm test    # apps/core/src/eval/**/*.test.ts
```

`dataset.test.ts` audits the **registry itself** (registry spec §7): every case
has a `failureCategory` and a non-empty `whyModelBacked`, `knownGap.notes` is
never the same string as `knownGap.target`, no duplicate ids, `forbidTools` is
never alone (it only *scores* a mutation — it cannot see a refusal, because a
denied call folds to `function.denied` → `Trace.deniedSpans`, never
`toolSpans`), and a mutating `agentMode` requires a `files` fixture.

This catches a broken suite without spending a cent. Run it before you ever pay
for a real suite run.

## 6. Adjacent

```bash
freecode trace [id] [--follow|--slow N|--tools|--json|--list|--otlp]  # where a turn's time went
pnpm bench:recall                                                     # memory retrieval benchmark
```

---

## Environment

```bash
FREECODE_JUDGE_PROVIDER=gemini   # REQUIRED for the judged suite and for eval:gate
FREECODE_JUDGE_MODEL=...         # must NOT be the model under test
FREECODE_EVAL_MODEL=...          # what CI pins as the model under test
```

- A judge that collides with the model under test **throws before any case runs**.
- An unconfigured judge does *not* throw — the deterministic expectations still
  run — but it **closes the gate** (`judgeSkipped`).
- A total blackout, 0 of N cases scored, also closes it. A *partial* outage
  passes on the cases that scored; only silence-from-everything blocks.
- **Judge model ids rot, and a retired one surfaces as a passing suite rather
  than an error.** The first real judged run used a retired Gemini model id and
  reported 5/5 GATE OPEN having graded nothing. `SuiteReport.judge` is now
  recorded on every run — read that line.

---

## When to run what

| Trigger | Command | Cost |
| --- | --- | --- |
| Every commit / PR — *already automated in `ci.yml`* | `pnpm test` (registry audit + scorer units) | free |
| While writing a case | `pnpm eval trajectory --trials 1` | ~1 turn/case |
| Changed a prompt, tool description, or system message | `pnpm eval ab trajectory --baseline … --candidate … --trials 5` | 2 × 5 × cases |
| Changed the loop, redirect, or recovery | `pnpm eval ab redirect --trials 5` | same |
| **Before merging a major branch / cutting a release** | `pnpm eval:gate` | full |
| Monthly hygiene | `pnpm eval trajectory --quarantine-report` | free |
| After judged runs pile up unlabelled samples | label `evals/calibration/samples.jsonl`, then `freecode eval calibrate` | free |
| New provider or model bump | `pnpm eval <suite> --model p/m --gate` — baseline is per-model, so the first run is "run zero" | full |

## What is not automated yet

1. ~~Nightly cron~~ **Done (2026-09-04):** `.github/workflows/eval.yml` runs
   `trajectory --gate` nightly at 04:00 UTC; coding/judged remain
   `workflow_dispatch`. The workflow caches `~/.freecode/eval_runs.jsonl` —
   without it a fresh runner reports "run zero" and passes unconditionally.
2. **`eval ab` has no CI wiring, by design.** Leave it that way.
3. **`--quarantine-report` is manual.** Could be a monthly scheduled job that
   opens a PR editing `evals/quarantine.txt`.
4. **`--otlp` is per-invocation.** §12's live export is deliberately unbuilt.
5. **The scripted provider (fx plan §3) is the real blocker.** Without it every
   case costs a real API call, which is why nothing runs per-push. It is also
   what unblocks trajectory-redirection §9.1's "unmeasurable" criterion and the
   four still-empty failure categories.

## How this compares to what large labs do

The shape here is already the standard one — trajectory-vs-outcome split,
LLM-as-judge with a rubric and a mandated non-self judge, majority-of-N over
pass@1, delta-vs-baseline over an absolute bar, quarantine for flakes, cost and
latency tracked next to quality. The gate semantics are stronger than fx's,
which has no gate, no baseline and no CI at all.

Where the big labs go further:

- **Tiered cadence** — deterministic tier per commit, cheap model tier nightly,
  full suite per release candidate. The nightly trajectory cron (enabled
  2026-09-04) is our middle tier; the deterministic per-commit tier is
  `ci.yml`'s `pnpm test`.
- **Replay / recorded fixtures** — cassettes or golden traces, so everything
  that isn't the model can be tested for free. This is fx §3 and it is why they
  can afford per-push evals.
- **Held-out sets** — cases nobody looks at, so the suite can't be overfit. All
  of ours are visible all the time.
- **Statistical honesty** — confidence intervals and paired bootstrap rather
  than improved/regressed/inconclusive buckets. `eval ab` already runs paired
  trials, so this is one step away.
- **Contamination hygiene** — rotating cases, checking for memorised fixtures.
- ~~Human review sampling~~ **Built (2026-09-05):** judged runs bank every
  graded trial into `evals/calibration/samples.jsonl`; `freecode eval
  calibrate` reports judge-vs-human kappa once the samples are labelled (§4).
  What remains manual is the labelling itself — the audit only exists if
  someone does it.

Where we are ahead of most: case harvesting from production sessions
(`eval add`), the required `whyModelBacked` field (the discipline most suites
lack, and the reason most rot into slow unit tests), and recording
`SuiteReport.judge` on every run.

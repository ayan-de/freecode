# agent-bench — command reference

> freecode against Claude Code, Codex and OpenCode, on SWE-bench Lite.
> Design lives in `docs/superpowers/specs/2026-09-03-agent-comparison-benchmark.md`;
> this is the "what do I type" page.

**Status: Phase 0.** No container, no grader, no metering. It answers one
question — *does every adapter produce a non-empty patch* — and every record it
writes carries `isolation: "none"` so a Phase 0 result cannot be mistaken for a
publishable one. **Nothing here produces a number worth showing anyone yet.**

This is not `pnpm eval`. That measures *our* agent against its own past
(`EVAL.md`). This measures agents against each other, and shares no code with it
on purpose — only `scorers/outcome.ts`'s idea survives the trip, because it is
the only scorer that never asks what produced the diff (spec §4).

---

## 1. One-time setup

```bash
tsx bench/agent-bench/runner/fetch.ts          # 114 django rows -> .cache/instances.jsonl
export MINIMAX_API_KEY=$(node -p "require(process.env.HOME+'/.freecode/config.json').providers.minimax.apiKey")
```

Every agent runs **MiniMax-M3 on that one key** — freecode natively, the others
through MiniMax's Anthropic-compatible endpoint. That is the "same model, one
bill" property (spec §5) and it is the only reason a cost column would mean
anything. No adapter file contains a credential; `${MINIMAX_API_KEY}` is
expanded at spawn time and an unset variable is a hard error, because an agent
that quietly fell back to its own key would be billed somewhere else.

`fetch.ts` is needed **once, ever**. datasets-server 500s and 502s while its
index warms (`"the dataset index is loading"`), and the Hub has outages of its
own; the fetch backs off five times and then stops, leaving any existing cache
untouched. A run whose instances are already cached does not touch the network
at all, so an outage is only ever a problem for instances you do not have yet.

The cache stores four fields per instance. `patch`, `test_patch` and
`hints_text` — the gold fix and the maintainer discussion that usually contains
it — are dropped before anything touches disk. Not to protect the agent under
test, which cannot see this repo: to keep an answer key out of a repository that
agents work in every day.

The django mirror (~250MB) is cloned on first use into `.cache/repos/` and
hardlinked per trial, so a run does not measure GitHub's mood.

## 2. Run

```bash
pnpm bench:agents --instances django__django-10914 --trials 1
pnpm bench:agents --agents freecode,claude-code --trials 3
```

| Flag | Default | Does what |
| --- | --- | --- |
| `--agents` | `freecode,claude-code` | comma-separated adapter ids from `agents/` |
| `--instances` | every id in `instances/django-lite.txt` | comma-separated instance ids |
| `--trials` | `1` | trials per (agent, instance). Phase 2 onward: 3, and publish the spread |
| `--timeout` | `900000` | per-trial wall-clock cap, ms |
| `--out` | `results/<timestamp>` | artifact root |

Exit code is **non-zero if any trial produced an empty patch**. In Phase 0 that
is the entire verdict: a silently empty patch is a broken adapter, and a broken
adapter that reports as a lost benchmark is the worst failure this harness has.

## 3. Artifacts

```
results/<run>/<instance>/trial-<n>/<agent>/
  prompt.txt    the exact task text — identical for every agent
  argv.json     the exact command, after {prompt}/{model} substitution
  patch.diff    git diff of the workspace, staged (so new files count)
  stdout.log    stderr.log
results/<run>/report.json
```

`results/` and `.cache/` are git-ignored. Transcripts get reviewed before they
become public.

Every run also writes **`apps/web/app/data/benchmarks/<matchup>.json`** — one
file per agent set, e.g. `freecode-vs-opencode.json` — and that is what the
`/benchmark` page reads, one tab per file. A finished run is already on the
page, with no extra step. It carries the numbers and the disclosures (version, model, autonomy,
isolation, graded) and none of the transcripts, because `results/` does not
exist on a deploy. Re-point the page at an older run without paying to re-run
it:

```bash
tsx bench/agent-bench/runner/publish.ts results/<run> [--fresh]
cd apps/web && pnpm dev        # http://localhost:3000/benchmark
```

**A matchup is the unit of comparison, which is why it is the unit of storage.**
Runs of the same agent set merge into one file, keyed by (agent, instance,
trial) with the newest run winning; a run with a different agent set writes a
different file rather than quietly widening an existing matchup with rows nobody
measured side by side. Adding a pairing therefore adds a tab — `page.tsx` reads
the directory at build time, so there is no import list to update. `--fresh`
discards a matchup's history, which is the honest move whenever the meaning of
its numbers changes: a new model, the grader landing, the container landing.

The page refuses to flatter the data: while `graded` is false it labels the
headline bar "Produced a patch", says in the footnote that everyone scores 100%
as soon as they edit anything, and shows a banner saying it is a pipeline check
rather than a result. Those come from `graded` and `isolation` in the JSON, so
they disappear on their own when Phase 1 lands — nobody has to remember.

## 4. Adding an agent

One file in `agents/`. Required: `id`, `versionCmd`, `run` (a `{prompt}` /
`{model}` template), `model`, `autonomy`.

**`autonomy` is not documentation, it is the experiment.** freecode in `build`
mode denies every headless write (`permission/prompt.ts` — the same reason
`apps/core/src/eval/runner.ts:157` has to answer permission prompts), so running
freecode in `build` against a competitor's full-auto measures permission
defaults, not agents. Every agent runs at its own maximum, the flag that got it
there is recorded, and it is printed in the results table.

Flags verified on this machine, 2026-09-03 — **the adapter is the source of
truth, this table just says where the two shipped ones came from and what the
two unshipped ones will look like:**

| Agent | Version | Full autonomy | Shipped? |
| --- | --- | --- | --- |
| freecode | local | `run "<p>" --model <p/m> --agent danger --max-turns 40` | yes |
| claude | 2.1.251 | `-p "<p>" --dangerously-skip-permissions --model <m>` | yes |
| codex | 0.151.0 | `exec --dangerously-bypass-approvals-and-sandbox --ephemeral --ignore-user-config` | Phase 3 |
| opencode | 1.18.25 | `run --pure --auto --model <p/m> "<p>"` + `XDG_CONFIG_HOME` | yes |

Codex is the only one left, and only because nothing has verified which model it
and freecode can both be pinned to (spec §12.1) — not because the invocation is
unknown. Its `--ephemeral --ignore-user-config` is worth noting: that is exactly
the "no config, no history carried between trials" property §6.3 wants, and the
other three need a container to get it. opencode needed `XDG_CONFIG_HOME` for a
weaker version of the same thing — see `empty-config/README.md`.

## 5. Known gaps — what Phase 0 does not do

1. **No isolation.** No container, so: the network is open (an agent *could*
   look the fix up), `$HOME` is mounted (freecode writes sessions and memory to
   `~/.freecode` and carries them between trials), and the agent's own config
   applies. Every record says `isolation: "none"` for this reason. Phase 1.
2. **No grading.** "Produced a patch" is not "fixed the bug". The official
   SWE-bench grader needs Docker, and on this machine the daemon is running but
   the user is not in the `docker` group. Phase 1.
3. **No metering.** Cost and token columns need the recording proxy (§6.4);
   four vendors' self-reports are four rounding policies. Phase 1.
4. **Model parity depends on one env var staying right.** Both agents are pinned
   to `MiniMax-M3`, but MiniMax's `/anthropic` shim reports a 200K context
   window instead of M3's real 1048576, so Claude Code auto-compacts at ~167K
   unless `CLAUDE_CODE_AUTO_COMPACT_WINDOW` says otherwise. The adapter sets it.
   **Delete that line and freecode wins on a handicap** — this class of bug is
   invisible in the results and only findable by reading the adapters, which is
   why they are committed and short.
5. **Scratch files land in the patch.** `extractPatch` stages everything, so an
   agent that leaves `notes.md` behind ships it in the diff. They are listed in
   `newFiles` rather than filtered — a fix accompanied by six scratch files is a
   fact about the agent worth seeing.

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
```

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
| opencode | 1.18.25 | `run --auto --model <p/m> "<p>"` | Phase 3 |

Codex and OpenCode are held back only because there is no answer yet to *which
model both they and freecode can be pinned to* (spec §12.1) — not because the
invocation is unknown. Codex's `--ephemeral --ignore-user-config` is worth
noting: it is exactly the "no config, no history carried between trials"
property §6.3 wants, and the other three need a container to get it.

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
4. **The model is not shared and not pinned.** freecode points at whatever
   `~/.freecode/config.json` is authed for; `claude-code` uses the `sonnet`
   alias, which tracks the latest Sonnet and will move under you. **Until §12.1
   is answered, this harness compares two agents running two different models,
   which is not a comparison of harnesses.** Phase 2 blocker.
5. **Scratch files land in the patch.** `extractPatch` stages everything, so an
   agent that leaves `notes.md` behind ships it in the diff. They are listed in
   `newFiles` rather than filtered — a fix accompanied by six scratch files is a
   fact about the agent worth seeing.

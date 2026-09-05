# Agent-bench — command reference

> Operator's guide to the **agent comparison** harness: what each command does,
> which flag to reach for, and when to run it. Design lives in
> `docs/superpowers/specs/2026-09-03-agent-comparison-benchmark.md`; this is
> the "what do I type" page.
>
> Inspired by [Superbrain's public benchmark](https://www.onesuperbrain.com/benchmarks):
> same tasks, same model, same key, one meter, official grader, published
> artifacts. We are not there yet — see §8.

This is **not** `pnpm eval`. That measures *our* agent against its own past
(`EVAL.md`). This measures agents against each other, on tasks we did not
write, and shares no code with `apps/core/src/eval` on purpose — only
`scorers/outcome.ts`'s idea survives the trip, because it is the only scorer
that never asks what produced the diff.

This is **not** `pnpm bench:memory`. That measures PSS and time-to-first-frame
(`Benchmark.md`). A fast TUI that fixes no bugs is a different claim.

| Question | Command | Doc |
| --- | --- | --- |
| Did my last change make *our* agent worse? | `pnpm eval` | `EVAL.md` |
| How much RAM, how fast to first frame? | `pnpm bench:memory` | `Benchmark.md` |
| **Does it fix real bugs vs Claude Code / OpenCode, and for how much?** | **`pnpm bench:agents`** | **this file** |

**Status (2026-09-06).** The full pipeline exists: metering (on by default),
container isolation (`--isolate`), the official SWE-bench grader
(`pnpm bench:grade`), §7.2 cost columns on `/benchmark`, and the evidence
bundle (`pnpm bench:bundle`). **A publishable number is a run with all of
them**: `--isolate --trials 3`, then grade, then bundle. A run missing any
step is labelled provisional by the page and should stay that way. Grader and
isolation need Docker (daemon up, operator in the docker group) and the
grader needs `pip install swebench` — neither has had a paid smoke run yet;
`pnpm test:agent-bench` covers everything that is free. There is still no
gate, no CI wiring, no exit-on-regression — same reasoning as `eval ab`.

Code lives in `bench/agent-bench/`, sibling to `bench/jcode-bench/`, outside
the pnpm workspace on purpose.

---

## 1. One-time setup

```bash
pnpm exec tsx bench/agent-bench/runner/fetch.ts
export MINIMAX_API_KEY=$(node -p "require(process.env.HOME+'/.freecode/config.json').providers.minimax.apiKey")
```

Every shipped adapter runs **MiniMax-M3 on that one key** — freecode natively,
the others through MiniMax's Anthropic-compatible endpoint. That is the "same
model, one bill" property (spec §5) and it is the only reason a cost column
would mean anything. No adapter file contains a credential; `${MINIMAX_API_KEY}`
is expanded at spawn time and an **unset variable is a hard error**, because an
agent that quietly fell back to its own key would be billed somewhere else.

`fetch.ts` is needed **once, ever**. It pulls the django subset of SWE-bench
Lite into `bench/agent-bench/.cache/instances.jsonl` (114 rows). datasets-server
500s while its index warms; the fetch backs off five times and then stops,
leaving any existing cache untouched. A run whose instances are already cached
does not touch the Hub at all.

The cache stores four fields per instance. `patch`, `test_patch` and
`hints_text` — the gold fix and the maintainer discussion that usually contains
it — are **dropped before anything touches disk**. Not to protect the agent
under test (it cannot see this repo): to keep an answer key out of a repository
agents work in every day.

The django mirror (~250 MB) is cloned on first use into
`bench/agent-bench/.cache/repos/` and hardlinked per trial, so a run does not
measure GitHub's mood.

`.cache/` and `results/` are git-ignored.

---

## 2. Run a comparison — `pnpm bench:agents`

```bash
# Smoke: one instance, one trial, default agents (freecode, claude-code)
pnpm bench:agents --instances django__django-10914 --trials 1

# The shape Phase 2 wants: N=3, publish the spread
pnpm bench:agents --agents freecode,claude-code --trials 3

# Skip the recording proxy (adapter debugging only)
pnpm bench:agents --no-meter --instances django__django-10914
```

Every invocation is a **real paid agent turn × agents × instances × trials**.
Read this file before you spend.

| Flag | Default | Does what |
| --- | --- | --- |
| `--agents` | `freecode,claude-code` | comma-separated adapter ids from `bench/agent-bench/agents/` |
| `--instances` | every id in `instances/django-lite.txt` (10 django bugs) | comma-separated SWE-bench instance ids |
| `--trials` | `1` | trials per (agent, instance). Phase 2 onward: **3**, and publish the spread. Never merge into best-of |
| `--timeout` | `900000` (15 min) | per-trial wall-clock cap, ms. Timeout SIGKILLs the agent |
| `--out` | `bench/agent-bench/results/<timestamp>` | artifact root |
| `--fresh` | off | passed through to publish: discard the matchup JSON and start over |
| `--no-meter` | off | skip the recording proxy |
| `--isolate` | off | one container per trial on an `--internal` docker network (§6.3); implies metering. Needs the image: `pnpm bench:image` (online, once) |

**Exit code** is non-zero if **any trial produced an empty patch**. In Phase 0
that is the entire verdict: a silently empty patch is a broken adapter, and a
broken adapter that reports as a lost benchmark is the worst failure this
harness has. There is **no** gate against a baseline and **no** CI job. Do not
wire one.

The matrix is `instances × trials × agents`, nested in that order. One dead
trial does not abort the rest.

### Task set

`instances/django-lite.txt` is the **first ten django instance ids in lexical
order**. Chosen mechanically, and said out loud so nobody has to take it on
faith that they were not cherry-picked. Ten instances from one repo is a
**demo, not a leaderboard** (spec §10.1). SWE-bench Lite is 300 across 11
repos.

The prompt is one string, identical for every agent (`runner/prompt.ts`). If it
ever differs per agent, the benchmark stops comparing harnesses and starts
comparing prompts we wrote for them.

---

## 3. Metering — one meter, not four self-reports

On by default. Each trial starts a **pass-through HTTP proxy**
(`bench/agent-bench/proxy/`) and points the agent at it:

| Agent | Env the runner injects | Upstream |
| --- | --- | --- |
| Claude Code | `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` | adapter's `ANTHROPIC_BASE_URL` (MiniMax `/anthropic`) |
| freecode | `MINIMAX_BASE_URL=http://127.0.0.1:<port>/v1` | same MiniMax origin; `baseURLFor()` in `catalogue.ts` honours `$<ID>_BASE_URL` |
| OpenCode | those two vars, which it **does not honour** | unmetered without `--isolate`; in a container the internal network leaves it no other route |

The proxy: no cache, no retries, no body rewrite. Tokens are parsed off
Anthropic Messages JSON/SSE and OpenAI Chat Completions. Anthropic
`message_delta` only carries `output_tokens`; input and cache reads stay from
`message_start`. Secrets are not written to the log (no headers, no bodies).

**Conventions differ between the two wire shapes and the meter normalizes
them**: OpenAI's `prompt_tokens` already includes `cached_tokens`, but
Anthropic's `input_tokens` EXCLUDES `cache_read/creation_input_tokens` —
they are separate additive fields. `usage.ts` folds both into one inclusive
`inputTokens`, which is what makes `price.ts`'s cache discount arithmetic
correct for either shape. If a shim turns out to report inclusive
`input_tokens` (verify on the first metered run: fresh input should be
`input_tokens`, small, beside large cache fields), cost is overstated by the
cache amount, never silently understated.

**USD** uses a committed rate card in `proxy/price.ts`, vintage
`2026-09 MiniMax standard ≤512k`:

| Model | Input / M | Output / M | Cache read / M |
| --- | ---: | ---: | ---: |
| MiniMax-M3 | $0.30 | $1.20 | $0.06 |

Cache reads are a **discount off the inclusive input count**, matching
`providers/pricing.ts`. Adding them on top would report a cache win as a cost
increase. An unknown model prices as **`undefined` / `null`, never as zero**.

A request whose path is not `/messages` or `/chat/completions` is a **leak**.
An **empty** proxy log is unmetered (`auditOk: false`), not a cheap clean run —
that is how an agent that talked *around* the proxy is supposed to look.

Without a container, the proxy only sees traffic **pointed at it**. A clean
audit is not proof that nothing else left the machine. `isolation` stays
`"none"` until Docker lands.

Pinning a **different shared model** is a different experiment, which is fine
if every adapter's `"model"` and the proxy upstream still match. Tokens will
record for any Anthropic- or OpenAI-shaped endpoint; USD stays null until you
add a row to `proxy/price.ts`. Do not mix bills (Gemini on one side, MiniMax on
the other) and call it a cost comparison.

### Isolation — `--isolate`

One container per trial (`bench/agent-bench/isolate/`), on a docker network
created with `--internal`: docker programs no route out, so the only exit is
the recording proxy, which binds the network's gateway IP on the host. The
proxy log stops being an honor system and becomes the egress audit. Known
residue, stated rather than hidden: other host services on the gateway IP
remain reachable from the container; the internet does not.

```bash
pnpm bench:image                                   # build agent-bench (online, once)
pnpm bench:agents --isolate --trials 3 --agents freecode,claude-code
```

The image (`isolate/Dockerfile`) bakes pinned versions of every agent —
freecode from a **released** binary (build arg `FREECODE_VERSION`, default
v0.30.1), the others from npm — because at trial time there is no network to
install anything with. `agentVersion` is read from the image, `$HOME` is a
tmpfs-style throwaway inside the container (no memory between trials, §6.3),
the workspace mounts rw at `/workspace`, the bench dir ro at `/bench`
(`{benchDir}` resolves there), and env values ride bare `-e NAME` flags so
`argv.json` never contains a secret. A timed-out trial gets `docker rm -f`,
not just a dead client.

---

## 3b. Grading — `pnpm bench:grade`

```bash
pip install swebench          # once; or SWEBENCH_PYTHON=/path/to/venv/python3
pnpm bench:grade bench/agent-bench/results/<run> [--max-workers N] [--publish]
```

The verdict is the **official SWE-bench harness's, in Docker, on
`patch.diff`** — `runner/grade.ts` only shuttles patches in and verdicts out.
One harness invocation per (agent, trial), because the harness keys on
`instance_id` and two trials of one instance must not share a predictions
file. An empty patch is `resolved: false` without spending a container; a
harness error leaves `null`, which the page counts as not-resolved rather
than quietly dropping. Verdicts land in `report.json` (`resolved` per trial,
`graded: true`) and `--publish` re-publishes the matchup — at which point the
page's headline flips from "Produced a patch" to "Resolved" and the §7.2
cost-on-intersection line appears. Grading is free to re-run: it never
touches a model.

## 3c. Evidence bundle — `pnpm bench:bundle`

```bash
pnpm bench:bundle bench/agent-bench/results/<run>
```

Writes `<run>-evidence.tar.gz` + `.sha256` next to the run dir: report,
prompts, argv, patches, agent stdout/stderr, proxy logs, usage and audit
folds, grading output. The tar is byte-reproducible (sorted, owner/mtime
pinned), so the published checksum is a claim anyone can re-derive. Publish
the tarball wherever the numbers go; the proxy log carries no headers or
bodies, so nothing in it needs redacting.

---

## 4. Artifacts and `/benchmark`

### Per-trial dump (git-ignored)

```
bench/agent-bench/results/<run>/<instance>/trial-<n>/<agent>/
  prompt.txt     the exact task text — identical for every agent
  argv.json      the exact command, after {prompt}/{model} substitution
  patch.diff     git diff of the workspace, staged (so new files count)
  stdout.log     stderr.log
  proxy.jsonl    every request the proxy saw (paths, usage; no secrets)
  usage.json     folded tokens / USD / turns for this trial
  audit.json     isolation audit: non-model paths are leaks
bench/agent-bench/results/<run>/report.json
```

A new timestamped folder every run. That **is** the historical archive. Old
patches and proxy logs sit there until you delete them.

Scratch files the agent left behind (`notes.md`, …) stay in `patch.diff` and
are listed in `newFiles` rather than filtered — a fix accompanied by six
scratch files is a fact about the agent.

### What the page reads (committed)

At the end of every run, `runner/publish.ts` writes a slim JSON into:

```
apps/web/app/data/benchmarks/<matchup>.json
```

Examples: `freecode-vs-claude-code.json`, `freecode-vs-opencode.json`. One file
per **agent set**. The page (`apps/web/app/benchmark/page.tsx`) scans that
directory at **build time** — a new pairing appears by existing; there is no
import list. Production visitors never hit the filesystem. Locally,
`cd apps/web && pnpm dev` → `http://localhost:3000/benchmark` usually re-reads
on refresh.

Dropped from the page JSON: transcripts, patches, argv, prompts. Kept:
numbers, version, pinned model, autonomy flag, isolation, graded, resolved
verdicts, and (when metered) turns / tokens / usd / auditOk. The page renders
token and cost bars for any metered matchup, marks unmetered agents as
"unmetered" rather than $0, and shows the §7.2 cost-on-solved-intersection
line only once graded — suppressed below 3 shared resolved instances.

Re-point the page at an older run without paying to re-run it:

```bash
pnpm exec tsx bench/agent-bench/runner/publish.ts bench/agent-bench/results/<run> [--fresh]
```

### History: latest cell, list of runs

The page is **latest row wins**, not a time series. Each cell is keyed by
`(agent, instance, trial)`. Re-running the same matchup overwrites that cell.

The file also keeps a **`runs` list** (newest first). If there is more than
one, the page says the table was **stitched** and that you should not treat the
decimals as a head-to-head — the same agent on the same bug has varied
several-fold between runs.

`--fresh` discards the matchup file. Use it when the **meaning** of a number
changes: a new model, the grader landing, the container landing.

A run that adds an agent writes a **different file**. Do not stitch
freecode-vs-opencode rows next to freecode-vs-claude-code rows measured an hour
apart and call it a three-way.

While `graded` is false the page labels the headline **"Produced a patch"**,
says everyone scores 100% as soon as they edit anything, and shows a banner
that this is a pipeline check. Those flags come from the JSON, so they flip
on their own when Phase 1 lands.

---

## 5. Adding an agent

One JSON file in `bench/agent-bench/agents/`. Required: `id`, `versionCmd`,
`run` (a `{prompt}` / `{model}` template), `model`, `autonomy`. Optional:
`env`, `notes`.

**`autonomy` is the experiment, not documentation.** freecode in `build` mode
denies every headless write (`permission/prompt.ts` — the same reason the eval
runner has to answer permission prompts). Running freecode in `build` against a
competitor's full-auto measures permission defaults, not agents. Every agent
runs at its **own maximum**; the flag that got it there is recorded and printed.

`${VAR}` in `env` is substituted from the process environment and is a hard
error when unset. `""` means *unset this variable* (how a pre-existing
`ANTHROPIC_API_KEY` is kept from redirecting Claude Code to Anthropic).
`{benchDir}` is `bench/agent-bench/`.

Flags verified 2026-09-03 — **the adapter file is the source of truth:**

| Agent | Version | Full autonomy | Shipped? |
| --- | --- | --- | --- |
| freecode | local | `run "<p>" --model <p/m> --agent danger --max-turns 40` | yes |
| claude | 2.1.251 | `-p "<p>" --dangerously-skip-permissions --model <m>` | yes |
| opencode | 1.18.25 | `run --pure --auto --model <p/m> "<p>"` + `XDG_CONFIG_HOME` | yes |
| codex | 0.151.0 | `exec --dangerously-bypass-approvals-and-sandbox --ephemeral --ignore-user-config` | Phase 3 |

OpenCode's `XDG_CONFIG_HOME` points at `empty-config/` (deliberately empty).
Without it, opencode loads `~/.config/opencode/opencode.json` and every MCP
server in it. Measured: 19 tools with the operator's config, 10 without.
Neither `--pure` nor `OPENCODE_CONFIG` suppresses MCP.

Claude Code's `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1048576` is a **fairness
correction**, not a tuning knob: MiniMax's `/anthropic` shim reports a 200K
window for M3 instead of 1M, so Claude would auto-compact at ~167K while
freecode reads models.dev's true 1048576. **Delete that line and freecode wins
on a handicap.**

---

## 6. Free, no model — unit tests

```bash
pnpm test:agent-bench
```

Typechecks the whole bench tree (`tsconfig.json` — tsx executes without
checking, which once let a field vanish from `TrialRecord` unnoticed), then
runs every `*.test.ts`: proxy parse/merge (both wire conventions), rate card,
pass-through (no retry on 500), leak audit, env overlays, docker argv
construction (secrets never in argv), grader prediction/verdict folding, and
bundle reproducibility. Catches a broken meter without spending a cent. Run
it before you ever pay for a matrix.

`apps/core` also covers `MINIMAX_BASE_URL` in `catalogue.test.ts`.

---

## 7. When to run what

| Trigger | Command | Cost |
| --- | --- | --- |
| Changed the proxy, rate card, runner, grader, or isolation | `pnpm test:agent-bench` (typechecks, then tests) | free |
| Is this adapter still producing a patch? | `pnpm bench:agents --instances django__django-10914 --trials 1` | 1 turn × agents |
| Isolation smoke (first `--isolate` ever) | `pnpm bench:image`, then `--isolate --instances django__django-10914 --trials 1` | 1 turn × agents |
| **The publishable shape** | `--isolate --trials 3`, then `bench:grade --publish`, then `bench:bundle` | 3 × instances × agents paid turns + grader containers |
| Grade or re-grade a finished run | `pnpm bench:grade results/<run> --publish` | free (no model) |
| Re-show an old run on `/benchmark` | `tsx bench/agent-bench/runner/publish.ts results/<run>` | free |
| Meaning of a number changed | same, with `--fresh` | free |

**Never in normal CI.** This spends real money in (eventually) Docker and is a
release-cadence or on-demand job. The moment it exits non-zero somebody wires
it in and starts reverting on a competitor's noise.

---

## 8. Parity with the prior art, and what still separates a run from a result

| Superbrain shows | Here |
| --- | --- |
| Pass/fail grid from the official Docker grader | Built — `pnpm bench:grade`; page flips to "Resolved" on `graded: true` |
| Token comparison ("64% fewer tokens") | Built — meter + `/benchmark` token/cost bars, one rate card |
| Per-bug cost on the **intersection** of solved instances (§7.2) | Built — appears once graded; suppressed when `\|I\| < 3` |
| Network isolation + audited transcripts | Built — `--isolate` (internal network) + per-trial proxy audit |
| Downloadable evidence bundle | Built — `pnpm bench:bundle`, reproducible tar + sha256 |

What still separates any given run from a publishable result is **running the
whole ritual**: every layer above exists, but a number is publishable only
when its run used `--isolate`, was graded, kept `auditOk`, and shipped its
bundle — and the isolation/grader layers have not yet had their first live
smoke (they need Docker group membership and `pip install swebench` on the
operator's machine). Until that first smoke run passes, treat them as
untested code, not as a proven pipeline. Codex remains Phase 3 (adapter
listed, never run).

When more than two agents are in the table, intersection is **pairwise against
freecode**, and the table says so. A four-way intersection shrinks to nothing.

---

## 9. Layout

```
bench/agent-bench/
  README.md                 # points here
  tsconfig.json             # test:agent-bench typechecks before it tests
  agents/*.json             # one adapter per agent
  instances/django-lite.txt # the ten ids
  runner/                   # trial loop, fetch, publish, workspace, grade, bundle
  proxy/                    # recording meter (spec §6.4)
  isolate/                  # Dockerfile + container/network plumbing (§6.3)
  empty-config/             # opencode: no MCP, no personal config
  results/<date>/           # git-ignored
  .cache/                   # git-ignored

apps/web/app/benchmark/page.tsx
apps/web/app/data/benchmarks/<matchup>.json
```

---

## Environment

```bash
MINIMAX_API_KEY=...          # required for every shipped adapter
MINIMAX_BASE_URL=...         # injected by the runner; do not set by hand unless debugging
ANTHROPIC_BASE_URL=...       # same; Claude Code. An operator export of ANTHROPIC_API_KEY
                             # is cleared by the claude adapter so the run cannot silently
                             # bill Anthropic
```

---

## Adjacent

```bash
pnpm eval / EVAL.md          # our agent vs its own past — different instrument
pnpm bench:memory            # RAM / TTF — Benchmark.md
pnpm test:agent-bench        # this harness, no API
freecode trace               # where a *freecode* session's time went — TRACE.md
```

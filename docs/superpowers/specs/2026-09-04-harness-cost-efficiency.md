# Harness Cost Efficiency

> **Date:** 2026-09-04
> **Status:** Proposed — D1, D2 (flag-off), D3 (flag-off), D6 and D4's
> regression guard all built 2026-09-04. Both experiment defaults await
> their A/B. Only D4's compression itself remains unbuilt.
> **Source:** GitHub's Copilot harness work — "How we make AI coding more
> cost-efficient without sacrificing task quality" (github.blog, 2025).
> **Builds on:** `2026-08-05-token-efficiency.md` (built — its header still says
> Proposed) and the eval harness (`2026-08-23-eval-harness.md`,
> `2026-08-29-eval-case-registry.md` §6).

## Problem

The 2026-08-05 spec fixed the *history-shaped* costs: cache-prefix stability,
compaction target, parallel tool calls, file-read state. What it did not touch
is the *per-call payload* — what each tool result and each recurring prompt
block costs every time it is sent, then re-sent with every subsequent request
for the life of the session.

Copilot's team shipped four harness changes on exactly this layer and published
the measured deltas, each validated end-to-end (offline benchmark, then online
A/B on real traffic):

| Technique                                     | Their measured saving |
| --------------------------------------------- | --------------------- |
| Content-aware shell output compression        | 5.5%                  |
| Removing line-number prefixes from file reads | 3.1% (5% offline)     |
| Compressing recurring tool guidance ~50%      | 2.9% (~1,300 tok/turn)|
| Batching background completions inline        | 2.3%                  |

Their governing principle, which this spec adopts verbatim: **optimize for the
outcome, not the tool call.** Every aggressive per-call trim they tried first
*raised* end-to-end cost by forcing the agent into recovery turns (re-running
commands, re-opening files). The savings above are what survived that test.
Nothing in this spec ships on the offline number alone.

## Where FreeCode stands today

Audited 2026-09-04, per technique:

**T1 — Shell output.** `truncateOutput` (`tools/bash.ts:59`) is a blunt
tail-keep at 500KB: a `git diff`, a grep result, and an `npm install` log are
all cut the same way. The orchestrator then stores the output and caps the
model view head+tail with a pageable handle (`orchestrator.ts:275`,
`adaptiveTruncate`) — the recovery path exists. But it is uniform, not
content-aware, and bash's own cap runs **before** the store put, so for a
>500KB output the store holds already-truncated text and the head is
unrecoverable ("re-run the tool" is then the only recovery, the exact detour
Copilot measured as a net loss).

**T2 — Line-number prefixes.** `tools/read.ts:321` prefixes every line with
`${i + offset}: `. FreeCode's `edit` is string-match, not line-addressed;
line numbers for navigation come from `grep -n` and LSP output. The prefix is
plausibly as unused here as it was in Copilot's harness — but their 3.1% is
their workload's number, not ours ("evidence is local to the workload").

**T3 — Recurring guidance.** ~138 `description` fields across `tools/*.ts`
plus `session/prompt/system.md` ride every request. Never audited for
compression. The one known landmine: the parallel-call instruction that
2026-08-05 D2 added to `system.md` is load-bearing — Copilot's own prompt
compression silently serialized their parallel agents, caught only by
behavioral testing.

**T4 — Retrieval detours.** Not applicable yet, by construction: FreeCode has
no background bash and no async subagents. `planToolBatches` executes a
parallel batch and returns every result in the same model call — there is no
"check status" turn to eliminate. This becomes a live constraint the day
`autonomous/` grows detached execution.

**Measurement.** Mostly already built, which is what makes this spec cheap to
verify: per-trial `costUsd` from `providers/pricing.ts` (unpriced =
`undefined`, never 0), `TrialEfficiency` (tokens, cache read/write, model/tool
ms) folded from the trace, `scorers/efficiency.ts` warn-at-15%-never-gate, and
paired interleaved A/B (`eval/ab.ts`) that exists precisely because
`compare.ts` across run dates confounds drift into the delta. The gap:
`VARIABLE_ENV_KEYS` (`ab.ts`) allowlists only the four memory/redirect
toggles, so no harness-formatting experiment is currently expressible.

## Design

Ordered by expected value over risk. Each item is an *experiment with a
shipping criterion*, not an unconditional change: run `eval ab` on the coding
suite, flip the default only if cost drops with pass rate and `repeatedCalls`
held (the `compare.ts` criterion — a tie is fine, a regression is not).

### D1 — Fix the store-before-cap ordering (T1 prerequisite) — **BUILT 2026-09-04**

The full output must reach the `OutputStore` before any lossy cap. Move the
bash-level `truncateOutput` behind the orchestrator's `put`, or have `bash`
return full output and let the orchestrator own all capping. Small, pure
correctness: the recovery path 2026-08-05 D3 built stops lying for large
outputs. Not an experiment — no flag, no A/B.

As built: bash's `truncateOutput` (500KB tail-keep before the store put) is
deleted — `bash` returns full output, and the orchestrator owns every cap.
Order at the single cap site (`orchestrator.ts`, execute): store `put` of the
full text → `adaptiveTruncate` for the model view (unchanged, 30K chars) →
`MAX_DISPLAY_CHARS` (500KB) tail-keep on the UI copy only
(`displayOutput`/`stdout`), which now applies to every tool rather than bash
alone. Regression test: "full output reaches the store; model and display
copies are capped" in `orchestrator.test.ts` (600KB output fully retrievable
via the store, both outbound copies capped, display keeps the tail).

### D2 — Content-aware shell output compression (T1)

Replace the uniform tail-keep with a three-way classification, applied only
past the existing size threshold and always alongside the store handle:

- **Source-like** (`cat`, `git diff`, `git show`, `sed -n`): never compressed
  beyond the store cap. The model asked for bytes; give it bytes.
- **Search-like** (`grep`, `rg`, `find`, `ls -R`): every match line survives.
  Compression may deduplicate and collapse, never drop a match.
- **Repetitive logs** (install/build/test output): collapse progress spinners
  and repeated lines; keep head, tail, and every line matching failure
  patterns (`error`, `FAIL`, `warning`, non-zero exit context).

Classify on the command string in `bash.ts` — the tool knows what was run;
the orchestrator does not. Anything unclassified keeps today's behavior:
Copilot's finding was that conservative-with-recovery beats aggressive, and
the failure mode (agent re-runs the command) is exactly what
`MetricSummary.repeatedCalls` already counts, so the A/B detects it for free.

Flag: `FREECODE_BASH_COMPRESS=0` disables (read per call).

**Built 2026-09-04, flag-off** — and the flag line above is corrected by the
build: `FREECODE_BASH_COMPRESS=1` *enables*, default off, because this
section's own preamble says a default is earned by the A/B, not asserted.
An earlier draft had it default-on; that contradicted the shipping criterion.
As built: `classifyCommand` runs in `bash.ts` (the tool knows the command)
and travels as `metadata.outputKind`; `maybeCompressOutput`
(`tools/output-compress.ts`) runs at the orchestrator's cap site after the
store put — D1's rule — where the toolCallId is known, so every elision
marker names the retrieval handle. A pipeline is classified by its LAST
segment (`npm test | grep FAIL` emits search results); quotes plus a pipe
is left unclassified. Search compression is dedupe-only and provably drops
no distinct line; log compression keeps head, tail and every
`FAILURE_RE` line. The A/B to earn the default:
`freecode eval ab coding --candidate env:FREECODE_BASH_COMPRESS=1`.

### D3 — Line-number prefix experiment (T2)

Drop the per-line `N: ` prefix from `read` output behind
`FREECODE_READ_LINE_NUMBERS` (default keeps today's behavior until the A/B
says otherwise). The range header/footer ("Showing lines X–Y … offset=N")
stays — offset-based paging is how `read`'s own description teaches re-reads,
and it does not require per-line prefixes to work.

Known risks the A/B must answer, not argument: (a) the model cites
`file:line` in user-facing answers from read output; (b) `edit` disambiguation
on repeated strings may lean on visible numbering. If pass rate or judged
scores move, the prefix earns its 3%.

**Built 2026-09-04, flag-default = today's behavior**: the prefix stays
unless `FREECODE_READ_LINE_NUMBERS=0`, read per call in read's `execute` and
allowlisted in `VARIABLE_ENV_KEYS`. The deciding runs, both directions of
risk (a)/(b):
`freecode eval ab coding --candidate env:FREECODE_READ_LINE_NUMBERS=0` and
the same on `judged` (citation quality is a judged property).

### D4 — Guidance compression under a behavioral gate (T3)

Meta-prompt the tool descriptions and `system.md` down, section by section,
with two hard guards before any variant ships:

1. A **trajectory case asserting parallel batching**: a prompt whose correct
   trajectory is ≥2 concurrency-safe calls in one assistant message. This
   encodes Copilot's serialization regression as a permanent regression test —
   it guards every future prompt edit, not just this one, and it is the eval
   case this suite should have had since 2026-08-05 D2 anyway.

   **Built 2026-09-04**: `expectParallelTools` (`eval/types.ts`, scored in
   `scorers/trajectory.ts` off `ModelSpan.toolCalls` — what the response
   *emitted*, not what ran, so a denied batch still counts as batching;
   `dataset.ts` rejects values < 2 as asserting nothing) + case
   `parallel-batch-two-reads` in `evals/trajectory.jsonl`. Not yet run against
   a live model — per Testing D4 it must be seen passing on the current prompt
   before any compression lands.
2. The full `eval:gate` ritual on the compressed variant.

Measure the recurring block first (tokens of tools JSON + system prompt as
sent, off one recorded request in the rollout log) so the saving is a number
before the work starts. Copilot's ~50% / ~1,300 tokens per turn is the
precedent, not the promise.

**Measured 2026-09-04**: `system.md` 8,862 chars (~2.2K tokens); tool
descriptions + parameter schemas 18,852 chars (~4.7K tokens) across 16
tools, led by `grep` (2,454), `bash` (2,427), `memory` (1,944),
`todowrite` (1,557), `agent` (1,423). The recurring block is ~27.7K chars
≈ 6.9K tokens on every request; Copilot's ~50% would be ~3.4K tokens/turn
here. A first-turn `model.request` recorded 74,824 promptChars total —
compiled context (file tree, project instructions) dominates beyond the
block, but that is user content and out of this spec's scope.

### D5 — Background-completion invariant (T4)

Nothing to build. Recorded as a constraint on `autonomous/` Phase 1+ and any
future async subagent: **a background completion is delivered as an ordinary
tool-result in the next already-happening model call, never via a dedicated
retrieval turn.** Four calls to process two results is the anti-pattern;
the batching layer already proves the right shape.

### D6 — Extend the A/B allowlist (measurement)

Add `FREECODE_BASH_COMPRESS` and `FREECODE_READ_LINE_NUMBERS` to
`VARIABLE_ENV_KEYS` — after verifying each read site fires per call, per the
allowlist's own rule (a startup-read var makes both sides identical and the
report confidently describes an experiment that never ran).

## Out of scope

- A per-model tokenizer (unchanged verdict from 2026-08-05 D6).
- Model-driven summarization of tool output — spending tokens to save tokens
  inverts on short sessions; the classifier is regex/heuristic only.
- Retuning `adaptiveTruncate`'s head/tail budgets globally — D2 subsumes the
  cases where it matters.
- Anything gate-shaped on the efficiency numbers. `scorers/efficiency.ts`'s
  warn-only rationale stands: cost moves when the suite changes as readily as
  when the agent changes. A/B is the instrument here, not the gate.

## Testing

- **D1** — a 600KB output is fully retrievable via the `output` tool; the
  model view is capped as today.
- **D2** — unit: the classifier on representative outputs; property: every
  grep match line in the input appears in the compressed output; A/B on the
  coding suite with `repeatedCalls` and pass rate as the detour detectors.
- **D3** — A/B both directions; judged suite included, since citation quality
  is a judged property, not a trajectory one.
- **D4** — the new parallel-batching trajectory case passes on the current
  prompt *before* any compression lands (else it tests nothing); `eval:gate`
  green on the compressed variant.
- **D6** — a variant setting an allowlisted-but-startup-read key is the
  failure `ab.ts` documents; each new key gets its read-site note in the
  allowlist comment.

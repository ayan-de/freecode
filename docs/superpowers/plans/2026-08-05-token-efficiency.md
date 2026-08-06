# Plan: Token Efficiency

> **Date:** 2026-08-05
> **Spec:** `docs/superpowers/specs/2026-08-05-token-efficiency.md`
> **Status:** Proposed
> **Scope (locked):** Cut input tokens per unit of work ~40× via compaction
> threshold, prompt-cache prefix stability, request-count reduction, and file-read
> state. No new dependencies. No tokenizer. No eval harness.

Phases are ordered by tokens-saved-per-line-changed and are independently
shippable — each leaves the loop working. Files target ~150 lines (project rule).
Verify criteria before advancing.

Baseline for every "verify" below is the replay of a recorded session, so the
measurement script lands first.

---

## Phase 0 — Measurement harness (no behaviour change)

Without this every later phase is a guess. It is a script, not a subsystem.

1. `scripts/analyze-session.mjs` — reads a session dir under
   `~/.freecode/sessions/<project>/<id>/messages.jsonl` and reports:
   - user message count, assistant message count, timestamp-clustered request count
   - tool calls per assistant message (histogram — this is the RC2 signal)
   - final history tokens, peak request tokens
   - Σ input tokens across requests (the headline number)
   - Σ tool-result chars, and the count over `MAX_MODEL_OUTPUT_CHARS`
2. Accept `--compare <idA> <idB>` so a before/after pair prints side by side.
3. Also report image-part count — RC6 says the estimator is wrong for those, so the
   number needs to be visible when reading any later measurement.

**Verify:** run against `4ba54e41` and reproduce the spec's table — 7 user msgs, 229
clustered requests, `{0: 147, 1: 216}` tool-call histogram, 270K final history,
48.1M Σ input.

If the script and the spec disagree, find out which is wrong before continuing —
do not assume it is the script. It was the spec on the first run: the spec's original
figures came from a Python replay whose `json.dumps` defaults escape non-ASCII as
`\uXXXX` and pad separators, inflating every char count by 1.0%. The provider
receives literal UTF-8, so `JSON.stringify` is the correct model and the spec's
table was corrected to match the script (272K → 270K, 48.5M → 48.1M; `65f171fa` and
`08e19c43` moved more because their original figures omitted the system+tools block
entirely).

**Status: done (2026-08-05).** Output reproduces the corrected table.

---

## Phase 1 — Compaction threshold (D1)

Largest single win, smallest diff. Ship alone.

1. `compaction/tokens.ts` — add
   `DEFAULT_COMPACT_TARGET_TOKENS = 120_000` plus `getCompactTarget()`, which reads
   `FREECODE_COMPACT_TARGET_TOKENS` **per call** and warns on an unusable value.
2. `compaction/tokens.ts` `shouldCompact()` — cap the resolved window with
   `Math.min(windowLimit, getCompactTarget())` before subtracting the buffer.
3. `agent/loop.ts` — update the `resolveContextLimit` comment; it said compaction
   fires "against the actual limit (200K/1M)", which stops being true here.

**Verify:** unit test — `shouldCompact(270_000, "MiniMax-M3", buffer, 968_000)` is
`true` (was `false`); `FREECODE_COMPACT_TARGET_TOKENS=500000` restores the old M3
behaviour; an unusable value falls back to the default;
`FREECODE_AUTO_COMPACT_TOKENS` still takes precedence. Then run a real session and
confirm `compaction_start` is emitted.

**Deviations from the plan as originally written, and why:**

- **The cap lives in `shouldCompact`, not `resolveContextLimit`.** `shouldCompact` is
  the single chokepoint (`getAutoCompactThreshold` is test-only), so capping there
  also covers the offline fallback path and is unit-testable without constructing a
  loop. Nothing is applied in `resolveContextLimit` beyond a comment fix.
- **`getCompactTarget()` reads the env per call** rather than `envInt` at module load.
  That matches `getAutoCompactOverride()` directly above it in the same file, and a
  module-load read cannot be overridden by a test or by a long-lived daemon.
- **"MiniMax-M2 behaviour unchanged" was wrong.** M2's usable window is ~164K, so the
  120K target binds there too — as it does on every model whose usable window exceeds
  120K, including Anthropic's 200K. That is the intent (the cost of a 120K request
  does not depend on how large the window is), but the plan and the spec both
  described it as a large-window-only change. The spec's D1 wording was corrected.

**Status: done (2026-08-05).** 12 tests in `tokens.test.ts`, 420 across core, all
green. The pre-existing `shouldCompact prefers an explicit context limit` test
asserted a 200K window → 187K threshold; it encoded the old fit-only rule and was
rewritten to use a 100K window (below the target, so the window still binds).

---

## Phase 2 — Prompt (D2)

Zero code. Do it before the pruning work so Phase 4's measurements are taken against
the reduced request count.

1. `session/prompt/system.md` — add parallelism as its own imperative line in the
   tool-use section, stating the concrete behaviour: several independent
   reads/greps/globs go in **one** assistant message.
2. Narrow `system.md:23` — the preamble applies to a group of related work, not to
   each tool call. Explicitly: no preamble before a single read/grep.
3. Remove the trailing "Call independent tools in parallel where safe" clause from
   `system.md:92` — it is now stated properly above, and leaving both invites drift.

**Verify:** behavioural, via Phase 0. Run a comparable task and check the tool-calls-
per-message histogram shows a meaningful share of `≥ 2`. Current baseline is
`{0: 147, 1: 216}` with **zero** multi-call messages — any non-zero bucket is
progress; target is a mean ≥ 2.0.

Note this is a prompt change against one model family. Re-check the histogram when
switching provider — the fix is advisory, not enforced.

**Measured on MiniMax-M3 after the change (2026-08-07), oldest run first:**

| session  | tool calls | responses with >= 2 |
| -------- | ---------- | ------------------- |
| 1d6c35a2 | 12         | 71%                 |
| 6f646588 | 46         | 37%                 |
| d27e6f64 | 31         | **0%**              |
| 2c8e602f | 5          | too few to judge    |

No trend — the same prompt gets 71%, then 37%, then nothing. The instruction is
advisory and M3 follows it inconsistently, so the request-count win is real but
not bankable. Nothing in core disables parallel tool use (no
`disableParallelToolUse` / `parallelToolCalls` anywhere; opencode sets neither
either), so this is model adherence, not a harness blocker. Left as-is rather
than "fixed" with an enforcement mechanism neither reference agent has.

**Status: done (2026-08-05).** The parallel-call instruction now opens `## Tools` as
three paragraphs (capability, safe-to-batch tool list + two worked examples,
sequential caveat); the trailing clause at `:92` is gone; the preamble rule no longer
mentions batches of tool calls.

Wording follows opencode, which carries this instruction in every per-model prompt
file — `kimi.txt` (open-weights model, closest analog to MiniMax) supplied the
emphatic capability-assertion framing, `default.txt` the `git status` + `git diff`
example.

Correction carried into the spec: the 130 preambles are **not** wasted round trips.
Text and tool call arrive in one response and the loop splits them into two history
entries — which is exactly why 363 assistant messages cluster into 229 requests. The
preamble edit saves output tokens and context growth, not re-sends; the parallel-call
edit is the whole of the request-count win.

Cannot be verified without spending quota — the histogram check needs a real session.

---

## Phase 3 — Delete time-based microcompact (D3)

A deletion. Sequence it before Phase 4 so the prune rewrite is measured without this
confounder.

1. `agent/loop.ts` — delete `maybeTimeBasedMicrocompact` (`:297-327`) and its call
   site (`:470`).
2. Delete the now-orphaned `gapThresholdMinutes` default and the `console.log` at
   `:307` (it is a bare `console.log` in a codebase that uses `logger` — it goes with
   the method).
3. Check `loop-caching.test.ts` for coverage of this path and remove it.

**Verify:** `grep -c maybeTimeBasedMicrocompact apps/core/src` == 0. A `run()`
following a >5m gap leaves `this.history` byte-identical. Cache-read tokens are
non-zero on the first request after an idle gap — this is the RC3 signal, observable
through the existing `emitCacheWarm` events.

**Status: done (2026-08-05).** Method, call site and the bare `console.log` all gone;
production references are zero (the two remaining hits are in the test, deliberately).
420 tests green, typecheck clean.

On the test: the plan said "remove" the old coverage, and the replacement
(`history is untouched by an idle gap, however long`) is weaker than it looks. The
clearing ran inside `run()`, not `loadHistory()`, and exercising `run()` needs a live
provider — so the history-integrity half would have passed _before_ the deletion too.
What actually holds the change in place is the structural assertion that
`loop.maybeTimeBasedMicrocompact === undefined`, which fails the moment anyone
reintroduces it. Both halves are kept, with the limitation stated in the test.

The RC3 cache-read signal remains unverified — it needs a real session.

---

## Phase 4 — Prefix-stable pruning (D4)

The cache-correctness fix. This is where the 0.1× read rate is actually earned.

1. `agent/prune-state.ts` (new, ~80 lines) — `PruneState` holding
   `replaced: Map<string, string>` and `seen: Set<string>`, with
   `partition(candidates)` returning `{ mustReapply, frozen, fresh }` and
   `record(decisions)`. Pure, no loop dependency, directly unit-testable. Mirrors
   claude-code's `partitionByPriorDecision` (`utils/toolResultStorage.ts:648`).
2. `agent/loop.ts:338` — rewrite `pruneHistoryToolResults` to use it:
   - collect tool-result candidates with their `toolCallId` and size
   - partition; re-apply `replaced` entries **verbatim**; leave `frozen` untouched at
     full size regardless of age; select from `fresh` largest-first until under
     budget
   - `record()` every decision before returning
   - replacement text names the `toolCallId` and the `output` tool, matching
     `output-store/truncate.ts:22`
3. `agent/loop.ts` — hold one `PruneState` per loop instance, reset in `run()`
   alongside `lastMemoryQueryText` (`:424`).
4. Drop `PRESERVE_RECENT_TURNS` — recency is no longer the axis. `frozen` supersedes
   it: anything already sent is protected, which covers the recent turns by
   construction and, unlike a sliding window, does not un-protect them later.

**Verify:** the load-bearing test asserts **byte-stability**, not size —

```
prune(history)            → serialize → prefixA
history.push(newMessage)
prune(history)            → serialize → prefixB
assert prefixB.startsWith(prefixA)
```

Plus: a large result that was sent full-size stays full-size after aging out (frozen);
a replaced result yields the identical string on the second call; a fresh oversized
result is replaced on its first send. Rewrite `loop-caching.test.ts` — its current
assertions encode the sliding-window semantics being removed.

Then re-run Phase 0 against a live session: cache-read tokens should dominate
cache-creation tokens on every request after the first.

**Status: done (2026-08-05).** 432 tests green, typecheck clean.

The byte-stability test was checked against the old implementation before being
trusted: a replica of the sliding-window pruner fails it (`startsWith` → false), the
new one passes. A stability assertion that cannot fail is worth nothing.

**Prerequisite found mid-implementation — colliding tool ids.** `loadHistory` derived
`id: \`tool-${msg.id}\`` *inside* `parts.map()`, so every tool part in one assistant
message got the **same** id. `PruneState` is keyed by that id, so one decision would
have applied to every result in the message. Phase 2 makes multi-tool messages the
norm, so this was about to become the common case rather than an edge case. Fixed to
`tool-${msg.id}-${partIndex}` — deterministic, so still stable across loads. Nothing
depended on the old format.

**Deviations:**

- **A per-turn guard the plan did not have.** Dropping `PRESERVE_RECENT_TURNS`
  entirely means a huge result can be replaced on the very send that first carries it,
  so the model never sees what it just asked for and re-reads — a loop. Results in the
  newest assistant message are therefore excluded from _selection_. They are still
  recorded as seen, so they freeze on the next turn rather than becoming eligible
  again; without that they would be fresh next turn and the sliding window would be
  back by another name.
- **Budget is history-wide, not per-message.** claude-code's
  `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000` is explicitly per message. The same
  number is used here for the whole conversation, because compaction is what bounds
  the conversation and it now fires at ~107K tokens (≈428K chars) — a 200K-char share
  for tool results leaves room for the rest. Env: `FREECODE_TOOL_RESULT_BUDGET_CHARS`.
- **The `output` retrieval hint is honest about its limits.** The plan said the
  replacement should name the `output` tool. It does, but the store is in-memory and
  per-session, so after a resume the id resolves to nothing and the tool returns its
  unknown-id message. The marker says "or re-run the tool" rather than promising
  retrieval works.

**Consequence worth tracking:** once frozen results alone exceed the budget, the
overage is accepted — nothing can shrink them without breaking the prefix. Compaction
is the only thing that reclaims it, which is why Phase 1 matters more now than it did
in isolation. claude-code accepts the same trade for the same reason.

Unverified without quota: that cache-read tokens actually dominate cache-creation on a
live session. That is the real proof and it needs a run.

---

## Phase 4b — Persist per-message usage (measurement, unplanned)

Pulled forward out of Phase 6 because it blocks verifying Phases 1–4 at all.

Nothing persisted the provider's per-request usage: `messages.jsonl` had no usage
field and `usage.json` holds only a daily total. The number that decides whether
prompt caching works is a **per-request ratio** — cache reads bill at ~0.1x and writes
at ~1.25x — and a daily total cannot express it. Without this, verifying Phase 4 meant
reading "Prompt cache hit" lines off the TUI by eye.

For scale, one Claude Code session (`~/.claude/projects/*.jsonl`, which does record
`message.usage`):

```
cache_read_input_tokens      136,093,322
cache_creation_input_tokens    1,589,000
input_tokens                       1,223
```

98.8% cache reads. Note it sent nearly 3x more raw input than the leaking freecode
session (48.1M) while paying a tenth of the rate on almost all of it. **Total tokens
is the wrong metric; the cache-read ratio is the right one** — optimising the former
is what the old sliding-window pruning did.

1. `session/store.ts` — `MessageUsage` on `SerializedMessage`. The store
   `JSON.stringify`s whole messages, so nothing else changes.
2. `agent/loop.ts` — attach usage to the **first** message written for a response and
   clear it. One response is persisted as several messages (text, then one per tool
   call), so attaching it to each would multiply the totals.
3. `scripts/analyze-session.mjs` — report cache read/write/uncached, the ratio with a
   verdict band (>=90% healthy, >=50% partial, else broken), and a billed-equivalent
   at `read x0.1 + write x1.25`. Sessions without usage say so rather than showing 0%.
4. `--compare` gains the ratio (in **percentage points** — a relative change from a 0%
   baseline is undefined, and 0% -> 99% is the most important thing the table can say)
   and billed-equivalent.

**Verify:** synthetic sessions at 99% and 0% cache reads produce the right ratio,
verdict and billed-equivalent (the same 500K tokens cost 6x more at 0%); `+99pp` shows
as `better`; a pre-existing session reports "no usage recorded" instead of 0%.

**Status: done (2026-08-05).** 433 tests green, typecheck clean.

---

## Phase 5 — File-read state (D5)

Touches `packages/shared`, so it goes last among the token phases.

1. `packages/shared/src/types.ts` — add
   `readFileState?: Map<string, { mtimeMs: number; size: number }>` to `ToolContext`.
   Threaded like `sessionId` already is.
2. `tools/read.ts` — on a hit whose `mtimeMs` and `size` are unchanged, return the
   short form ("unchanged since your last read — content is above in this
   conversation") instead of the body. Write the entry on every full read.
3. `tools/write.ts`, `tools/edit.ts` — write the entry after a successful mutation,
   so the model's own edits do not trigger a stale-read warning.
4. `tools/edit.ts` — surface a staleness warning when the target's `mtimeMs` differs
   from the recorded value (external change since the model last looked). Warning
   only; do not block.

**Verify:** two consecutive reads of an unchanged file — second returns the short
form. `touch` the file between reads — second returns the body. Edit after an
external change — warning present. Confirm the short form never fires on a file the
model has not actually read this session.

**Status: done (2026-08-06).** 442 tests green, typecheck clean.

**Deviations:**

- **`packages/shared` is not touched.** The `ToolContext` tools actually use is
  `apps/core/src/tools/types.ts`, not the one in `packages/shared`, and it already
  carries `sessionId`. So the state lives in a per-session module registry keyed by
  that id — the same pattern as `output-store` — and nothing new is threaded. The
  "goes last because it touches shared" framing was wrong; it touches only core.
- **Three conditions gate dedup, not one.** The plan said "mtimeMs and size
  unchanged". That is necessary and not sufficient:
  1. **Same line window.** A record from `read(offset=1)` cannot answer
     `read(offset=500)`. claude-code matches `offset` and `limit` exactly.
  2. **Not written by `edit`/`write`.** Those record a file they _mutated_, whose new
     content the model has never been shown; deduping against one would claim the
     model has content the transcript does not hold. They store no `offset`, which
     keeps them out of dedup while still feeding the staleness check. claude-code
     calls this out explicitly at `FileReadTool.ts:545`.
  3. **Still in context.** This is the one no reference agent needs and freecode does.
     claude-code's dedup rests on "the earlier Read tool_result is still in context" —
     but Phase 4's pruner can replace exactly that with a marker. Left uncoupled, a
     large read would be pruned, re-read, and answered with "it's already above" while
     the model holds nothing. `pruneHistoryToolResults` therefore calls
     `markReadPruned` when it replaces a `read` result.
- **Killswitch added:** `FREECODE_READ_DEDUP=0`. This is the only change in the whole
  series that alters what the model _sees_ rather than what it is billed, so it is the
  only one that can confuse a model rather than merely cost more. claude-code ships
  the same switch (`tengu_read_dedup_killswitch`).

Interaction 3 is the reason this phase had to come after Phase 4 rather than before.

---

## Phase 6 — Estimation and guardrails (D6, D7)

Independent of the above; can be done in any order relative to Phase 5.

1. `compaction/tokens.ts` — `export const IMAGE_TOKEN_COST = 1600`; image content
   parts score the flat cost rather than `data.length / 4`.
2. `agent/loop.ts` — accumulate billed tokens per `run()` (the totals already exist
   at `:619-633`). On crossing `FREECODE_MAX_TURN_TOKENS` (default: off), abort with a
   message naming the count. Reset per `run()`.
3. Extend the existing stream event carrying cache-warm data (`emitCacheWarm`,
   `loop.ts:1437`) with running session totals.
4. `apps/tui` — render the counter. Presentation only; core computes.

**Verify:** an image part scores 1600. The breaker trips at the configured budget and
aborts cleanly with the count in the message; unset means never trips. The TUI
counter matches `usage.json` at session end.

**Status: done (2026-08-06).** Core 458 tests, TUI 96, both typecheck.

Steps 1–3 landed in `ba2b38f`. Step 4 (the renderer) did not, so `usage_totals`
was a dead event for a day: `loop.ts:700` emitted it, `protocol.ts:123` declared
it, and no frontend had a case for it.

**What step 4 actually fixes.** The framing "render the counter" undersold it —
the TUI already rendered `↓in ↑out` run totals. The problem was *where they came
from*: mid-run they are a ~4 chars/token guess (`streamedChars / 4` for output,
tool-result lengths for input), because the authoritative `result.usage` only
arrives when the whole run ends. So on a long multi-turn run — exactly the runs
whose cost matters — the counter showed an estimate for the entire time anyone
was watching it. `usage_totals` carries the provider's own per-turn running
totals, so the row now shows measured numbers, with the estimate resuming on top
of the reported baseline for the turn currently in flight. That also drags the
frontend back onside with "core computes; frontends only display" — it had been
quietly computing its own token arithmetic.

**Deviation:** `setLiveUsageTotals` clears the estimate accumulators itself
rather than leaving that to the caller. Both are run-cumulative, so a caller who
sets totals without clearing double-counts every turn so far — and the first
draft of the test did exactly that, which is how the sharp edge surfaced.
Enforcing it in the setter makes the mistake unavailable. `streamedChars` stays
in `index.ts` because it feeds `setLiveOutputTokens` and belongs to that module.

Both send paths (`submitPrompt` and `commands/freecode`) route through
`handleToolEvent` (`index.ts:1218`), so one case covers both.

---

## Phase 7 — Cache TTL (unplanned)

Not in the original spec. Added because the branch's own measurements kept
running into it: `cache-awareness.ts` warns that a >5m gap goes cold, and
nothing could act on the warning.

1. `providers/utils.ts` — `getCacheTtl()` reads `FREECODE_CACHE_TTL` per call
   (`5m` default, `1h` opt-in), applied to all three Anthropic-shaped breakpoint
   kinds at once: messages, the tools array, and the cached system block. Each
   previously hardcoded its own marker, so a partial change would have left them
   on mixed TTLs, expiring the prefix piecemeal.
2. `providers/cache-awareness.ts` — the cold line follows `getCacheTtl()`
   instead of a hardcoded 5 minutes, and the `5m` message names the knob.

**Verify:** at `5m` the `ttl` field is absent from the wire entirely (5m is
already the server-side default, so the default path stays byte-identical and
upgrading cannot invalidate a live cache); at `1h` it reaches `anthropic` and
`openrouter` only; an unusable value falls back to `5m`; a 10-minute gap warns
at `5m` and stays quiet at `1h`.

**Status: done (2026-08-06).** 6 tests in `utils.test.ts`, 2 in
`cache-awareness.test.ts`.

**Scope limit worth stating plainly:** `ttl` rides only on the two provider keys
whose acceptance is verified — the AI SDK's zod schema for `anthropic`
(`@ai-sdk/anthropic` `dist/index.d.ts:195`, `"5m" | "1h"`) and OpenRouter's
documented `cache_control` passthrough. `openaiCompatible` is a raw passthrough
to whatever gateway sits behind it, so an unrecognised field there risks a 400
on the primary path to buy nothing. **MiniMax's cache lifetime is therefore not
controllable from here, and MiniMax is the provider these measurements were
taken on.** This phase does nothing for that path.

**Default stays `5m`.** 1h moves writes from 1.25x to 2x base. Per-turn writes
are small (Anthropic bills the delta once the prefix head hits); what dominates
is how often the whole context is re-written cold. One >5m gap per hour already
pays for it — 2x once beats 1.25x twice — but a fast unattended run with no gaps
pays 2x for durability it never uses. That is session-shaped, not
codebase-shaped, so it is a knob rather than a new default.

---

## Expected outcome

Modelled against the `4ba54e41` trace (spec, "Goal"):

| After phase | Requests | Billed input |
| ----------- | -------- | ------------ |
| baseline    | 229      | 48.1M        |
| 3 + 4       | 229      | 5.1M         |
| + 1         | 229      | 3.6M         |
| + 2         | ~91      | ~1.4M        |

Phases 3 and 4 are what make the prompt cache real; Phase 1 caps the context; Phase 2
cuts the request count that multiplies both. Phases 5 and 6 are smaller and mostly
protect the result.

Re-run Phase 0 after each phase and record the actual number. If a phase does not
move it, say so in this file rather than proceeding on the assumption that it did.

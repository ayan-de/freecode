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
provider — so the history-integrity half would have passed *before* the deletion too.
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

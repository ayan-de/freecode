# Token Efficiency

> **Date:** 2026-08-05
> **Status:** Built (status corrected 2026-09-04 — D1–D7 all landed; header had
> never been flipped)
> **Plan:** `docs/superpowers/plans/2026-08-05-token-efficiency.md`

## Problem

FreeCode burns roughly 40× the input tokens a comparable agent needs for the same
work. This is measured, not estimated.

`~/.freecode/usage.json` for the week of 2026-08-01:

| Date       | Tokens     |
| ---------- | ---------- |
| 2026-08-01 | 34,607,697 |
| 2026-08-02 | 69,132,859 |
| 2026-08-04 | 42,062,096 |

Replaying the recorded sessions in `~/.freecode/sessions/` via
`scripts/analyze-session.mjs` (input cost per request = the history preceding it plus
a ~12K system+tools block; assistant messages written within 1.5s of each other are
one round trip, not two):

| Session    | Model      | User msgs | Provider requests | Requests/msg | Final history | Σ input tokens |
| ---------- | ---------- | --------- | ----------------- | ------------ | ------------- | -------------- |
| `4ba54e41` | MiniMax-M3 | 7         | 229               | 33           | 270K          | **48.1M**      |
| `65f171fa` | MiniMax-M3 | 8         | 300               | 38           | 201K          | **58.7M**      |
| `08e19c43` | —          | 19        | 295               | 16           | 156K          | **33.5M**      |

48.1M input tokens for seven user messages. One session is most of a day's quota.

Two structural facts drive the number:

1. **The history never shrinks.** `4ba54e41` ends at 270K tokens and was never
   compacted once.
2. **Every request carries the whole thing.** 229 requests × a mean context in the
   150K range.

Cost is therefore _quadratic in turn count_, and turn count is inflated because the
model emits exactly one tool call per request.

## Root causes

### RC1 — Compaction is gated on window fit, not on cost

`AgentLoop.resolveContextLimit()` (`apps/core/src/agent/loop.ts:767`) resolves the
model's real context window from models.dev and compacts at
`limit - resolveMaxOutputTokens()`. For MiniMax-M3 that is ≈ **968K**.

Session `4ba54e41` peaked at 270K, so `maybeCompact()` never fired. The same code on
MiniMax-M2 (196K window) would have compacted at ~164K and cut the session roughly in
half — the behaviour is accidentally correct on small-window models and catastrophic
on large-window ones.

The question the threshold answers is "will the next request still fit?". The
question that matters is "what will the next request cost?". Fitting is a hard
constraint; cost is the objective. Only the constraint is currently modelled.

### RC2 — Parallel tool calls never happen

`planToolBatches()` (`apps/core/src/tools/batching.ts`) is correct, and nine tools
declare `behavior.isConcurrencySafe = true` (`read`, `grep`, `glob`, `ls`, `lsp`,
`skill`, `webfetch`, `websearch`, `output`). The loop batches them into a single
`Promise.all` (`loop.ts:1162`).

The model never gives it more than one call to batch. Across 363 assistant messages
in `4ba54e41` the distribution of tool calls per message is `{0: 147, 1: 216}` —
**not a single message with two**.

The system prompt is the cause. `session/prompt/system.md:92` mentions parallelism as
a clause in a run-on final paragraph ("Call independent tools in parallel where
safe"), while `system.md:23` gives a prominent, early instruction to emit a preamble
"before a batch of related tool calls". The prominent rule produces narration; the
buried rule produces nothing. 130 of the 147 tool-free assistant messages are
preambles immediately followed by a single-tool message.

Each avoided round trip saves one full context re-send. At the observed context
sizes, going from 1.0 to 2.5 tool calls per request is a ~60% reduction on its own.

### RC3 — `maybeTimeBasedMicrocompact` destroys the cache and the context

`loop.ts:297`, invoked at `loop.ts:470` on every `run()`. If more than five minutes
have passed since the last message it walks the **entire** history and replaces every
tool result over 200 chars with the literal string `"[Old tool result content
cleared]"` — including the most recent turn, and with no handle to retrieve what was
dropped.

Two costs, both large:

- **Cache:** every message in the history changes, so the provider's prompt cache
  misses 100% on the next request. A human pausing to read a diff trips this
  routinely; in a session of short interactive fixes it can fire on most turns.
- **Context:** the model has lost everything it read and must re-read it, adding
  turns — each of which re-sends the whole history (RC1).

The cleared-message string is taken verbatim from claude-code
(`utils/toolResultStorage.ts:34`, `TOOL_RESULT_CLEARED_MESSAGE`). What was not taken
is the mechanism around it: claude-code calls `persistToolResult()` to write the
content to disk and leaves a `<persisted-output>` tag plus a `PREVIEW_SIZE_BYTES =
2000` preview, so the result is retrievable and the model does not re-read. FreeCode
already has that infrastructure — `tools/output-store/` plus the `output` tool — and
does not use it here.

### RC4 — `pruneHistoryToolResults` invalidates the cache prefix every turn

`loop.ts:338`, added in `26c009c`. It caps tool results to 1,000 chars in every turn
older than the last two, and applies to the provider-facing copy only.

The preservation window slides. A result sent at full size on turn N is sent
truncated on turn N+1, which mutates the prompt prefix roughly two turns back. Every
byte from that point on is re-billed as a cache **write** (1.25×) instead of a cache
**read** (0.1×). Since the recent turns hold the largest results, the change moves the
most expensive region of the prompt out of the cache on every single turn.

claude-code solves exactly this in `partitionByPriorDecision()`
(`utils/toolResultStorage.ts:648`), which splits candidates three ways:

- `mustReapply` — already replaced once → re-apply the _identical_ replacement, for
  prefix stability
- `frozen` — already sent unreplaced → **off-limits**, replacing now would change a
  prefix that was already cached
- `fresh` — never sent → eligible for a new decision

FreeCode tracks neither `frozen` nor `mustReapply`. As written the pruning is a net
loss: it saves ~250 tokens per old result and costs a partial cache invalidation per
turn.

### RC5 — No file-read state

`grep -rn "readFileState\|alreadyRead" apps/core/src/tools/` returns nothing. Every
`read` of an unchanged file pays full price again, and there is no staleness signal
for `edit`. claude-code threads a `readFileState: FileStateCache` through
`ToolUseContext` and consults it on every read (`tools/FileReadTool/FileReadTool.ts:542`,
written back at `:842` and `:1032`).

In an iterative single-file task — the CSS session that prompted this spec — the same
file is read at full cost on most turns.

### RC6 — Token estimation is `chars / 4`

`compaction/tokens.ts:3` (`CHARS_PER_TOKEN = 4`) is the only estimator, and it feeds
`shouldCompact()`. It is acceptable for prose and wrong by ~100× for a base64 image,
which is a data URL of ~1.4 chars per byte that the estimator scores as
`length / 4` tokens against a real cost near 1,600. jcode uses a flat
`IMAGE_TOKEN_COST = 1600` for precisely this reason. Once multimodal input is in play
(shipped: `plans/2026-08-01-multimodal-input.md`) the compaction trigger is
unreliable in whichever direction hurts.

### RC7 — No spend circuit breaker, no live cost display

`MAX_OVERFLOW_COMPACTIONS = 3` (`loop.ts:128`) caps compaction retries after a
context-overflow rejection. Nothing caps _spend_. A loop that oscillates — which
`effect/loop-health.ts` detects but only warns about — can consume a plan silently.

`usage.json` is written after the fact and read by nobody during a turn. claude-code
surfaces running cost in the REPL (`cost-tracker.ts`, `costHook.ts`). The leak
described in this spec ran for at least four days before anyone looked at the file;
a live counter surfaces it inside one turn.

## Goal

Cut input tokens per unit of work by an order of magnitude, without reducing what the
model can see when it actually needs to see it.

Modelled against the real `4ba54e41` trace, applying the fixes cumulatively:

| Configuration                | Requests | Billed input |
| ---------------------------- | -------- | ------------ |
| Actual (measured)            | 229      | **48.1M**    |
| + prompt cache prefix held   | 229      | 5.1M         |
| + compaction at 120K         | 229      | 3.6M         |
| + 2.5 tool calls per request | ~91      | **~1.4M**    |

The cache row assumes a 0.1× read / 1.25× write split and a prefix that is not
invalidated mid-session — i.e. RC3 and RC4 fixed. The final row is the target band
where claude-code sits on comparable work.

These are simulations over a real trace, not a head-to-head measurement. A matched
benchmark against another agent on an identical task is out of scope here and worth
doing separately (see RC7 — there is no eval harness to run it in).

## Design

### D1 — Cost-based compaction threshold (RC1)

Introduce an explicit compaction target that is independent of the window:

```
DEFAULT_COMPACT_TARGET_TOKENS = 120_000   // env: FREECODE_COMPACT_TARGET_TOKENS
```

`shouldCompact()` caps whatever window it was given: `min(windowLimit, target)`, then
subtracts the existing 13K buffer — so the trigger lands at **107K**. Capping there
rather than in `resolveContextLimit()` covers the offline fallback path too, and
keeps the rule in one testable place.

The target binds on **every** model whose usable window exceeds 120K — MiniMax-M2
(~164K usable) and Anthropic's 200K included, not just ≥1M-window models. That is
deliberate: the cost of sending a 120K context is the same regardless of how much
larger the window happens to be. Models with a smaller usable window (or the 100K
offline fallback) are unaffected, since their own limit still binds first.

120K is chosen as the knee of the cost curve rather than a capability limit: below it
a full-context request is affordable at cache-read rates, above it the quadratic term
dominates. The env var exists so it can be tuned per plan without a rebuild, and set
high by users who would rather pay than compact.

The overflow path (`compactAndRetry`, `MAX_OVERFLOW_COMPACTIONS`) is unchanged — it
remains the hard-constraint backstop.

**This one is not copied from anywhere.** Every other item in this spec has a direct
precedent in the reference agents; D1 does not. Both compact purely relative to the
window:

- claude-code: `getEffectiveContextWindowSize(model) - AUTOCOMPACT_BUFFER_TOKENS`
  (`utils/analyzeContext.ts:1003`)
- opencode: `model.limit.input - reserved`, `reserved = min(20_000, maxOutputTokens)`
  (`session/overflow.ts:14`)

Neither has an absolute cost ceiling, so on a 1M-window model both would compact near
980K — exactly the behaviour this section calls a leak. Their cost control comes from
elsewhere: claude-code budgets tool results per message
(`MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000`, and explicitly _per message_ — "a
150K result in one turn and a 150K result in the next are both untouched"), plus
microcompact and `cache_edits`. That is D3/D4 territory, not D1.

D1 is therefore a deliberate divergence, justified by a regime those agents do not
target: a very large window (1M) combined with a fixed prepaid quota, where the
binding constraint is the plan balance rather than the context window. The trade is
real — compacting at 107K on a 1M model gives up context the model could have held.
If D3 and D4 alone bring the measured cost into range, raising or removing this target
is the first thing to reconsider.

### D2 — Promote parallel tool calls in the system prompt (RC2)

Two edits to `session/prompt/system.md`:

- Give parallelism its own line, early, in the imperative — not a trailing clause of
  the final paragraph. It must state the concrete behaviour: when several independent
  reads/greps/globs are needed, emit them in **one** assistant message.
- Narrow the preamble rule at `:23` so it does not fire per tool call.

  Correction to an earlier draft of this spec: those 130 preambles are **not** extra
  round trips. The model emits the text and the tool call in one response; the loop
  merely splits them into two history entries, which is why the clustered request
  count (229) is well below the assistant-message count (363). A per-call preamble
  costs output tokens and permanent context growth, not a re-send.

  It is still worth narrowing, for a second-order reason: a rule that pairs one
  preamble with one "batch of related tool calls" reinforces the one-call-per-message
  rhythm this section is trying to break. The direct saving is small.

No code change. `planToolBatches` already handles the result correctly.

Wording is modelled on opencode, which carries an explicit parallel-call instruction
in **every** per-model prompt file (`session/prompt/{anthropic,default,kimi,gemini,
codex,meta,copilot-gpt-5}.txt`). `kimi.txt` is the closest analog to MiniMax — an
open-weights model that needs the capability asserted outright ("You have the
capability to output any number of tool calls in a single response… HIGHLY
RECOMMENDED… This is very important to your performance"), and the concrete
two-`bash`-calls example comes from `default.txt`.

Verification is behavioural, not a unit test: after the change, the tool-calls-per-
assistant-message distribution in a fresh session must show a non-trivial share of
messages with ≥ 2.

### D3 — Replace time-based microcompact with store-backed eviction (RC3)

Delete `maybeTimeBasedMicrocompact` (`loop.ts:297`) and its call site (`loop.ts:470`).

The idle-gap heuristic is not the right trigger — elapsed wall-clock time says
nothing about whether a result is still needed, and the 5-minute threshold makes
normal human pauses expensive. Size and age-in-turns are the right signals, and D4
already acts on both.

Where clearing _is_ warranted, the replacement must be retrievable: the full output is
already in the session's `OutputStore` (`tools/output-store/`), so the substituted
text names the `toolCallId` and the `output` tool, exactly as `adaptiveTruncate` does
at `output-store/truncate.ts:22`. The model can page it back instead of re-reading.

### D4 — Prefix-stable history pruning (RC4)

Rewrite `pruneHistoryToolResults` around a per-session decision state, mirroring
claude-code's `ContentReplacementState`:

```typescript
interface PruneState {
  replaced: Map<string, string>; // toolCallId → the exact replacement text
  seen: Set<string>; // toolCallId sent to the provider at full size
}
```

On each send, partition the tool results in the outgoing history:

- `toolCallId ∈ replaced` → re-apply the **stored** replacement verbatim. Never
  re-derive it; a re-derived string that differs by one byte costs a full
  invalidation.
- `toolCallId ∈ seen` (and not replaced) → **frozen**. Leave at full size regardless
  of age. It is already in the provider's cached prefix; truncating it now is the
  invalidation this design exists to prevent.
- otherwise → **fresh**, and eligible for replacement this turn.

Select from `fresh` largest-first until the model-visible total is under budget.
Record every decision into `PruneState` before sending. Replacements point at the
`OutputStore` handle (D3).

The consequence: a result is only ever truncated on the _first_ request that
includes it, so the prefix is byte-stable from turn to turn and the cache prefix
grows monotonically. Both maps are keyed by `toolCallId` and cleared with the session.

`this.history` remains untouched — pruning applies only to the provider-facing copy,
as it does today, so the session store keeps full fidelity and compaction is
unaffected.

### D5 — File-read state (RC5)

A per-session `Map<absPath, { mtimeMs: number; size: number; hash: string }>` written
by `read`/`write`/`edit` and consulted by `read`.

On a `read` whose path is present and whose `mtimeMs`+`size` are unchanged, return a
short "unchanged since your last read at turn N — content is above in this
conversation" result instead of the file body. This is the same trade D4 makes: the
content is already in the prefix at cache-read rates, so re-sending it is pure waste.

The entry additionally gives `edit` a staleness check it does not have today (edit a
file the model has not read since an external change → warn rather than clobber),
which is a correctness win independent of tokens.

Scope note: this is the one item here that touches `ToolContext`
(`packages/shared/src/types.ts`) — the map must be threaded like `sessionId` already
is.

### D6 — Multimodal-aware token estimation (RC6)

`estimateTokenCount` grows an image-aware path: content parts of `type: "image"` cost
a flat `IMAGE_TOKEN_COST = 1600` rather than `data.length / 4`. Text keeps the
existing `chars / 4` heuristic — it is imprecise but unbiased, and the compaction
threshold has enough headroom to absorb it.

A real per-model tokenizer is deliberately **not** proposed. It is a dependency and a
per-provider maintenance surface, and the error it removes is small next to the
errors D1–D5 remove. Revisit once those have shipped and the remaining variance is
worth measuring.

### D7 — Turn spend budget and live cost (RC7)

Two independent pieces:

- **Circuit breaker.** Accumulate billed tokens per `run()`. On crossing
  `MAX_TURN_TOKENS` (env `FREECODE_MAX_TURN_TOKENS`, default off) abort the loop with
  a clear message naming the count. This is the backstop for a runaway oscillation
  that `effect/loop-health.ts` detects but does not stop.
- **Live cost.** The loop already receives `usage` on every chunk
  (`loop.ts:1394-1400`) and already emits cache-warm events via `emitCacheWarm`.
  Extend the existing stream event with running totals so the TUI can render a
  per-session counter. Frontends stay pure renderers — core computes, the TUI
  displays.

## Out of scope

- A per-model tokenizer (see D6).
- An eval/benchmark harness for head-to-head agent comparison. Needed to _verify_ the
  target band in "Goal", and the reason the numbers there are simulated rather than
  measured — but it is its own spec.
- `cache_edits`-style server-side tool-result deletion (claude-code's "cached
  microcompact"). It is Anthropic-API-specific and FreeCode is multi-provider; D4
  gets most of the benefit portably.
- Changes to the caching _breakpoint_ placement itself. The current scheme — tools
  (`providers/utils.ts:46`), two system blocks (`context/compiler.ts:174`), last
  message (`providers/minimax.ts:76`) — is exactly at Anthropic's 4-breakpoint limit
  and is not the problem; the problem is that D3 and D4 keep invalidating what it
  writes. Revisit only if D3/D4 do not restore the hit rate.
- Semantic/embedding-based topic-shift detection for compaction (jcode's approach).

## Testing

- **D1** — `shouldCompact` fires at the target on a 1M-window model; unchanged on a
  196K model; `FREECODE_COMPACT_TARGET_TOKENS` overrides both.
- **D3** — no history mutation occurs on a `run()` following an idle gap of any
  length.
- **D4** — the critical one, and it must assert byte-stability, not just size:
  build a history, call the prune twice across a simulated turn boundary with a new
  message appended, and assert the serialized prefix up to the previous end is
  **identical**. A frozen result stays full-size after aging out of the recent
  window; a replaced result re-applies the same string.
- **D5** — a second `read` of an unchanged file returns the short form; a `read`
  after an external `mtime` change returns the body.
- **D6** — an image part scores 1600, not `length / 4`.
- **D7** — the breaker trips at the configured budget and the loop aborts cleanly
  with the token count in the message.

Existing `loop-caching.test.ts` covers the current prune behaviour and will need
updating alongside D4 — its present assertions encode the sliding-window semantics
this spec replaces.

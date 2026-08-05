# Prompt Caching: What Was Broken and What Fixed It

> **Date:** 2026-08-06
> **Branch:** `token-efficiency-phase-0`
> **Spec:** `specs/2026-08-05-token-efficiency.md` · **Plan:** `plans/2026-08-05-token-efficiency.md`
> **Model under test:** MiniMax-M3 via `@ai-sdk/anthropic` against
> `https://api.minimax.io/anthropic`

Prompt caching was returning ~5% hit rates. Six live sessions and one
head-to-head against Claude Code later, it runs at 90–99.8% on steady-state
turns. Every cause was ours; none was the provider.

This is the record of what the data actually said, including the four times the
measurement itself was wrong.

---

## Headline

| Session    | When        | Responses | Total input | Cache read | Hit rate  |
| ---------- | ----------- | --------- | ----------- | ---------- | --------- |
| `9b0e6fb9` | before      | 76        | 4,336,668   | 296,960    | **6.8%**  |
| `6f646588` | before      | 27        | 1,484,331   | 66,216     | **4.5%**  |
| `d27e6f64` | before      | 33        | 2,372,987   | 134,172    | **5.7%**  |
| `715db252` | partial fix | 10        | 191,290     | 30,208     | **15.8%** |
| `2c8e602f` | **after**   | 9         | 385,228     | 239,232    | **62.1%** |

All figures use the corrected formula (see [Bug 7](#bug-7)). The 62.1% aggregate
understates steady state, because it includes a cold start and a compaction:

```
  #  total in  cacheRead  uncached  hit%   note
  0    66,431      9,472    56,959   14.3%  cold start (nothing cached yet)
  1    66,835     66,176       659   99.0%
  2    71,630      6,912    64,718    9.6%  unexplained miss
  3    73,780     71,424     2,356   96.8%
  4    18,435        128    18,307    0.7%  post-compaction (prefix rebuilt)
  5    20,456     18,432     2,024   90.1%
  6    21,801     21,760        41   99.8%
  7    22,570     21,760       810   96.4%
  8    23,290     23,168       122   99.5%
```

Six of nine responses cached at 90–99.8%. On the best turn only **41 tokens**
were uncached.

### Reference point

Claude Code, pointed at the **same model and endpoint** with the same prompts
(`ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`, session
`cf53bf31`):

```
responses=27  input=110,550  cache_read=1,175,040  ratio=91.4%
```

This experiment is what proved the ceiling was ours, not MiniMax's. Before it,
the evidence — reads pinned at ~10K regardless of history, always multiples of
128 — looked exactly like a provider that caches only a bounded prefix. It
wasn't.

---

## The seven bugs

### Bug 1 — Cache counters read from the wrong field

`providers/streaming.ts` took `cacheCreationInputTokens` / `cacheReadInputTokens`
off `totalUsage`. Those are the **Anthropic wire names**, which only ever appear
under `providerMetadata`. AI SDK v6 puts the standard counters on
`usage.inputTokenDetails.{cacheReadTokens,cacheWriteTokens}`.

Result: every turn recorded 0 cache activity — indistinguishable from a provider
that does not cache. Since the agent loop streams, this affected every request,
and made the whole problem unmeasurable end to end.

**Fix:** `35a8cf8`. Reads `inputTokenDetails`, falling back to the deprecated v5
`cachedInputTokens` and to `providerMetadata.anthropic`.

### Bug 2 — Only one cache breakpoint on the messages

Providers check for a cache hit **at each breakpoint**. A single marker on the
final message describes a prefix that always ends in content the model has never
seen, so a request can only ever _write_ an entry, never read one.

Evidence: reads pinned at ~7–10K (the system blocks, which did have a stable
breakpoint) and not one conversation message cached, even at 86K input.

**Fix:** `7e14aec`. Two anchors — a read anchor and a write anchor — following
opencode's `applyCaching` (`provider/transform.ts:335`) and jcode's sliding
two-marker window. Also sets every provider flavor's key (`anthropic`,
`openrouter`, `openaiCompatible`, `alibaba`, `bedrock`), so a model reached
through a gateway caches like a direct connection.

### Bug 3 — Five breakpoints against a limit of four

Adding the second anchor pushed the request to 5. The AI SDK does not error on
that; it warns and silently drops one:

```
The feature "cacheControl breakpoint limit" is not supported.
Maximum 4 cache breakpoints exceeded (found 5). This breakpoint will be ignored.
```

So the anchor pair from Bug 2 was never reliably in effect.

**Fix:** `27754c5`. The dynamic system block gives up its slot — its boundary
moves between turns, so a check there buys nothing. Budget is now tools + static
system + read anchor + write anchor = 4. A test counts breakpoints across the
whole request so exceeding the limit fails loudly.

### Bug 4 — The read anchor was two messages back

`.slice(-2)` is opencode's rule, written for a shape where one turn appends one
wire message. `convertToCoreMessages` expands a tool-using turn into **two** — an
`assistant` carrying the tool calls and a `tool` carrying the results — so the
last two messages are _both new_ and the read anchor could never match.

Evidence: reads capped at ~10,880 while input grew to 100,939 across 33
responses. Never scaled with history.

**Fix:** `490b549`. The previous request ended immediately before the newest
assistant message, tools or not; the anchor goes there.

### Bug 5 — Dynamic content inside the cached system block

The breakpoint sat _before_ content that changes every turn (file tree, session
memory, clock). Anything changing inside that region invalidates the prefix from
there forward, including the message anchors downstream.

Claude Code splits at a `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker for exactly this
reason (`utils/api.ts:321`, `splitSysPromptPrefix`), and explicitly drops the
dynamic section out of the cached region when MCP tools are present
(`services/api/claude.ts:1212`).

**Fix:** `34ebc05`. `compileSystemBlocks` now returns only the static block
(~58K chars, cacheable). `compileDynamicContext` returns the rest, which the loop
inlines as a user message.

### Bug 6 — Growing content at position 0

The fix for Bug 5 built the inlined message with `renderPromptMemoryContext()`,
which renders `recentMessages`. Those grow every turn — so position 0 of the
request, the single most cache-sensitive slot, was rewritten on every request.
The problem moved from the system block to a strictly worse location.

It was redundant too: those same messages appear verbatim in the history
immediately below.

Evidence: hit rate moved 5.7% → 15.8% (`d27e6f64` → `715db252`), but reads still
alternated 128 / ~7–11K rather than tracking history size.

**Fix:** `58ebb82`. Position 0 carries only project summary and clock, with a
fixed id and timestamp (a moving timestamp is the same bug wearing a different
hat). Also restored the compaction summary, which the Bug 5 fix had dropped by
accident — it now uses `getPromptContext().summary` directly rather than
`renderPromptMemoryContext()`. The summary changes only when compaction runs;
`recentMessages` changed every turn. Conflating the two caused both problems.

### Bug 7 — The hit rate double-counted cached tokens {#bug-7}

`analyze-session.mjs` computed `cacheRead / (input + cacheRead + write)`. But AI
SDK v6's `inputTokens` is the **total** with cached tokens already included;
`inputTokenDetails.noCacheTokens` is the uncached part. Raw Anthropic is the
opposite — its `input_tokens` _excludes_ the cached ones, which is why a
claude-code transcript shows a tiny input beside a huge `cache_read`.

Reading one convention and applying it to the other roughly halved every ratio
reported in this document's history.

**Fix:** `7bb2b69`. Now `cacheRead / inputTokens`, with the uncached remainder
derived, and billed-equivalent charging only genuinely uncached tokens at full
rate.

---

## Supporting fixes found along the way

| Commit    | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a9dd863` | **The built core ran on a 71-character system prompt.** `tsc` emits only JS, so `session/prompt/system.md` never reached `dist` and `loadSystemPrompt` fell through to `EMBEDDED_FALLBACK`. The TUI spawns `dist` in preference to tsx, so every `pnpm dev` run drove the agent with no tool guidance, no coding standards, no mode behaviour — degrading quality invisibly rather than failing. A `copy-assets` step now runs after `tsc`, and the fallback logs a warning. |
| `a9dd863` | **Parallelism was unmeasurable.** `appendToolMessage` persists one message per tool call, so "tool calls per assistant message" is capped at 1 by construction and always reported zero. Usage markers give exact response boundaries; the histogram is now per response.                                                                                                                                                                                                    |
| `0402012` | **Σ input over-counted ~2×.** Charged per assistant message rather than per response — 169 messages against 76 real responses.                                                                                                                                                                                                                                                                                                                                               |
| `25511a3` | **Debug output was invisible.** `logger` writes to stdout, which is core's JSON-RPC channel, so the frontend's protocol reader swallowed it. `FREECODE_DEBUG_CACHE=1` now writes to stderr.                                                                                                                                                                                                                                                                                  |
| `3988a74` | **Nothing persisted per-request usage.** The daily total in `usage.json` cannot express a per-request ratio. `MessageUsage` now rides on the first message of each response.                                                                                                                                                                                                                                                                                                 |

---

## What this cost, and the lesson

Four of the seven bugs were in the **measurement**, not the system:

- Bug 1: reading the wrong usage field → everything looked like 0%
- Bug 7: wrong ratio formula → everything looked ~half as good
- `a9dd863`: parallelism metric structurally incapable of showing parallelism
- `0402012`: token totals inflated 2×

Each one produced a plausible, confident, wrong conclusion. Three separate times
the working hypothesis became "MiniMax doesn't support prompt caching" — twice
from counters that were being read incorrectly, once from a real signal (reads
capped at ~10K, always multiples of 128) that had a different cause.

The thing that broke the loop was not more analysis. It was **running Claude Code
against the same endpoint** and getting 91.4%, which made "the provider is the
ceiling" untenable in one measurement.

Practical rules this produced:

1. **Validate the instrument against a known-good reference before trusting it.**
   The Claude Code transcripts were available from the start.
2. **Check the field's definition, not its name.** `input_tokens` means opposite
   things in the raw Anthropic API and in the AI SDK.
3. **A metric that cannot fail is not evidence.** The byte-stability test was
   only worth something after being run against the old implementation to
   confirm it failed there.
4. **Position 0 of the prompt is sacred.** Every byte after it depends on it.

---

## Still open

- **Response #2's miss** (9.6% amid neighbours at 96–99%) is unexplained. If it
  recurs at a fixed cadence, something churns periodically —
  `FREECODE_DEBUG_CACHE=1` prints per-segment hashes and will name it.
- **Only nine responses of evidence** at the new hit rate. Needs a longer session
  to confirm it holds across multiple compactions.
- **Parallelism regressed** to 0 of 9 responses with ≥2 tool calls, against 82%
  (`c9ed4b76`) and 36% (`9b0e6fb9`) earlier. Small sample, different task shape,
  but worth watching — it is a separate lever from caching and it drives request
  count directly.
- **The file tree still sits at position 0** and is recomputed after every
  mutating tool. It is stable within the 5-minute tree-cache TTL, but freezing it
  per session (as Claude Code does with its directory listing) would remove the
  last known source of churn ahead of the conversation.

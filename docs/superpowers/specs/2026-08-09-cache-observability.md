# Prompt-Cache Observability

> **Date:** 2026-08-09
> **Status:** Proposed
> **Extends:** `specs/2026-08-05-token-efficiency.md` (RC3/RC4 are the bug class D2 detects)
> **Prior art studied:** `claude-code` (idle-return), `jcode` (KV-cache miss detector),
> `opencode` (stats), all read at their working trees on 2026-08-09.

## Problem

Prompt caching is the largest single lever on FreeCode's token bill. Cache reads
bill at roughly a tenth of fresh input, so a session that holds its prefix pays
~10% for the history it re-sends on every request, and one that keeps losing the
prefix pays full price — repeatedly, because every request carries the whole
conversation.

We can now *see* the rate (`cacheHitRate`, the run/session footer, `/cost`). What
we still cannot do is answer the two questions that follow from a bad number:

1. **"This context is stale — should I even be carrying it?"** After a long idle
   gap the cache has expired, so the next message re-sends everything as fresh
   input. If the user is starting an unrelated task, that spend is pure waste and
   they are the only one who knows it.

2. **"What broke the prefix?"** A low hit rate says money is being lost. It does
   not say whether the cause was legitimate (a compaction rebuilt history) or a
   harness bug (something mutated an already-sent message). RC3 and RC4 in the
   token-efficiency spec were both the second kind, and both were found by hand,
   long after they landed.

## Prior art

|                            | freecode        | claude-code | opencode   | jcode |
| -------------------------- | --------------- | ----------- | ---------- | ----- |
| Prompt caching             | ✅              | ✅          | ✅         | ✅    |
| Cold-cache warning         | ✅              | —           | —          | ✅    |
| Hit rate (%)               | ✅              | ✗ raw only  | ✗ raw only | —     |
| `/cost` history            | ✅              | ✅          | ✅         | —     |
| Idle "/clear to save 128k" | ✗               | ✅          | —          | —     |
| Miss detector + journal    | ✗               | ✗           | ✗          | ✅    |

### What we already have

- **The cache itself.** `providers/utils.ts:148` sets `cacheControl: { type: "ephemeral" }`
  for Anthropic, OpenRouter, openai-compatible and Alibaba. Breakpoints sit on tools
  (`providers/utils.ts:46`), two system blocks (`context/compiler.ts:174`) and the last
  message (`providers/minimax.ts:76`) — Anthropic's full allowance of four.
- **Cold-cache warning.** `providers/cache-awareness.ts` warns when the gap since the
  last turn exceeds the TTL, honouring `FREECODE_CACHE_TTL` (`5m` default, `1h` opt-in).
  Surfaced through the `cache_status` stream event.
- **Hit rate and history.** `utils/format-tokens.ts` (`cacheHitRate`), the run/session
  footer, and `/cost` over the daily breakdown in `usage/tracker.ts`.

### claude-code — idle-return nudge

`screens/REPL.tsx:3289`. Fires when **both** hold: idle ≥ 75 min
(`CLAUDE_CODE_IDLE_THRESHOLD_MINUTES`) and total input ≥ 100K
(`CLAUDE_CODE_IDLE_TOKEN_THRESHOLD`). Three treatments behind a flag — `dialog`
(blocking), `hint` (a notification), `off`. The hint reads:

```
new task? /clear to save 128.2k tokens
```

It persists until the next submit rather than timing out, because the user may be
away for hours, and a global `idleReturnDismissed` suppresses it permanently.

The reasoning is not "the cache is cold" on its own — it is "the cache is cold **and**
you are carrying 128K you may not need." Only the user knows whether the next message
continues the old task.

### jcode — KV-cache miss detector

Two halves.

**The detector** (`crates/jcode-tui/src/tui/app.rs:723`, `tui/mod.rs:728`) keeps a
baseline of the last request's cached prefix and compares the next response's usage
against it, raising one of two problems:

- `UnexpectedCacheCreation` — wrote cache that should already have existed
- `ExpectedCacheReadMissing` — should have read cache, and did not

A `cache_generation` counter is bumped whenever compaction replaces the
provider-facing history, so an in-flight request from before a compaction cannot
restore a stale baseline afterwards.

**The journal** (`crates/jcode-base/src/cache_invalidation.rs`) is the better idea.
Harness actions that legitimately change the prefix — a config reload, a skill reload —
call `record(source, detail)` at the site that does it. The detector then attributes a
miss to its documented cause instead of alarming. From the file header:

> An empty journal around a harness-caused miss is itself signal: it means something
> changed the prompt without documenting why, which is exactly the bug class the alarm
> exists for.

That inversion is what makes it a bug detector rather than a cost display: silence is
the alarm.

## Goals

- Tell the user when their context is both stale and large, in terms of what it costs.
- Catch a prefix bust the turn it happens, and name the cause when it is known.
- Fail quiet, not loud: neither feature may produce noise during normal operation, or
  it will be ignored (and then disabled) before it catches anything.

## Design

### D0 — Make `/clear` real (prerequisite)

`/clear` today is a no-op. `commands/built-in.ts:35-41` prints `*Messages cleared*`
and returns; it clears neither the TUI transcript nor any core state. A nudge that
tells the user to run it would be false advertising, so D1 cannot ship without this.

`/clear` must: clear the rendered transcript, start a fresh core session, and reset
the session-scoped counters (`resetSessionCacheTotals`, context meter). It is the
same reset path `sessionResume` already performs, minus the loading.

### D1 — Idle-return nudge

On submit, if the session has been idle beyond a threshold *and* carries more than a
token threshold, show a dismissible hint before sending:

```
~128.2k tokens will be re-sent as fresh input — the cache expired 82 min ago.
/clear to start a new task, or ignore this to continue.
```

Differences from claude-code, deliberate:

- **Hint only, never a blocking dialog.** A modal in front of a user who already
  knows what they are doing is worse than the tokens it saves.
- **Idle measured against the actual TTL**, reusing `cache-awareness.ts`, rather than
  a fixed 75 minutes — the number is already correct under `FREECODE_CACHE_TTL=1h`,
  and hardcoding 75 would contradict it.
- Thresholds via `FREECODE_IDLE_NUDGE_TOKENS` (default 100_000). `=0` disables.

### D2 — Cache-miss detector and invalidation journal

**Journal** (`apps/core/src/providers/cache-invalidation.ts`). A bounded ring of
`{ at, source, detail }`. Called by every site that knowingly changes the prefix:
compaction (`runCompaction`), history pruning when it re-applies a new replacement,
a system-prompt hook rewrite, and session resume.

**Detector** (`apps/core/src/providers/cache-miss.ts`). After each provider response,
compare reported usage against the previous call's baseline within the same
generation:

- Expected a read (baseline exists, generation unchanged) and got none → `expected_read_missing`
- Got a creation larger than the prefix growth → `unexpected_creation`

On a problem, look back over the journal within a short window:

- **Documented** → log at debug with the cause. Not a bug.
- **Undocumented** → emit a `cache_status` notice naming the affected tokens. This is
  the harness-bug alarm.

Generation increments on compaction, mirroring jcode's `cache_generation`, so the
rebuild that compaction *must* cause is never reported as a bust.

Off switch: `FREECODE_CACHE_MISS_NOTICES=0`.

#### D2.1 — One-sample deferral for provider blips (added 2026-09-06)

D2's first real catch was the harness itself: memory/todo/reminder blocks lived
in session *system* blocks rebuilt every inner-loop iteration, so any change
re-sent the entire conversation (reads collapsed to the static prefix — the
RC3/RC4 class, undocumented). Fixed by moving them to an ephemeral tail user
message appended after the cache anchors (`ExecuteOptions.ephemeralTail`; see
`docs/caching-architecture.md` §1.1).

The fix exposed a false-positive class: implicit provider caches miss for
non-rewrite reasons. Measured on MiniMax-M3 (eval session `ea079449`, turn 3):
read collapsed to 128, then the very next turn read *exactly the pre-miss
boundary* — only possible if the prefix bytes never changed. The cause is
provider-side (a write not yet committed when a rapid-fire inner-loop request
arrived, or eviction/routing), which the detector cannot distinguish from a
rewrite at the moment of the miss.

So an **undocumented** miss is now held for one sample (`PendingMiss` in
`cache-miss.ts`): if the next read recovers to at least the pre-miss cached
prefix, the old entry was provably still valid and the miss is dropped in
silence; otherwise the alarm fires, one sample late. A documented miss is
still attributed immediately. A pending miss with no follow-up sample
(session end, generation bump, cache fields absent) is dropped — it cannot be
verified, and an unverifiable alarm is the wolf-cry this detector exists to
avoid. A persistent rewrite bug keeps producing pendings, so it still
surfaces loudly; the trade accepted is that a *one-off* rewrite whose next
read happens to exceed the old prefix is forgiven once.

Known limit: a full provider-side eviction (read never recovers) is still
indistinguishable from a real rewrite and will alarm. The message wording
("this usually means something changed an already-sent message") stays honest
because after D2.1 the recovered blips — the common benign case — no longer
reach it.

## Out of scope

- Changing breakpoint placement. Four are in use, which is Anthropic's maximum; the
  token-efficiency spec already ruled this out and nothing here changes that.
- Non-Anthropic-shaped providers. Gemini and OpenAI report cache usage differently or
  not at all; the detector must no-op rather than guess when the fields are absent.
- Auto-clearing on idle. The whole point of D1 is that only the user knows whether the
  next message continues the old task.

## Testing

- **D0** — `/clear` empties the transcript, starts a new session id, and zeroes the
  session cache totals.
- **D1** — fires only when both thresholds are crossed; does not fire on a fresh
  session, on a small context, or twice without an intervening send;
  `FREECODE_IDLE_NUDGE_TOKENS=0` disables it.
- **D2** — the critical one, and it must assert *silence* as well as noise:
  - a normal warm turn produces no notice
  - a compaction-caused rebuild produces no notice (documented + generation bump)
  - an undocumented prefix change produces exactly one notice naming the tokens
    (one sample late, per D2.1)
  - a miss whose next read recovers to the pre-miss boundary produces no notice
  - a provider reporting no cache fields produces no notice

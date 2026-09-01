# OpenHands and FreeCode — what a survivable long session actually requires

> **Status:** Research comparison, not an implementation specification. No
> recommendation here is built. §"The best ideas to take" §1 documents a
> **live defect** in `apps/core/src/web/stream-subscribers.ts` that is worth
> fixing whether or not the rest is adopted.
> **Date:** 2026-09-01
> **Primary source:** `OpenHands/OpenHands` @ `ca4024e3a` (local:
> `~/Projects/githubProjects/agents/OpenHands`). **Read the caveat in
> §"What the source actually is" before trusting any claim about the OpenHands
> agent** — the local checkout is the frontend only.
> **Related FreeCode designs:** `specs/2026-08-10-agent-observability.md`,
> `specs/2026-08-10-autonomous-runs-design.md` (Phase 0 only),
> `specs/2026-08-26-trajectory-redirection.md` (built, off by default),
> `specs/2026-08-05-queued-messages-design.md` (shipped).

## Executive conclusion

OpenHands advertises long-running sessions. The mechanism is not a better agent
loop — it is a **strict separation between the durable conversation and the
client watching it**. The agent's state lives server-side in a persisted event
log; the frontend is a disposable viewer that re-derives its position from that
log on every reconnect. Nothing the user sees is load-bearing.

FreeCode has all the ingredients — `rollout/` event sourcing, durable sessions,
compaction, an SSE transport with `Last-Event-ID` — but wires them so that
**client liveness is still a dependency of session continuity**. Three specific
couplings cause this, and they are the whole of the recommendation:

```text
  OpenHands                          FreeCode today
  ─────────                          ──────────────
  replay anchor = persisted log      replay anchor = in-memory ring buffer
                                     that is freed when the last client leaves
  agent process outlives client      core is a piped child of the TUI
  stuck = terminal status            stuck = logger.debug, cap defaults ∞
```

The efficiency argument is secondary but real: work lost to a dropped client is
work paid for twice, and a loop that only ever warns is a loop you fund until
you happen to look at it.

**Where FreeCode is already ahead, and must not regress:** synchronous
compaction accounting (§4), queued-message handling (§"Deliberate
non-adoptions"), and the cost/trace observability in `rollout/`. OpenHands has
nothing equivalent to `freecode trace`.

## What the source actually is

The local checkout is **only the Agent Canvas frontend** (React/TypeScript). Its
own `AGENTS.md` is explicit: OpenHands is a four-repo system and this is one
piece.

| Repo | Owns | Present locally |
| --- | --- | --- |
| `OpenHands/OpenHands` | Agent Canvas frontend: UI, routes, `src/api/` services that *consume* backend APIs | **yes** |
| `OpenHands/software-agent-sdk` | Python SDK + agent-server: agents, tools, conversations, events, **the condenser**, the REST/WS API surface | no |
| `OpenHands/typescript-client` | Generated TS client mirroring the agent-server API | no (npm dep) |
| `OpenHands/automation` | Automation scheduling, webhooks, run history | no |

This constrains what can be claimed. The condenser's *algorithm* is not
readable here. What **is** readable, and what this document is built on, is the
**contract** between the two halves: event shapes (`src/types/agent-server/core/events/`),
conversation lifecycle statuses, the REST/WS reattachment protocol, and the
launch payload (`src/api/agent-server-adapter.ts`). A contract constrains the
implementation behind it, so inferences drawn from it are sound — but they are
inferences, and are marked as such below.

## Current fit in FreeCode

| OpenHands element | FreeCode equivalent | Status |
| --- | --- | --- |
| Persisted conversation event log | `rollout/recorder.ts`, `rollout/history.ts` | **Implemented.** Richer than OpenHands' — it carries cost, spans, and denials. |
| Event log is queryable by cursor/time | `events/search` with `page_id`, `timestamp__gte`, `sort_order` | **Missing.** `history.ts` exposes `loadSessionEvents` (whole file), `getEventsByType`, `getEventCount`. No range query, no cursor. |
| Client reattaches by anchor | SSE `Last-Event-ID` → `replayForSubscriber` | **Partial, and defective.** See §1. |
| Agent outlives the client | — | **Missing** on the stdio path; core is a piped child (`apps/tui/src/ipc/client.ts:177`). |
| `stuck` as terminal execution status | `effect/loop-health.ts` | **Missing.** All four detectors return `warn`. |
| Always-on iteration ceiling | `maxIterations` | **Partial.** Defaults to `Infinity` outside headless (`agent/loop.ts:403`). |
| Compaction recorded as an event | `compact.occurred` (`rollout/types.ts:125`) | **Implemented**, but records magnitude only — not *what* was dropped. |
| Compaction preserves the head | `summary_offset` in `CondensationEvent` | **Missing.** `selector.ts:54` summarizes from index 0. |
| Blocked-on-human as durable state | `waiting_for_confirmation` | **Missing.** Permission prompts are in-band and synchronous. |
| Queue messages while agent is busy | `session.dequeue`, FIFO drain, `message_queued` | **Implemented.** Parity. |

---

## The best ideas to take

### 1. Anchor replay to the persisted log, not to an in-memory buffer

**This section documents a live bug, not just a design gap.**

OpenHands' client never treats a socket as durable. On entering a conversation
it: (a) loads history over REST, paginated by `next_page_id` and filterable by
`timestamp__gte`/`timestamp__lt` (`src/api/event-service/event-service.api.ts`);
(b) takes the newest event's timestamp as an anchor
(`conversation-websocket-context.tsx:365`); (c) *then* opens the WebSocket with
`resend_mode='since'&after_timestamp=<anchor>`, degrading to `resend_mode='all'`
if the history load failed. Durability is a property of the log. The socket is a
tail, and losing it costs nothing.

FreeCode makes an in-memory ring buffer the **sole** source of replay, and frees
it the moment the last subscriber leaves:

```ts
// apps/core/src/web/stream-subscribers.ts:265
function tearDownIfEmpty(sessionId: string): void {
  const rec = sessions.get(sessionId);
  if (!rec) return;
  if (rec.subscribers.size === 0) {
    rec.buffer.dispose();
    sessions.delete(sessionId);
  }
}
```

With a single browser client — the normal case — closing the lid drops the only
subscriber, `removeSubscriber` (`:108`) calls `tearDownIfEmpty`, and the session
record is deleted. On reconnect with a `Last-Event-ID`, replay hits:

```ts
// apps/core/src/web/stream-subscribers.ts:175
if (!rec) return { gap: false, from: 0, to: 0, events: [] };
```

An **empty, gap-free** result. The client is told it is caught up and silently
loses every event produced while it was away. It does not even get the
`stream_gap` marker, because the gap branch in `replayToSubscriber` needs the
record that was just deleted. The comment on `publishToSession` — "Even if no
subscribers are listening, the buffer preserves the event for a future
reconnect" — is only true while some *other* subscriber holds the record alive.

Note this is strictly worse than eviction: an over-long disconnect that
overflowed the 1000-event / 4 MB bound (`stream-buffer.ts:40`) would at least
have reported a gap.

**How to close.** Two changes, independently useful:

1. *Cheap.* Decouple record lifetime from subscriber count — keep the record on
   a TTL after the last subscriber leaves, so a short disconnect replays exactly
   as designed and a long one reports an honest gap.
2. *Correct.* Fall back to `rollout/` when the buffer cannot serve the requested
   seq. This needs two things FreeCode does not have: a **range query** on
   `history.ts` (cursor or timestamp, mirroring `events/search`), and a
   **projection from `RolloutEvent` to `StreamEvent`**, since the rollout log
   deliberately stores no message bodies. That second constraint is real and
   load-bearing — OTLP export must stay leak-free — so the projection is
   lossy by design and the gap marker still matters for text deltas.

### 2. Make `stuck` a terminal state, and give every run a ceiling

OpenHands starts every conversation with `stuck_detection: true` unconditionally
and `max_iterations: 500` as the default
(`src/api/agent-server-adapter.ts:1162`). `stuck` is a first-class
`execution_status` (`src/types/agent-server/core/base/common.ts:74`) that the
UI renders as a distinct state, alongside `paused`,
`waiting_for_confirmation`, `finished`, and `error`.

FreeCode's `effect/loop-health.ts` declares `LoopAction { continue | warn | stop }`
and then returns `warn` from **all four** detectors — `repeated_identical_tool`
(`:38`), `no_progress` (`:44`), `oscillation_detected` (`:53`),
`repeated_reasoning` (`:62`). `stop` is never produced. The only hard stop is
the iteration cap, which is:

```ts
// apps/core/src/agent/loop.ts:403
maxIterations: config?.maxIterations ?? Infinity,
```

Infinite outside headless invocations. For an attended session that is the right
default — a human is watching, and `2026-08-26-trajectory-redirection.md` §1
already documents why premature `stop` was the wrong answer. The gap is that
FreeCode has **no configuration in which a stuck loop stops on its own**. The
budget ceiling in `autonomous/budget.ts` bounds spend, not futility, and
`autonomous/` does not execute anything yet.

**How to close.** Not by flipping the detectors to `stop` — that reintroduces
the failure trajectory-redirection was built to avoid. Rather: a *finite default
ceiling* for unattended runs, and a `stuck` terminal state distinct from `error`
so an autonomous run's `report.md` can say "stopped making progress" instead of
"crashed". This is a prerequisite for `autonomous/` Phase 1, not a change to
attended behaviour.

### 3. Record what compaction dropped, and stop summarizing the head

`CondensationEvent`
(`src/types/agent-server/core/events/condensation-event.ts`) carries three
fields FreeCode's equivalent does not:

```ts
forgotten_event_ids: EventID[];   // exactly which events left the LLM's view
summary?: string;
summary_offset?: number;          // where the summary is spliced in
```

The comment on `forgotten_event_ids` is the important part: *"removed from the
View given to the LLM"*. The log is not rewritten. The prompt is a **fold of
condensations over an append-only log**, which makes compaction replayable,
auditable, and renderable — a UI can show "42 events collapsed here" and expand
it.

Two consequences for FreeCode:

**3a. `compact.occurred` records magnitude, not content.**

```ts
// apps/core/src/rollout/types.ts:125
export interface CompactOccurredEvent extends BaseEvent {
  type: "compact.occurred";
  beforeTokens: number;
  afterTokens: number;
}
```

You can see that 40K tokens vanished; you cannot see *which*. When a long
session's model "forgets" something, this is the first thing you would want from
`freecode trace`, and it is not there. Adding the dropped ids is close to free —
they are already known at the call site — and costs no message bodies, so the
OTLP leak-free constraint holds.

**3b. `summary_offset` implies a head-preserving condenser; FreeCode's is
tail-only.** *(Inference — the SDK is not readable locally. The field's
existence establishes that the summary is spliced at a non-zero position, which
only makes sense if something precedes it.)*

FreeCode's selector preserves the **tail**, defined as the last
`preserveRecentTurns: 2` user turns capped at `maxPreserveRecentTokens: 8_000`
(`compaction/types.ts:62-63`), and summarizes everything before it:

```ts
// apps/core/src/compaction/selector.ts:54
const summarize = messages.slice(0, Math.max(0, firstPreservedIndex));
```

Nothing is carved out for the head. In a long session this means the **original
task statement is summarized away on the first compaction**, and on the second
compaction the previous summary is itself re-summarized — lossy compounding,
with the founding instruction degrading fastest because it is oldest. This is a
plausible mechanism for the classic long-session failure where an agent slowly
drifts off the original brief. Preserving the first user turn verbatim is a
small change to `selectForCompaction` with a large effect on long-session
fidelity.

### 4. Do not copy their compaction accounting — yours is better

Recorded so nobody "fixes" this in the wrong direction. OpenHands' `/condense`
HTTP call acks only that work *started*, so the frontend needs a 150-line hook
(`src/hooks/use-await-context-compaction.ts`) that subscribes to the event
store, waits for a `Condensation` event, then waits a further 2.5 s settle
window for `per_turn_token` to drop, with a 90 s timeout and three outcomes
(`compacted` / `no_change` / `timeout`).

FreeCode's `session.compact` already returns the measured result synchronously:

```ts
// packages/shared/src/ipc/protocol.ts:244
"session.compact": {
  params: { sessionId: "" },
  result: {} as { compacted: boolean; tokensBefore: number; tokensAfter: number; reason?: string },
},
```

That is the same information without the race. Keep it.

### 5. Cheap reconnect hygiene, worth copying close to verbatim

From `src/hooks/use-websocket.ts` and `conversation-websocket-context.tsx`.
These are small, and each encodes a bug someone already paid for:

- **Backoff 1 s → 2 s → 4 s, capped at 30 s** (`use-websocket.ts:19`). FreeCode's
  TUI respawn budget is `[250, 1_000, 3_000]` then permanent give-up
  (`apps/tui/src/ipc/client.ts:87`) — appropriate for a local child process,
  but the SSE client needs the capped-and-unbounded form instead.
- **Handshake watchdog** aborting sockets stuck in `CONNECTING`
  (`use-websocket.ts:61`) — otherwise they hold the browser's per-host handshake
  lock indefinitely.
- **Dedupe replayed events by id *and* skip non-idempotent side effects on the
  duplicates** (`conversation-websocket-context.tsx:553`). Their issue #1656:
  replay re-fired error banners and cache invalidations. Any FreeCode replay
  path inherits this hazard the moment §1 is fixed.
- **Gate socket-open on the first history load, explicitly not on background
  refetches** (`conversation-websocket-context.tsx:376`). They had a
  refetch → teardown → reconnect → refetch loop that hung conversations at
  "Connecting" for minutes.

### 6. Blocked-on-a-human as a durable state

OpenHands models permission as `waiting_for_confirmation` — a persisted
conversation status plus a REST endpoint (`respondToConfirmation`) — so an agent
can sit blocked for hours across a client restart, and the run resumes rather
than fails.

FreeCode's permission prompts are in-band and synchronous, which is correct and
lower-friction for attended use. The gap is unattended: a run that hits a prompt
with nobody watching cannot park. Relevant only when `autonomous/` Phase 1 is
built; listed here so the design does not have to rediscover it.

---

## Recommended sequencing

Ordered by (value ÷ risk), not by ambition. Each step is independently
shippable.

1. **Fix the replay teardown** (§1, change 1). Contained blast radius, one
   module, restores the behaviour `Last-Event-ID` already promises. Needs a test
   asserting that a reconnect after the last subscriber leaves replays or
   reports a gap — never silent success.
2. **Preserve the first user turn through compaction** (§3b). Small diff in
   `selectForCompaction`, measurable on the eval suite, directly improves long
   sessions.
3. **Add `forgotten` ids to `compact.occurred`** (§3a) and surface them in
   `freecode trace`. Observability first — it is what makes step 4 assessable.
4. **Range query on `rollout/history.ts` + the `RolloutEvent → StreamEvent`
   projection** (§1, change 2). The largest piece; do it only once steps 1–3
   have shown the seam is worth widening.
5. **Reconnect hygiene** (§5) alongside step 4 — the dedupe-on-replay rule
   becomes load-bearing exactly when rollout-backed replay lands.
6. **`stuck` terminal state + finite unattended ceiling** (§2), and **durable
   permission park** (§6), as part of `autonomous/` Phase 1. Not before —
   both are unattended-mode concerns, and neither should change attended
   defaults.

Detaching core from the TUI process is deliberately **not** in this list. It is
the largest change implied by §"Executive conclusion", it touches the
process model rather than a module, and steps 1–4 deliver most of the
durability benefit without it. Revisit once they land.

## Deliberate non-adoptions

- **ACP and the multi-backend registry.** Canvas is a universal frontend for
  other people's agents; that is its product, not FreeCode's. Adopting ACP means
  taking on a protocol to solve a problem FreeCode does not have — its frontends
  and backend ship together.
- **Automations / scheduling.** Lives in a repo not present locally, and is
  cron-with-a-UI rather than a long-session mechanism. Whatever `autonomous/`
  needs here should be designed against its own spec.
- **Their compaction acknowledgement protocol.** §4. FreeCode's is better.
- **Message queueing.** Already shipped —
  `specs/2026-08-05-queued-messages-design.md`, `session.dequeue`,
  `message_queued`.
- **Mapping `stuck` onto `error`.** Canvas itself does this
  (`src/hooks/use-agent-state.ts:31`, commented "for now") and it is the wrong
  end state to copy: it discards the distinction between *crashed* and *stopped
  making progress*, which is the one thing an unattended run's report most needs
  to say.

## Decision

Adopt §1 (both changes), §3 (both changes), and §5. Defer §2 and §6 to
`autonomous/` Phase 1. Reject the non-adoptions above.

§1 change 1 is a bug fix and does not need a spec. §1 change 2 and §3 are large
enough to want one; if they proceed, they belong in a single spec covering the
durable-replay seam, since the range query and the `forgotten` ids are the same
question asked of the same log.

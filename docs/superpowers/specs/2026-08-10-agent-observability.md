# Agent Observability — model-call tracing, stall detection, OTLP export

**Status:** implemented (§3–§6); §7 deferred
**Date:** 2026-08-10
**Supersedes:** nothing. Extends `rollout/` (event sourcing) rather than replacing it.

---

## 1. Motivation

Session `792889da` ran for 34 minutes, executed 27 tool calls totalling **under
one second** of work, and produced 10,178 output tokens across the whole day.
The remaining ~31 minutes went somewhere the system could not name.

The rollout log had twelve event types covering tools, hooks, skills,
subagents, compaction and parse errors — and none for the provider round trip.
The slowest and most failure-prone step in the loop was the one step that left
no trace. Concretely, three failures compounded:

1. **No duration bound.** Providers received an `abortSignal` and
   `PROVIDER_MAX_RETRIES = 0`, but nothing bounded how long a request could
   take. A provider that accepted the connection and went silent parked the
   loop indefinitely.
2. **No event.** A hang produced no log line at all. In the log it was
   indistinguishable from a turn that simply ended.
3. **No signal to loop-health.** `effect/loop-health.ts` watches for repeated
   tool calls and stagnant turns — patterns that occur *between* model calls. A
   call that never returns generates nothing for it to evaluate.

The user-visible symptom was misleading: the TUI showed the last thing that
emitted an event, so a hung provider call rendered as "stuck on `todowrite`".

## 2. Goals / non-goals

**Goals.** Attribute every second of a session to model, tool, or idle. Make an
unterminated request self-evident in the log. Bound provider silence. Let the
same data reach an external trace UI when one is wanted.

**Non-goals.** Prompt/completion *content* capture (the log records sizes and
token counts, not message bodies — see §6). A hosted service dependency.
Replacing `usage.json` for cost accounting.

## 3. Model call events

Four additions to `RolloutEvent` (`rollout/types.ts`), written by
`RolloutRecorder` around the provider call in `AgentLoop.callProviderOnce`:

| Event               | Written                | Carries                                                         |
| ------------------- | ---------------------- | --------------------------------------------------------------- |
| `model.request`     | **before** the call    | provider, model, messageCount, toolCount, promptChars, streamed  |
| `model.first_token` | on the first chunk     | ttft_ms                                                          |
| `model.response`    | on success             | duration_ms, ttft_ms, token counts, tool call names, text sizes  |
| `model.error`       | on failure             | duration_ms, kind (`stall`/`abort`/`provider`), message          |

**The load-bearing decision is that `model.request` is written before the
call.** A request with no matching terminator *is* the hang — the diagnosis is
an absence, and an absence is only detectable if the opening line was recorded
first. Everything in §5 follows from that asymmetry.

`RecordOptions.fields` was added to `recorder.ts` as an escape hatch: model
events carry a dozen fields that mean nothing to any other event type, and
threading each through the existing whitelist would double its length to
describe a shape one caller uses.

`promptChars` is a character count, not a token estimate. It exists to make
runaway context growth visible turn-over-turn, and a cheap comparable number
beats an expensive precise one — `JSON.stringify` over a 100KB prompt every
turn is not worth it.

## 4. Stall guard

`providers/stall-guard.ts`. **The bound is on silence, not on total time**: a
long reasoning turn that keeps emitting thinking deltas is healthy and must not
be killed; a stream that says nothing for a minute is not.

| Budget                                | Default | Env                                   |
| ------------------------------------- | ------- | ------------------------------------- |
| First chunk                           | 120s    | `FREECODE_FIRST_CHUNK_TIMEOUT_MS`     |
| Gap between chunks                    | 60s     | `FREECODE_STREAM_STALL_TIMEOUT_MS`    |
| Whole call (non-streaming `execute`)  | 300s    | `FREECODE_REQUEST_TIMEOUT_MS`         |

`0` disables any of them. `withStallTimeout` races `iterator.next()` against a
timer; on expiry it invokes `onStall` — which the loop uses to abort a
per-call `AbortController` chained to the session's via `linkAbort` — and
throws `ProviderStallError`.

Two subtleties worth preserving:

- **The iterator close is best-effort and deliberately not awaited.**
  `return()` on an async generator parked inside an `await` does not settle
  until that await does. Awaiting it when a provider has gone silent would hang
  in the cleanup path — reintroducing the exact bug. What actually kills a live
  request is the abort signal, not the close.
- **`linkAbort` rather than `AbortSignal.any`.** The latter landed in Node 20;
  the package declares `node >=18`.

Retries remain owned by `RecoveryManager`, which treats a stall as transient
and retries it — so a genuinely dead endpoint now fails after roughly
`3 × 120s` rather than never. That is the existing recovery policy, not a
decision made here; see §8.

## 5. Trace assembly and CLI

`rollout/trace.ts` (pure fold, no IO) pairs requests with their terminators.
Anything still open at the end is `status: "hung"`, aged against the clock.
Pairing prefers matching `turnId` but falls back to the oldest open span,
because turn numbering restarts at `turn-0` on resume and a mismatch must not
orphan a real response into a phantom hang.

`rollout/trace-render.ts` renders a waterfall plus a where-the-time-went
breakdown (model / tools / other). When a log contains no model events at all
it says so explicitly rather than reporting "no hangs" — silence there means
nothing was recorded, not that nothing went wrong.

```
freecode trace                 # most recent session
freecode trace <id> --follow   # live, 1s redraw — watch a hang happen
freecode trace <id> --slow 30000
freecode trace --list
freecode trace <id> --json
```

## 6. OTLP export

`rollout/otlp.ts`, wired as `freecode trace <id> --otlp [url]`, falling back to
`OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS`. Works with
Langfuse, Phoenix, Jaeger, Tempo, or any OTLP/HTTP collector. Attributes follow
the OpenTelemetry GenAI semantic conventions (`gen_ai.system`,
`gen_ai.request.model`, `gen_ai.usage.*`), which is what makes the spans render
as LLM calls rather than anonymous blobs.

Two constraints:

- **Exported from the log, not the hot path.** An exporter inside the agent
  loop is one more thing that can block, buffer, or throw inside the request
  we are trying to make faster. The log is already durable; shipping from it is
  strictly safer and costs only immediacy.
- **No SDK dependency.** OTLP/HTTP accepts plain JSON, so the exporter is a
  `fetch` and a shape. Span IDs are content-derived so re-export is idempotent.

Because export reads the rollout log, and the log records sizes rather than
message bodies, **no prompt or completion text leaves the machine.** That is a
property of what §3 chose to record, and should be treated as load-bearing if
content capture is ever added.

## 7. Deferred

- **Live OTLP streaming** during a run. The batch path covers post-mortem;
  `--follow` covers live locally.
- **TUI panel.** `/trace` rendering the same waterfall in-app.
- **Prompt/completion capture** behind an explicit opt-in, with the
  secret-filtering that `memory/graph/secret-filter.ts` already implements.
- **Feeding stalls to `loop-health`** so the loop can adapt (e.g. suggest a
  provider switch) rather than only retrying.

## 8. Known follow-up

`RecoveryManager` retries a stall like any transient error. With a 120s
first-chunk budget that is ~6 minutes before a dead endpoint gives up. Whether
a stall should be retried fewer times than a 429 is a policy question left
open here rather than decided silently.

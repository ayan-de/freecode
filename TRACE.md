# Trace — command reference

> Operator's guide to `freecode trace`: what each flag does, how to read the
> output, and which question each mode answers. Design lives in
> `docs/superpowers/specs/2026-08-10-agent-observability.md`; this is the
> "what do I type" page.

`freecode trace` answers **"why was this session slow"** and **"why is it
stuck"** from the append-only rollout log alone — no live process to attach to,
nothing to enable first. Every session already writes one.

| Thing | Where |
| --- | --- |
| Event log | `~/.freecode/rollout/sessions/<id>/events.jsonl` |
| Fold (pure, no IO) | `apps/core/src/rollout/trace.ts` — `buildTrace()` |
| Rendering | `apps/core/src/rollout/trace-render.ts` |
| OTLP export | `apps/core/src/rollout/otlp.ts` — OTLP/HTTP JSON, no SDK dependency |
| CLI | `apps/core/src/cli/commands/trace.ts` |

The log **deliberately carries no message bodies** — no prompts, no
completions. That is what keeps the OTLP export leak-free, and it is why eval
scorers take their text from the caller rather than from here.

---

## 1. Read a trace — `freecode trace [sessionId]`

```bash
freecode trace                    # the most recent session
freecode trace abc123def
freecode trace --list             # what's on disk
```

Omitting `sessionId` picks the **most recently written rollout log by mtime**,
which is nearly always the one in question — but it is file mtime, not session
start, so a resumed old session can win.

| Flag | Does what |
| --- | --- |
| `[sessionId]` | session to trace; defaults to the most recent |
| `--follow, -f` | full redraw once a second against the wall clock — the only way to watch a hang happen |
| `--slow N` | hide model calls faster than N ms |
| `--tools` | include the per-tool waterfall rows. **Default true**; `--no-tools` turns it off |
| `--json` | emit the assembled `Trace` as JSON |
| `--list` | list recorded sessions instead of tracing one |
| `--otlp [url]` | ship the trace to a collector; empty value falls back to `$OTEL_EXPORTER_OTLP_ENDPOINT` |

### Flags that quietly override each other

These are all reasonable in isolation and surprising in combination:

- **`--slow N` suppresses the entire tool waterfall, and the denial rows with
  it.** The tool block is gated on `threshold === 0`, so `--slow 2000 --tools`
  shows model calls only. Run it twice if you want both views.
- **`--json` ignores `--slow` and `--tools`** — it serialises the whole `Trace`
  before rendering is ever considered. Filter downstream with `jq`.
- **`--list` returns before anything else runs.** It ignores the session id and
  every other flag.
- **`--otlp` returns before rendering.** It exports and prints one line; it
  never draws the waterfall, and it does not combine with `--follow` (there is
  no live streaming path — §7 of the spec defers it).

## 2. Reading the output

```
session abc123de  anthropic/claude-opus-5   4m12s wall

14:22:01    3.1s  model   ...
14:22:04   12.0s  tool    read
14:22:16       —  deny    write (mode) plan mode refuses a mutating tool
...

where the time went
  model      3m40s   87%   14 calls
  tools        18s    7%   9 calls, 1 denied
  other        14s    6%   user input, idle
  tokens  in=48.2k out=6.1k cached=31.0k
  cost    $0.42 (est., prices as of …)

no hangs, no model errors
```

**The verdict line at the bottom is the diagnosis.** Five possible states, and
two of them are easy to misread:

| Line | Means |
| --- | --- |
| `no hangs, no model errors` (green) | healthy |
| `N request(s) open for over 5m` (red) | **hung on the provider, not on a tool** |
| `N model call(s) failed` (yellow) | errored spans — check `errorKind`: `stall`, `abort`, or `provider` |
| `a request is in flight` (cyan) | **not a fault.** Normal under `--follow`; still within budget |
| `no model calls recorded` (yellow) | **not a healthy session.** The log predates model tracing, so every gap above is unattributed |

Other things the render will and won't say:

- **A refused tool call shows as a `deny` row with no duration**, and appears
  *unconditionally* within the tool block — a refusal took no time, so a
  duration threshold would hide exactly the turns that explain a session where
  nothing got done. It is folded into `Trace.deniedSpans` and **never** into
  `toolSpans`, which means "tools that ran" and has seven consumers depending
  on that.
- **The cost line is silent when nothing in the session is priced.** An
  unpriced model shows no line at all, because `cost $0.00` reads as free. A
  `*` marks a partially-priced trace.
- **The redirect line only appears when something fired.** `redirects 0` on
  every healthy session is noise, and the feature is off by default.
- **`echoedModel` vs `model`** — what the provider said it served vs what we
  asked for. Only a disagreement when `echoedModel` is set; absent when the
  provider said nothing, the call errored, or the span is still open.

## 3. Hang vs in-flight — the threshold

`HANG_THRESHOLD_MS = 300_000` (5 minutes). An unterminated `model.request` is
called **`in_flight`** below it and **`hung`** above.

The threshold matches the header timeout in `providers/fetch-timeout.ts`: past
that point the request should already have been killed, so if it is still open
something is genuinely wrong. Without it, every in-flight call rendered as HUNG
the moment `--follow` drew it and then "recovered" when the response landed —
a race against the redraw, not a diagnosis.

`model.request` is written **before** the call, on purpose. An unterminated
request is itself the evidence of a hang; there is nothing else to find.

Related timeouts, which live at the fetch layer and not above
`normalizeAiSdkStream` (moving them up drops `tool-input-delta`, and a large
tool call then looks like a dead stream):

```bash
FREECODE_HEADER_TIMEOUT_MS=300000     # response headers; 0 disables
FREECODE_SSE_STALL_TIMEOUT_MS=180000  # silence on a live SSE stream; 0 disables
```

## 4. Export — `--otlp`

```bash
freecode trace abc123 --otlp http://localhost:4318
freecode trace abc123 --otlp                        # uses $OTEL_EXPORTER_OTLP_ENDPOINT
```

OTLP/HTTP JSON, exported **from the log, not the hot path** — a collector being
down cannot affect a run. Works with Langfuse, Phoenix, Jaeger, or anything
else speaking OTLP.

```bash
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=...   # takes precedence
OTEL_EXPORTER_OTLP_ENDPOINT=...          # fallback
OTEL_EXPORTER_OTLP_HEADERS="k=v,k2=v2"   # comma-separated, per spec
```

`/v1/traces` is appended to the endpoint if it isn't already there.

Shape: the root span is **`invoke_agent`**, with `gen_ai.conversation.id` on
every span. `attrs()` rounds numerics to ints **except** an explicit
`FRACTIONAL` set (cost, score) — **adding a rate outside that set silently
reports 0.5 as 1.**

The eval harness has its own `--otlp` (`apps/core/src/eval/otlp.ts`) that ships
*scores* linked to the traces that produced them. See `EVAL.md`.

## 5. Adjacent

```bash
freecode session list             # sessions from the session store
freecode session delete <id>      # rollout log lives separately, under ~/.freecode/rollout
freecode eval add <session-id>    # turn a traced session into an eval case — EVAL.md
```

---

## Which mode answers which question

| Question | Command |
| --- | --- |
| Why was that turn slow? | `freecode trace` — read the "where the time went" block first |
| It's hanging *right now* | `freecode trace --follow` — watch for `in_flight` aging past 5m |
| Which model call is the expensive one? | `freecode trace --slow 5000` (drops the tool noise) |
| The agent did nothing — why? | `freecode trace` and look for `deny` rows; a mode-blocked call leaves no `toolSpans` entry |
| Did redirection fire? | `freecode trace` — the `redirect fired=/skipped=` line, present only when nonzero |
| What did the provider actually serve? | `freecode trace --json \| jq '.modelSpans[].echoedModel'` |
| Which session was that? | `freecode trace --list` |
| I want this in Langfuse/Phoenix | `freecode trace <id> --otlp <url>` |
| Is my token/cost accounting right? | `--json`, then check `inputTokens` / `cacheReadTokens` — a cache read is a **discount off the inclusive `inputTokens`, not an addend** |

## What is not built

From the observability spec §7, deferred on purpose:

1. **Live OTLP streaming** during a run. The batch path covers post-mortem;
   `--follow` covers live, locally.
2. **A TUI panel** — `/trace` rendering the same waterfall in-app.
3. **Prompt/completion capture**, which would need an explicit opt-in plus the
   secret filtering that `memory/graph/secret-filter.ts` already implements.
4. **Feeding stalls to `loop-health`**, so the loop could adapt (suggest a
   provider switch) rather than only retrying.

Known follow-up (§8): `RecoveryManager` retries a stall like any transient
error. With a 120s first-chunk budget that is ~6 minutes before a dead endpoint
gives up. Whether a stall should be retried fewer times than a 429 is an open
policy question, left open rather than decided silently.

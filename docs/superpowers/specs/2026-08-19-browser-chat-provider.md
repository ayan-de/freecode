# Browser Chat Provider Design

## Status: Proposed (pending implementation)

Decisions taken 2026-08-19: transport is **Playwright over CDP** first; first site is
**claude.ai**; the browser-extension transport is deferred behind the same interface.

---

## Overview

Drive a logged-in chat website (claude.ai first, chatgpt.com next) as if it were an API
provider, so a FreeCode session can run on a flat-rate subscription instead of metered API
keys. This is the project's differentiating feature.

The whole design rests on one difference:

| | API mode (today) | Browser mode (this spec) |
| --- | --- | --- |
| Who holds the conversation | we do — every call re-sends all messages | **the website does** — it owns a thread |
| Per-turn payload | system + tools + full history | **only the new message** |
| Cost shape | grows ~n² | flat per turn |
| Tool calling | native structured JSON | **absent** — emulated over text |
| Limits | computable token counts | opaque; only UI/stream signals |
| Failure mode | HTTP status code | a selector moved |

Everything below follows from that table.

### Non-goals

- **No anti-detection work.** No fingerprint spoofing, CAPTCHA solving, proxy rotation, or
  header forgery. We attach to the user's own real browser and behave like a fast human.
  If a site blocks that, the answer is "browser mode does not work here", not evasion.
- No headless/unattended operation as the primary path. The browser is visible by default.
- No new frontend surface. Browser mode is a provider id; the TUI renders it unchanged.

### Known risk, accepted by the user

Automating claude.ai / chatgpt.com is against those sites' terms of service; the realistic
consequence is rate limiting or suspension of the user's own account. Recorded here so it
is not rediscovered later.

---

## Prior art in this repo

`apps/core/src/browser/` (249 lines) is **orphaned** — nothing outside that folder imports
it. It connects over CDP, types into a textbox, and polls rendered DOM text
(`controller.ts:100-116`). It has no tool calling and does not implement `AIProvider`.

It is superseded by this spec at Phase 2 and should be deleted then, not extended.
`playwright` is already a dependency (`apps/core/package.json:38`).

---

## Architecture

### Two axes, deliberately separated

```
  WHAT to do on a site  →  sites/claude.ts, sites/chatgpt.ts   (churns on redesigns)
  HOW to reach the page →  transport/cdp.ts, transport/extension.ts (stable)
```

Both transports inject **the same in-page bridge script** (`transport/inject.ts`), so the
extension transport is later a ~100-line addition, not a rewrite.

### Send via DOM, receive via network

Reading rendered HTML mangles code blocks (indentation, nested fences, "Copy code" button
text) and forces sleep-polling. Instead the injected bridge patches `window.fetch` and
forwards the page's own streaming response chunks back to core. This yields:

- the **raw markdown the model produced**, not a DOM re-render of it;
- **real incremental deltas** → mapped straight to `ProviderChunk.text_delta`;
- resilience — *a bet, not a fact*: a redesign moves selectors, but the site's own data
  stream is expected to change less often. Held honest by the inline shape check below.

Typing the prompt still goes through the composer DOM — it is the human-shaped path and
avoids having to reconstruct request signing/auth payloads ourselves.

### Directory structure

```
apps/core/src/browser-chat/
├── index.ts              # register() — the ONLY symbol core imports
├── provider.ts           # BrowserChatProvider implements AIProvider (stream + execute)
├── thread.ts             # per-session thread: tab handle, cursor, bootstrap/rebootstrap
├── config.ts             # reads the `browser` block from ~/.freecode/config.json
├── protocol/
│   ├── encode.ts         # ToolDef[] + Message[] → the text we type
│   ├── parse.ts          # reply markdown → { text, toolCalls[] }
│   └── repair.ts         # protocol-violation retry message + attempt budget
├── transport/
│   ├── types.ts          # BrowserTransport interface
│   ├── cdp.ts            # Playwright connectOverCDP implementation
│   └── inject.ts         # in-page bridge script (shared with a future extension)
├── sites/
│   ├── types.ts          # SiteAdapter interface
│   └── claude.ts         # claude.ai
├── limits/
│   ├── meter.ts          # chars in/out, turn count, thread budget estimate
│   └── detect.ts         # stream/DOM signals → typed LimitEvent
└── cache/
    └── ledger.ts         # hash of tool results already delivered on this thread
```

Every file stays under the repo's ~150-line guidance; `provider.ts` and `thread.ts` are the
two that need watching.

---

## Integration surface (the whole delink story)

One optional dynamic import in `providers/registry.ts:36`:

```ts
await Promise.all([
  import("./anthropic.js"),
  // …
  import("../browser-chat/index.js").catch(() => {}), // absent module ⇒ no browser providers
]);
```

**Registration must be metadata-only.** `browser-chat/index.ts` may not import `playwright`,
`transport/`, or `provider.ts` at module top level — it registers a `ProviderDefinition`
whose `create()` performs the dynamic import on first use:

```ts
registerProvider("browser:claude", {
  info: { id: "browser:claude", /* static metadata only */ },
  create: () => lazyProvider("claude"), // dynamic import("./provider.js") inside
});
```

This is load-bearing, not stylistic: `initProviders()` runs on **every** cold start, so a
top-level Playwright import would put the browser stack into the startup path of every
session whether or not browser mode is ever used. Phase 0's verification must measure cold
start with the module present and confirm it is unchanged.

Consequence, accepted: with lazy loading we cannot know at registration time whether
`playwright` is installed, so browser providers always appear in `providers.list` and fail
on first use with an actionable message ("browser mode requires playwright: `pnpm add -w
playwright`"). `browser doctor` checks resolvability up front so this is diagnosed rather
than discovered mid-turn.

`playwright` moves to an **optional dependency** (same pattern as the memory graph's ONNX
embedder).

**Delink points (2, as of Phase 1):**

| File | Line |
| --- | --- |
| `providers/registry.ts` | `import("../browser-chat/index.js").catch(() => {})` |
| `cli/create-cli.ts` | `import { browserCommand }` + `.command(browserCommand)` |

Deleting `browser-chat/` plus those removes the feature with no other edits — verified by
typecheck. Both import sites are metadata-only at module scope: `browser-chat/cli.ts`
holds type-only imports and lazy handlers, so `freecode --help` never touches the
transport.

**Delinking is a two-step operation, deliberately.** The specifier stays a static string
literal, so `tsc` resolves it and deleting the folder *alone* fails the build
(`TS2307`). The alternative — a variable specifier TypeScript cannot check — would let the
folder vanish silently, but it would equally hide a typo'd path or a moved file as a
permanent silent no-op, with browser mode simply never registering and nothing anywhere
saying so. A loud two-step removal beats a quiet one-step failure mode.

Provider ids are `browser:claude` and `browser:chatgpt`. `ProviderId` is already `string`
(`providers/config.ts:45`) and `getProvider` calls `def.create("")`
(`providers/registry.ts:24`), so **no API-key plumbing is needed**.

### Why the agent loop needs no changes

`BrowserChatProvider` implements `AIProvider` (`providers/types.ts:117`) and returns the
same `ExecuteResult` / `ProviderChunk` shapes as `anthropic.ts`. The tool-call emulation is
entirely inside the provider: it renders `ToolDef[]` into the bootstrap text and parses the
model's reply back into `toolCalls[]`. Therefore permissions, hooks, todos, subagents,
rollout recording, and TUI rendering all work untouched.

`loop.ts` is not to learn that a browser exists.

---

## Core types

### `transport/types.ts`

```ts
export interface BrowserTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Open a fresh chat thread on the given site; returns an opaque handle. */
  openThread(site: SiteAdapter): Promise<ThreadHandle>;
  /** Type + submit one message. Resolves once the request has been dispatched. */
  send(handle: ThreadHandle, text: string): Promise<void>;
  /** Raw stream chunks captured from the page's own network traffic. */
  receive(handle: ThreadHandle, signal: AbortSignal): AsyncIterable<RawChunk>;
}

export type RawChunk =
  | { type: "delta"; text: string }
  | { type: "end" }
  | { type: "limit"; kind: "thread_full" | "rate_limited"; detail: string; resetAt?: number }
  | { type: "error"; message: string };
```

### `sites/types.ts`

```ts
export interface SiteAdapter {
  id: "claude" | "chatgpt";
  url: string;
  /** Version bump whenever selectors change — surfaced by `browser doctor`. */
  adapterVersion: string;

  newChatUrl(): string;
  composer(page: Page): Locator;
  submit(page: Page): Locator;
  /** Should this network request be treated as the completion stream? */
  isCompletionRequest(url: string, method: string): boolean;
  /** Decode one raw SSE/stream frame into text delta or a limit signal. */
  decodeFrame(frame: string): RawChunk | null;
  /** Best-effort: disable the site's own tools (web search, canvas) for this thread. */
  disableSiteTools?(page: Page): Promise<void>;
}
```

### Config (`~/.freecode/config.json`)

```jsonc
{
  "current": { "provider": "browser:claude", "model": "claude-opus-4-6" },
  "browser": {
    "cdpUrl": "http://localhost:9222",
    "threadBudgetChars": 400000,   // when the meter passes this, roll to a new chat
    "maxToolResultChars": 4000,    // browser mode truncates far harder than API mode
    "maxRepairAttempts": 3,
    "threadPoolSize": 2,           // max concurrent live tabs; beyond this, queue
    "ledgerMaxAgeChars": 150000,   // dedup entries expire after this much thread growth
    "subagentProvider": "inherit", // or an API provider id, to keep subagents off tabs
    "headless": false
  }
}
```

---

## Problem 1 — tool calling over a chat UI

### Wire protocol

Bootstrap (turn 1) carries the system prompt, the rendered tool list, project context, and
the protocol contract. Subsequent turns carry only results.

Model → us:

```
~~~freecode
{"calls":[{"id":"1","name":"read","args":{"path":"src/a.ts"}}]}
~~~
```

Us → model:

```
~~~freecode-result
{"1":"<file contents>"}
~~~
```

Rules baked into the bootstrap text:

- Exactly one fenced block per reply when calling tools; text outside the block is ignored.
  Stated bluntly because the UI model is tuned to add prose. Note this is a *prompt* rule,
  not a parser rule — see below.
- `~~~` fences (not backticks) so code containing backtick fences round-trips safely; all
  argument values are JSON strings, so newlines are escaped.
- `calls` is an array — multiple tools per round trip is encouraged, because **round trips,
  not tokens, are the expensive unit in browser mode**.
- A reply with no block is a normal assistant answer and ends the turn.

### Strict prompt, lenient parser

The spec's own stated most-likely failure is that the UI model appends prose. Making the
*parser* strict about that converts the single most likely deviation into a round trip,
which is the expensive unit here. So the two halves are deliberately asymmetric
(Postel's law):

- **Prompt: strict.** Demand exactly one block, nothing else.
- **Parser: lenient.** Extract the first block matching any known fence variant
  (`~~~freecode`, ```` ```freecode ````, ```` ```json ````, bare `{"calls":…}`), ignoring
  surrounding prose, preamble, and trailing offers to continue. A well-formed call wearing
  the wrong costume must never cost a round trip.

Repair fires only when **no parseable block exists at all**.

### Protocol repair

`repair.ts` escalates rather than repeating — resending the same terse nudge to a model
that already ignored it is the definition of a wasted turn:

1. terse correction ("resend exactly one `~~~freecode` block, nothing else");
2. full restatement of the format contract (a mini re-bootstrap of the protocol rules only);
3. fail the turn with a clear, actionable error.

`browser.maxRepairAttempts` defaults to **3**. Every attempt is recorded so `browser doctor`
reports a per-site protocol-compliance rate; the default is expected to be tuned once real
numbers exist, and early runs may fail turns more often than the default suggests.

---

## Problem 2 — statefulness and the sent log

The naive design — hash the local `messages[]` prefix, rebootstrap on any mismatch — is
**wrong**, because it compares against the wrong reference. The site holds the thread and
**we cannot retract anything from it**. Local history and thread contents are therefore
allowed to diverge, and the divergence cases differ in kind, not degree:

- **Compaction** collapses local history into a summary, but the site's thread still
  contains every original message. A rebootstrap here pays the most expensive operation in
  the system for *zero* information gain — the thread already knows what the summary
  summarizes. This is the common case, and prefix-hashing fires on all of it.
- **A rewind or edited message** is the opposite: the thread holds content we now want to
  disown. No partial patch can fix that, because the content is already server-side. A new
  chat is the only correct response.

So `thread.ts` tracks **what we have actually sent to this thread** — a `sentLog` of
message ids plus a content hash per id — and diffs the incoming `messages[]` against that,
never against itself:

| Observation vs `sentLog` | Meaning | Action |
| --- | --- | --- |
| new ids appended | normal turn, or compaction added a summary | send the delta |
| a sent id is now **absent** | compaction dropped it; the site still has it | **continue** — no reboot |
| a sent id's **content changed** | rewind / edited message — thread now contradicts us | rebootstrap |
| no overlap at all | different session, or the thread died | rebootstrap |

Two consequences worth stating explicitly:

- **Compaction stops forcing a rebootstrap.** It becomes a local-only bookkeeping event
  that browser mode largely ignores.

*Invariant **verified** in Phase 2 (2026-08-20):* `Message.id` is stable across
persistence. Messages are stored one JSON object per line in `messages.jsonl` and read
back with a bare `JSON.parse` per line (`session/store.ts:352`) — ids round-trip verbatim,
with no regeneration on load.

*And compaction is friendlier than assumed.* `keepLastNUserTurns` returns
`messages.slice(i)` — the **same objects**, ids intact — and the summary goes into the
system prompt, not into the message array (`session/compact-apply.ts:1-3`). So compaction
is a pure suffix-preserving trim: the sent log's "a sent id is now absent ⇒ benign"
rule covers it exactly, and there is no synthetic summary message to suppress on the wire
(an earlier draft of this spec called for filtering one; that was wrong for this codebase).

### Subagents and process weight

Browser mode is the heaviest feature in the codebase and must not quietly erode FreeCode's
startup/footprint positioning. Two costs, often conflated:

- **FreeCode's own footprint is near zero.** CDP-attach means we never launch a browser —
  we attach to the Chrome the user already has open. Our marginal cost is a WebSocket, not
  a Chromium process. (This is an additional argument for CDP-first over a
  Playwright-managed browser, which *would* own the process.)
- **Tabs are real RAM, in the user's browser.** One live tab per subagent thread is a
  materially different profile from a bash-tool subagent.

Policy:

- Threads are serialized over a pool, `browser.threadPoolSize` (default **2**); requests
  beyond it queue rather than opening tabs.
- `browser.subagentProvider` (default `"inherit"`) may be set to an API provider id, so
  subagents run on a cheap metered path while the main loop stays on the subscription.
- Subagents never share the parent's thread.

---

## Problem 3 — limits

Three distinct limits; conflating them is the main design trap.

| Limit | Signal | Response |
| --- | --- | --- |
| **Thread full** | site banner / stream error, or our meter crossing `threadBudgetChars` | summarize via `compaction/summarizer.ts`, open a new chat, bootstrap from the summary |
| **Usage / rate limit** | error payload, often with a reset time | emit a typed error; let `agent/recovery/` fall back (smaller model, or another browser provider); surface the reset time in the TUI |
| **Message too long** | composer rejects, or send silently truncates | chunk the message; enforced up-front by `maxToolResultChars` |

### Compaction trigger inversion

Today compaction fires on a cost ceiling — `DEFAULT_COMPACT_TARGET_TOKENS = 120_000`
(`compaction/tokens.ts:47`) — which is meaningless on a flat-rate subscription, where the
conversation costs the same whatever its length. It measures a quantity browser mode does
not pay. (It is *not* also a rebootstrap trigger — see Problem 2; the sent log absorbs
compaction without touching the thread.)

In browser mode the trigger inverts: continuation fires when **the meter says the site's
thread is nearly full**, not when tokens get expensive.

**Implemented (Phase 3)** as a provider capability rather than a browser special case, so
`loop.ts` still does not know browsers exist: `ProviderInfo.remoteContext` declares "the
conversation lives on my side; you send only new messages". `maybeCompact`
(`agent/loop.ts:1058`) returns early for such providers — token-driven compaction would
spend a summarization round trip shrinking an array that never goes on the wire.

Rollover is then driven entirely inside the provider, in two directions:

- **proactive** — `meter.shouldRollover(threadBudgetChars)` before sending; predicting
  early costs one bootstrap, predicting late costs a wasted round trip *and* a bootstrap;
- **reactive** — a `ThreadFullError` mid-turn opens a new chat and replays the turn, since
  a char-based meter will sometimes miss. `RateLimitedError` is deliberately **not**
  retried: a new chat draws on the same quota.

*Residual, accepted:* local history now grows unbounded in browser mode (nothing trims it).
It costs memory, not tokens, because it never goes on the wire.

The meter is **character-based and approximate** — we cannot see the site's tokenizer.
"We guessed wrong and hit the wall mid-turn" is a normal path and must recover by rolling
to a new chat and replaying the un-acknowledged tail, not by failing the session.

---

## Optimizations (Phase 4)

Browser mode makes wasted work doubly expensive: a redundant read costs a full round trip
*and* consumes thread budget that can only be reclaimed by rebootstrapping.

1. **Sent-content ledger** (`cache/ledger.ts`) — a repeat `read` of an unchanged file
   returns `"unchanged since turn 7"` instead of re-pasting the contents. This is the only
   optimization here whose failure mode is **silent** — a wrong answer corrupts the model's
   world model without raising anything — so it gets its own rules below.
2. **Delta project context** — the file tree ships once in the bootstrap. Later turns send
   only "files changed since last turn", never the whole tree. (API mode re-sends dynamic
   context every call by design — `loop.ts:1672` — for prompt-cache reasons that do not
   apply here.)
3. **Hard tool-result truncation** — `maxToolResultChars` with an explicit
   "N more lines available, ask to see them" footer.
4. **Batching** — the protocol's `calls` array plus bootstrap wording that pushes the model
   to request several tools at once.

### Ledger safety rules

Every rule below exists because the failure is silent. None is a performance tuning knob.

**Scope: v1 dedupes `read` and nothing else.**

| Class | Tools | Dedup | Key |
| --- | --- | --- | --- |
| pure, single-target | `read` | **yes** | `(tool, path, offset, limit)` — a slice at offset 4000 is a different result from the full file, and a `(tool, path)` key would serve the wrong one |
| pure, corpus-dependent | `grep`, `glob`, `ls` | **no (v1)** | would need a fingerprint of the whole searched corpus, which costs about as much as re-running the tool |
| impure / mutating | `bash`, `write`, `edit`, all MCP tools | **never** | n/a |

Excluding row 2 costs almost nothing: dedup value scales with payload size, and
`grep`/`glob`/`ls` results are small. The win is concentrated entirely in large `read`s.

**Allowlist, not a purity flag.** The dedupable set is an explicit allowlist inside
`ledger.ts`, checked by tool name. A new tool is therefore *not* deduped until someone
deliberately adds it — the fail-safe default. This also excludes every MCP tool
automatically: MCP tools register at runtime via `registerMcpTool`, and a per-tool purity
flag would let a third-party server assert its own purity. That trust decision is not
delegated outward.

**Content hash is the source of truth, and there is no mtime pre-check at all.** An mtime
check was designed in to avoid re-hashing a file that looks untouched — but by the time
the ledger runs, the tool has *already re-read the file*, so we compare the fresh result
payload against what we sent. Matching hashes mean identical content by construction, and
mtime resolution, clock skew and restore-in-place cannot produce a false "unchanged". We
are optimizing transmission, not disk I/O. Dropping the check removed a whole class of bug
rather than adding one.

**Hash what was sent, not what was read.** `maxToolResultChars` truncates large results on
the wire, so the model received a prefix. A ledger entry recording the full-file hash would
claim the model holds content it never received. Entries record the delivered payload and
the byte range actually delivered.

**Three defenses against a context boundary we cannot observe.** The ledger verifies the
*file* is unchanged, but "unchanged since turn 7" is a claim about what the *model* still
has — and the site may silently truncate or summarize early turns before our char-based
meter believes the thread is full.

1. **Per-thread, cleared on rebootstrap** — *hard invariant*. On a rollover to a new chat,
   the new thread contains none of the prior results; a surviving ledger would be wrong
   100% of the time, immediately. Clear on every rebootstrap path (rollover, sent-log
   contradiction) and never share a ledger between threads or with a subagent.
2. **Dedup at most once per key** — if the model requests the same key again *after* being
   told "unchanged", it does not have the content: send it in full, unconditionally. This
   bounds the worst case to a single wasted round trip, needs no tool-schema change, and
   does not depend on us guessing an invisible threshold.
3. **Age expiry** — entries expire after `browser.ledgerMaxAgeChars` of thread growth since
   they were sent, measured in meter chars rather than turns because chars approximate
   distance in the site's context. The proactive half of the hedge.

*Integration risk, checked in Phase 4 — headroom confirmed, live check still owed.*
`agent/loop.ts:2339` counts identical `tool+argsHash` calls within a sliding window of the
last 10, and `repeatedTools = identicalCount - 1`. Thresholds are 3 (warn) and 6 (stop)
(`agent/types.ts:213`). The one-shot rule caps a dedup-induced repeat at exactly **one**
extra identical call — worst case `read(A)` full → `read(A)` deduped → `read(A)` full,
i.e. `repeatedTools = 2`, below the warn threshold. So a dedup cannot trip loop-health on
its own; four identical calls would be needed, which means the model is genuinely stuck and
the warning is correct. Arithmetic verified by reading the counter; still worth watching in
the first live run, because a false stagnation-abort on a working dedup path points
everywhere except the ledger.

---

## Phases

| Phase | Deliverable | Verification |
| --- | --- | --- |
| **0** | Spec + module scaffold + lazy registration + `browser` config block | typecheck + full suite green; browser providers appear in `providers.list` with metadata only; typecheck still green after removing **both** the folder and the import line (see below — the folder alone does not suffice, by design) |
| **1** | CDP transport, injected bridge, `sites/claude.ts`, `freecode browser doctor` | offline: bridge executes in a VM with response identity preserved, SSE splitter handles split frames, Playwright absent until `transport/cdp.js` is imported. **Live (needs a logged-in Chrome): `freecode browser chat "say OK"` streams `OK` back from the real site** |
| **2** | `provider.ts`, protocol encode/lenient-parse/repair, sent log, stream filter | **`Message.id` stability verified** (see Problem 2); offline: lenient parser accepts 6 fence variants, sent log treats compaction as benign, stream filter never emits a split fence. **Live: a real coding task completes end-to-end through the unmodified agent loop.** Legacy `browser/` deletion still pending |
| **3** | Meter, limit detection, rollover (proactive + reactive), compaction inversion | offline: rollover fires at budget, `thread_full` is rollable and `rate_limited` is not, `remoteContext` short-circuits `maybeCompact`. **Live: a deliberately long thread rolls to a new chat and continues the same task** |
| **4** | Ledger (`read` only), delta context, truncation, batching | offline: allowlist rejects `bash`/`grep`/MCP, one-shot rule holds, `clear()` on rebootstrap, clock-only context change reports nothing, **volatile-context regression covered**; loop-health headroom confirmed by arithmetic. **Live: fewer round trips and zero duplicate file sends on a repeated task** |
| **5** | `sites/chatgpt.ts`; optionally `transport/extension.ts` | `browser doctor` green on both sites |

### `freecode browser doctor`

Non-negotiable, built in Phase 1. Runs a scripted probe and reports pass/fail per
capability — **playwright resolvable, connected, logged in, composer found, submit works,
completion request matched, frames decoded, protocol respected, adapter version** — so a
site redesign produces a five-second diagnosis instead of a hang.

### Inline shape check (transport-format drift)

"The site's own data stream changes less often than its DOM" is a **bet, not a fact**. If a
site moves SSE → WebSocket or changes its chunk envelope, `isCompletionRequest` /
`decodeFrame` break exactly as hard as a selector would — and fixture replay cannot catch
it, because fixtures are old captures of the *previous* format.

Detection is therefore inline on every real turn, not a scheduled canary: a periodic probe
would generate automated traffic on a schedule for a site we are already crosswise with,
and would still not detect drift any earlier than the next real turn does. Each turn
asserts that (a) a request matching `isCompletionRequest` was observed within N seconds of
submit, and (b) the first frame decodes. Either failing raises a specific
**"adapter may be stale (site `claude`, adapter v3) — run `freecode browser doctor`"**
rather than timing out. Zero extra requests, caught on first real use.

*Considered and deferred to Phase 5:* falling back to DOM reading for the affected turn
when network capture yields nothing but a response is visibly rendering. It would trade
fidelity for availability, but it re-introduces the read-side selector surface this design
exists to avoid, so it is not in v1.

---

## Testing strategy

- **Pure units, no browser:** `protocol/parse.ts`, `protocol/encode.ts`, cursor prefix
  matching in `thread.ts`, `limits/meter.ts`, `cache/ledger.ts`. These carry the real
  correctness risk and are fully testable offline.
- **Recorded fixtures:** capture real stream frames from each site once, commit them
  (scrubbed of tokens/PII), and replay them through `decodeFrame` + the parser. This is how
  site adapters are regression-tested.
- **Live sites:** touched only by `browser doctor` and manual smoke runs. Never in CI.

---

## Finding: CDP is detected by claude.ai (2026-08-20)

The first live run reached the site and got **Cloudflare's interstitial**
(`title: "Just a moment..."`, zero editable elements, zero buttons), and re-challenged
after the user solved it by hand.

This is the project's central risk materializing, not a bug in any layer we built. The
transport works: auto-launch found the browser, CDP attached, the thread opened, the bridge
injected. What fails is that a CDP-attached page is *observably* automated, and the
detection is continuous — passing the challenge manually does not persist.

**This does not get worked around.** No fingerprint patching, no `navigator.webdriver`
spoofing, no suppression of CDP domains, no challenge solvers, no proxies. That boundary
was set when the project started and it is what closes off the CDP path here.

Consequences:

- **CDP transport against claude.ai is not viable.** Phases 1–4 remain correct and tested,
  but the site adapter cannot be validated through this transport.
- **The extension transport is promoted from "optional later" to the only supported path**
  for sites behind this kind of protection. It is not an evasion technique: an extension in
  the user's ordinary browser means the browser genuinely is not automated — there is no
  CDP session, no injected automation, and the tab and login are the user's own.
- `browser doctor` now reports a challenge page as its own failure class, because "composer
  not found" is actively misleading here: no adapter change fixes it.

### Extension transport validated the same day

A spike extension (`apps/extension`) loaded into the user's ordinary browser was **not
challenged**, and a full terminal → browser → terminal round trip then worked:
`freecode browser chat "Reply with exactly: OK"` typed into the real composer, the message
sent, and the reply streamed back to stdout.

That single run also validated the parts of `sites/claude.ts` that could not be reached
through CDP: `composerSelectors`, `submitSelectors`, `completionUrlPatterns` and
`decodeFrame` are all confirmed against the live site. They are no longer guesses, though
fixtures should still be captured (`__freecodeDump()`) so a redesign is caught by a test
rather than by a user.

**The extension is therefore the primary transport, and CDP is demoted to a fallback** for
sites that do not challenge it. Both implement `BrowserTransport`, so everything above the
transport — protocol, sent log, meter, ledger, rollover — is untouched by the switch. That
split was worth its cost: the transport that was designed first turned out to be unusable,
and none of the four phases built on top of it had to change.

## Open risks

- **Site redesigns** break adapters. Mitigated by network-reading, the inline shape check,
  and `doctor` — not solved.
- **Streaming-transport drift** (SSE → WebSocket, new chunk envelope) breaks the read path
  as hard as a selector change would, and fixture replay structurally cannot catch it early.
  This is the design's main unhedged bet.
- **Tab footprint** grows with concurrent subagent threads. Capped by `threadPoolSize`, but
  browser mode remains the heaviest feature in the codebase by design.
- **The site's own system prompt fights the protocol** — the UI model is tuned to be
  conversational and will append prose. Handled by blunt bootstrap wording plus `repair.ts`;
  measure the compliance rate per site and revisit if it is poor.
- **Site-native tools** (web search, canvas, code interpreter) can hijack a turn.
  `disableSiteTools` is best-effort only.
- **Latency**: 2–10 s of browser overhead per turn on top of generation. Browser mode will
  always feel slower than API mode; batching is the only lever.
- **No true token accounting** — `ExecuteUsage` from a browser provider is an estimate.
  Downstream readers (usage totals, cache metrics) must not treat it as authoritative.

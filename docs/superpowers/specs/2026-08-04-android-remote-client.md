# Android Remote Client

**Date:** 2026-08-04
**Status:** Proposed
**Supersedes:** none (extends `web-server.ts` + `apps/web-app`)
**Related:** `specs/2026-05-25-architecture-v4.md` (thin-client model),
`specs/2026-07-18-permission-rules.md` (approval flow)

---

## 1. Problem

FreeCode runs as a long-lived daemon on a developer's machine. The work it does —
long agent loops, builds, test runs — is exactly the kind of thing you want to
kick off and then walk away from. Today you can only watch it from a terminal
sitting in front of that machine.

The goal: leave the desktop running at home, and from a phone anywhere, send a
prompt, watch the loop stream, and answer the permission/question prompts that
would otherwise block it indefinitely.

A remote path already half-exists. `freecode web` (`cli/commands/web.ts`) starts
`startWebServer` (`web-server.ts:21`), which serves the `apps/web-app` SPA plus:

- `POST /api` — the full JSON-RPC surface, via `handleRequest` from `server.ts`
- `GET /events?sessionId=` — SSE, fed by the bus subscriber at `server.ts:881-891`

And `bus/bridge.ts:29,38` already converts the blocking prompts into wire events
(`question_asked`, `permission_asked`), with `question.answer` / `permission.answer`
RPCs to resolve them (`server.ts:407-437`).

So the protocol is there. What is missing is everything that makes it *safe* and
*reliable over a mobile link*.

### 1.1 What actually blocks this today

**A. No authentication of any kind.** `web-server.ts:32` sets
`Access-Control-Allow-Origin: *` and no handler checks a credential. The default
bind is `127.0.0.1`, which is the only thing currently protecting it. The moment
you pass `--host 0.0.0.0` to reach it from a phone, `POST /api` becomes
unauthenticated arbitrary code execution as your user — `tools.call` with `bash`
is directly reachable. **This is the blocking issue and it is not optional.**

**B. One SSE client per session, silently.** `sessionEventCallbacks` is a
`Map<string, (event) => void>` (`server.ts:122`). `.set()` on line 90 of
`web-server.ts` overwrites. A phone connecting takes the stream away from the
desktop, and neither side is informed.

**C. No stream resume.** The SSE endpoint emits no `id:` field, keeps no buffer,
and ignores `Last-Event-ID`. Any drop loses everything emitted while
disconnected, permanently — the events are gone from memory, not merely missed.
A desktop on wifi rarely notices this. A phone that backgrounds, switches
cell towers, or locks its screen hits it on almost every turn. **This is the
single largest mobile-specific gap.**

**D. The SPA has no approval UI.** Grepping `apps/web-app/src/` for
`question_asked`, `permission`, or `requestId` yields one hit — a `disabled: true`
Permissions tab (`SettingsModal.tsx:31`). The events arrive and are dropped on
the floor. Remote approvals are the core value of this feature and they are
entirely unbuilt.

**E. The SPA is desktop-only.** `ChatView.tsx` and `App.tsx` contain zero
responsive utility classes. `Sidebar.tsx` (201 lines) and `RightSidebar.tsx`
are fixed panes.

Items A, B, and C are in `apps/core` and are required regardless of what the
client is written in. They are the majority of the work.

## 2. Goals

- **Send a prompt and watch it stream, from a phone, over the public internet,
  safely.**
- **Answer permission and question prompts remotely**, so a loop never blocks
  waiting on someone standing at the desktop.
- **Survive a mobile network.** Screen-off, backgrounding, wifi↔cellular
  handover, and tunnel drops must not lose agent output. Reconnect replays the
  gap.
- **Never widen the local attack surface.** The `127.0.0.1` default stays the
  default; remote exposure is explicit and always authenticated.
- **No second protocol.** The phone speaks the same JSON-RPC + `StreamEvent`
  surface as the TUI and VS Code. Per architecture-v4, the client stays dumb.

### Non-goals (v1)

- **Push notifications.** Deferred to a later phase (§7, Phase 4). It is the
  obvious next thing, and §4.4 leaves the hook point, but it needs FCM
  infrastructure and a turn-complete signal that don't exist yet.
- **Session list / resume / switch from the phone.** v1 attaches to one session.
- **File and diff browsing.** Read the code on a real screen.
- **iOS.** Nothing here is Android-specific server-side, but no iOS client ships.
- **Running the agent on the phone.** The daemon stays on the desktop. This is a
  remote control, not a port.

## 3. Architecture

```
   Phone (Android)                     Home machine
┌──────────────────────┐           ┌────────────────────────────┐
│ Compose shell        │           │  freecode web --host <ts>  │
│  · pairing (QR)      │           │                            │
│  · token vault       │           │   web-server.ts            │
│  · connection state  │           │    ├─ POST /api   (JSON-RPC)│
│  · foreground svc    │           │    ├─ GET  /events (SSE)   │
│  ├───────────────┐   │  Tailscale│    └─ static apps/web-app  │
│  │   WebView     │───┼───────────┼──▶                         │
│  │  apps/web-app │   │ WireGuard │   server.ts  handleRequest │
│  │  (React SPA)  │   │    +      │   bus ──▶ sessionEventCbs  │
│  └───────────────┘   │  bearer   │                            │
└──────────────────────┘   token   └────────────────────────────┘
```

**Split of responsibility.** The Compose shell owns everything the web platform
handles badly on mobile: credential storage, pairing, network-change detection,
and process survival while the screen is off. The WebView owns all rendering and
all protocol, reusing the SPA's existing message/part components. The bridge
between them is deliberately narrow — see §5.2.

**Why hybrid rather than fully native.** A native client would have to
reimplement `StreamEvent` rendering (text/thinking/tool parts) that already
exists in `apps/web-app/src/chat/parts/` and would then drift from it on every
protocol change. The parts renderers are ~300 lines and directly reusable. The
cost is one fuzzy seam, kept narrow by §5.2.

**Why Tailscale.** It gives device-level identity, E2E encryption, and NAT
traversal without exposing a port to the internet or forwarding anything on the
router. The bearer token (§6) is defense-in-depth *behind* that, not the only
lock — so a misconfigured tailnet ACL is not immediately fatal.

## 4. Core changes (`apps/core`)

These are required for any client. They are the bulk of the work.

### 4.1 Bearer-token auth on the web server

New module `apps/core/src/web/auth.ts`.

- On first `freecode web` invocation with a non-loopback `--host`, generate a
  256-bit token (`crypto.randomBytes(32)`, base64url) and persist it to
  `~/.freecode/web-token` with mode `0600`. Never into `config.json`, which is
  routinely pasted into issues.
- Every `/api` and `/events` request must present it. Compare with
  `crypto.timingSafeEqual` — a naive `===` on a secret this long is a real
  timing oracle over a LAN.
- Two accepted carriers, because `EventSource` cannot set headers (§4.2):
  1. `Authorization: Bearer <token>` — preferred, used by `/api` and by the
     fetch-based stream reader.
  2. `?token=` query parameter — accepted on `/events` only, for `EventSource`
     compatibility. Documented as second-class since it lands in access logs.
- **Loopback keeps today's behavior.** If the bind host is `127.0.0.1`/`::1`,
  auth is skipped unless `--require-auth` is passed. This preserves the existing
  desktop flow exactly and confines the change to the remote path.
- Replace `Access-Control-Allow-Origin: *` (`web-server.ts:32`) with an echo of
  the request origin only when it is loopback or the configured bind host. A
  wildcard plus credentials is the classic path to a drive-by that pivots
  through the browser of anyone on the network.
- Print a terminal QR code of `freecode://<host>:<port>?token=<token>` on
  startup (via `qrcode-terminal`, ~1 dep) so pairing is a camera scan rather
  than typing 43 base64 characters on a phone keyboard.

**Failure mode:** a missing or wrong token returns `401` with a JSON-RPC error
body. No timing difference between "no token" and "wrong token".

### 4.2 Resumable event stream

The correctness centerpiece. New module `apps/core/src/web/stream-buffer.ts`.

- Every wire event gets a per-session monotonic `seq`, assigned at the single
  emit point in `server.ts:881-891` — before fan-out, so all subscribers agree
  on numbering.
- Per session, retain a ring buffer of recent events, bounded by **both** count
  and bytes (target: 1000 events or 4 MB, whichever binds first). A single
  `tool_output` from a verbose build can be megabytes, so a count-only bound
  would let one session pin unbounded memory.
- Emit the seq as SSE's native `id:` field. On reconnect the client sends
  `Last-Event-ID`; the server replays everything after it, then resumes live.
- If the requested id has already been evicted, send a
  `{ type: "stream_gap", from, to }` event rather than silently skipping. The
  client renders an explicit "output lost while disconnected" marker. A visible
  gap is recoverable; an invisible one makes the transcript quietly wrong.
- Buffers are dropped when the session ends. In-memory only — a daemon restart
  legitimately loses them, and the client resyncs via `session.resume`.

### 4.3 Multiple concurrent subscribers (and their cleanup)

`sessionEventCallbacks` becomes `Map<string, Set<(event) => void>>`
(`server.ts:122`), with the fan-out at `server.ts:887-889` iterating the set and
`web-server.ts:90` adding/removing its own callback rather than overwriting.

That is what lets you watch from your phone while the desktop TUI is still
attached — the actual usage pattern.

**The cleanup is the hard half.** A `Set` that grows on `.add()` and shrinks only
on a clean `req.on("close")` will leak. `web-server.ts:92` relies on exactly that
event, and mobile is the environment where it is least trustworthy: a tunnel drop
or a phone losing signal mid-turn leaves a half-open socket that fires `close`
late or never. Every reconnect then adds a subscriber, and the ring buffer's
per-session state is pinned by callbacks nothing will ever remove.

Liveness is therefore established positively rather than inferred from silence:

- **Periodic heartbeat.** Today `web-server.ts:83` writes `: heartbeat\n\n`
  exactly once, at connect — decorative, not a liveness check. Replace it with a
  comment frame every 15s. A write that throws, or returns `false` against an
  already-destroyed socket, removes the subscriber immediately.
- **Explicit socket checks.** Prune on `res.socket.destroyed` before each write,
  and bind `close`/`error` on both `req` and `res` — cheap, and catches the clean
  cases fast.
- **Idle reaper.** Any subscriber whose last successful write is older than 60s
  is dropped regardless. This is the backstop for half-open sockets that never
  surface an error at all.
- **Shared lifetime with §4.2.** Subscriber sets and ring buffers live in the
  same per-session record and are torn down together, so a session can never
  retain a buffer with no subscribers or vice versa.

Reconnect after a spurious prune is free: the client re-subscribes with
`Last-Event-ID` and replays the gap. **Pruning too eagerly is cheap; pruning too
late leaks.** The design is biased accordingly.

### 4.4 One-shot resolution of prompts across devices

Multi-subscriber (§4.3) means the TUI and the phone both receive the same
`permission_asked` and both can answer it. Today that race resolves badly and
*silently*:

```ts
export function answerPermission(requestId, answer) {
  const pending = pendingPermissions.get(requestId);
  if (pending) { /* ... */ }        // bus/index.ts:399 — no else
}
```

The handler returns `void` whether or not anything was pending
(`server.ts:420-430`), so the losing device receives a **successful** JSON-RPC
response for an answer that was discarded. Tap "Deny" on the phone a beat after
the desktop clicked "Allow" and you get a success indication while the agent
runs the command. A wrong answer reported as accepted is materially worse than
an error.

The contract, stated so both frontends can implement it:

1. **First answer wins; the loser is told.** `answerQuestion`, `rejectQuestion`,
   `answerPermission`, and `rejectPermission` return `boolean` (was `void`).
   The `server.ts` handlers translate `false` into a distinct JSON-RPC error —
   code `-32002`, `REQUEST_ALREADY_RESOLVED` — rather than silent success.
2. **Resolution is broadcast.** `answerPermission`/`rejectPermission` already
   publish `permission.answered`/`permission.rejected` (`index.ts:403,413`),
   which reach the wire through the verbatim forward at `bridge.ts:53`.
   `answerQuestion`/`rejectQuestion` publish nothing — add
   `question.answered`/`question.rejected` to mirror them. Both surfaces then
   dismiss the prompt when the other device resolves it, so the race is usually
   avoided rather than merely handled.
3. **Frontends render it as state, not failure.** `-32002` shows "Already
   answered on another device" and closes the modal. It is a normal outcome of
   two attached clients, not an error the user caused.

Note the timeout interaction: both prompts reject after 5 minutes
(`index.ts:309-317, 384-389`), and for permission the caller treats rejection as
**deny**. So `-32002` can also mean "you were too late and the tool was already
denied" — the message should not promise which of the two happened, only that
the request is closed.

### 4.5 Hook point for turn-completion (not built in v1)

The `done` event already flows through the bridge. Phase 4 will subscribe to it
server-side to trigger a push. No v1 code, noted so §4.2's buffering is not
designed in a way that forecloses it.

## 5. The Android app (`apps/android`)

Kotlin + Jetpack Compose, min SDK 26, single Gradle module. **Not** part of the
pnpm workspace — it builds independently via Gradle, with only `README` pointers
tying it to the monorepo.

### 5.1 Compose shell

| Screen | Responsibility |
| --- | --- |
| `PairingScreen` | CameraX + ML Kit barcode scan of the terminal QR, or manual host/port/token entry. Validates by calling `providers.list` before saving. |
| `ConnectionScreen` | Host reachability, tailnet status hint, last-error surface, re-pair action. |
| `ChatScreen` | Thin Compose scaffold; a full-bleed `WebView` plus a connection status bar. |

Token stored via `EncryptedSharedPreferences` (Jetpack Security), not plain
prefs — a rooted or backed-up device otherwise leaks a credential that grants
shell access to the developer's machine.

### 5.2 The native↔WebView bridge

Kept deliberately narrow. Exactly three surfaces:

1. `@JavascriptInterface fun getCredentials(): String` — returns
   `{baseUrl, token}` JSON. The token reaches the SPA this way rather than being
   baked into the loaded URL, keeping it out of the WebView's history and out of
   any `Referer` header.
2. `fun onNetworkChanged(available: Boolean)` — native `ConnectivityManager`
   callback pushed into JS via `evaluateJavascript`, so the SPA can trigger an
   immediate reconnect instead of waiting for a TCP timeout. Cell-tower handover
   is the common case and TCP takes a long time to notice.
3. `@JavascriptInterface fun setTurnState(state: String)` — JS reports the
   session's liveness state as one of `working`, `blocked`, or `idle`. See §5.3
   for why this is three states and not a boolean.

Everything else — all RPC, all rendering — stays in the WebView.

### 5.3 Foreground service

Android aggressively freezes background WebViews. Without a foreground service,
locking the phone mid-turn suspends the SSE connection and (before §4.2) lost
the output. With §4.2 the output is recoverable on reconnect, so the service is
not what protects the transcript.

**What the service actually protects is the approval window**, and getting that
window wrong is the sharpest failure mode in this design.

The naive framing — service runs while "a turn is in flight" — protects the
wrong interval. When the agent parks on `permission_asked` it is, in every
mechanical sense, *not working*: no tokens stream, no tools run, the loop is
parked on an unresolved promise. Any "is a turn active" signal derived from
output activity goes quiet at precisely the moment the agent needs a human. That
would keep the phone awake while the agent is busy and let it freeze while the
agent is waiting on you — exactly inverted.

The 5-minute timeout makes this concrete rather than theoretical. Both prompts
reject after 5 minutes (`index.ts:309-317, 384-389`), and `askPermission`'s
callers **treat rejection as deny**. So a WebView frozen during the blocked
window does not merely delay the answer — it silently denies the tool call and
the agent proceeds as if you had refused. The service exists to guarantee you
*see* the prompt inside that budget.

The active window is therefore defined as:

```
submit ──▶ working ⇄ blocked ──▶ idle
           (streaming) (awaiting  (done | error |
                        approval)  rejected | timeout)
```

- **`working`** — entered on submit; sustained by `text_delta`, `thinking_delta`,
  `tool_start`, `tool_output`.
- **`blocked`** — entered on `question_asked` / `permission_asked`. **Highest
  priority for staying alive, not lowest.** Answering returns to `working`, not
  to `idle` — this is the transition a boolean flag gets wrong.
- **`idle`** — entered only on a genuine terminal event: `done`, `error`, or a
  resolution broadcast from §4.4 showing another device closed the last open
  prompt.

The service runs across `working` **and** `blocked`, stopping only at `idle`.

The notification reflects the distinction, because it is the only thing the user
sees with the screen off: `working` shows a quiet ongoing notification, while
`blocked` escalates to high importance with the tool name and an explicit
"waiting for your approval" — this is a hard deadline, not an FYI. That
escalation is also the natural Phase 4 push surface.

**Belt and braces:** the state machine is driven by wire events and so can miss a
transition if the stream drops at the wrong instant. The service additionally
caps itself with a watchdog — if no event of any kind arrives for 10 minutes
(twice the prompt timeout, so it cannot fire while an answer is still useful),
it stops regardless of reported state. A stuck foreground service draining the
battery is a bug the user will notice and uninstall over.

### 5.4 WebView configuration

JS enabled, DOM storage enabled, file access disabled, `allowContentAccess`
disabled. `setWebContentsDebuggingEnabled` in debug builds only. Since the
tailnet serves plain HTTP, `usesCleartextTraffic` is scoped by a network
security config to the `100.64.0.0/10` CGNAT range Tailscale uses, rather than
enabled process-wide.

## 6. Security model

The threat being defended against is straightforward and severe: **`POST /api`
is remote code execution by design.** `tools.call` with `bash` is one request.
Every control below assumes that.

| Layer | Control |
| --- | --- |
| Network | Tailscale/WireGuard. No public port, no router forwarding. Device-level auth, E2E encrypted. |
| Transport | Cleartext HTTP *inside* the tunnel only; network security config restricts cleartext to the CGNAT range. |
| Application | 256-bit bearer token, `timingSafeEqual`, `0600` on disk, `EncryptedSharedPreferences` on device. |
| CORS | Origin echo restricted to loopback + configured host. No wildcard. |
| Default | `127.0.0.1` bind remains the default. Remote exposure requires an explicit `--host`. |
| Agent | Existing permission profiles (`permission/profiles.ts`) still apply. Remote does not imply elevated. |

**Explicitly accepted risk:** anyone holding the token and tailnet access has
shell on the machine. That is inherent to the feature. Mitigation is scope
(token grants no more than the local TUI already has) and revocation (delete
`~/.freecode/web-token`, restart, re-pair).

**Rejected:** exposing the port publicly with only token auth. One leaked token
— in a screenshot, a log, a synced clipboard — becomes a compromised machine
with no second factor. If Cloudflare Tunnel is wanted later, it should come with
Cloudflare Access in front, not a bare token.

**Deliberately omitted: rate limiting on auth failures.** This is a conscious
decision, not an oversight. A 256-bit token has no feasible brute-force attack
at any request rate — an attacker throttled to 1000 guesses/second is no closer
to success than one making a billion, because the search space is the thing
doing the work. `timingSafeEqual` (§4.1) closes the side channel that *would*
have made guessing cheaper. Adding a rate limiter would buy no security while
introducing a new way to lock yourself out of your own machine on a flaky
connection. This changes if tokens ever become short or user-chosen — at which
point rate limiting stops being optional.

## 7. Phasing

Each phase is independently useful and independently verifiable.

| Phase | Work | Verify |
| --- | --- | --- |
| **1. Harden the server** ✅ | §4.1 auth, §4.3 multi-subscriber + heartbeat/reaper cleanup, §4.4 one-shot resolution, CORS fix, QR output | Unit tests on token compare + origin logic; `curl` without a token gets `401`; two `curl` SSE clients on one session both receive every event; **kill a client with `SIGKILL` (no clean close) and assert the subscriber set drains within 60s**; **two clients answer one `requestId`, assert exactly one wins and the other gets `-32002`** |
| **2. Resumable stream** ✅ | §4.2 seq + ring buffer + `Last-Event-ID` + `stream_gap` | Test: subscribe, kill the connection mid-turn, reconnect with `Last-Event-ID`, assert zero missing seqs; assert `stream_gap` on forced eviction |
| **3. SPA mobile + approvals** ✅ | Responsive layout (drawers for `Sidebar`/`RightSidebar`), `question_asked`/`permission_asked` modals wired to the answer RPCs, `-32002` and resolution-broadcast handling, fetch-based SSE reader with auth header + resume | Approve a `bash` call from a phone browser over the tailnet; rotate the phone; background 60s and confirm the transcript is gap-free; **answer from the TUI and confirm the phone's modal self-dismisses** |
| **4. Android shell** 🔨 | Compose scaffold, pairing/QR, token vault, WebView + bridge, foreground service with the §5.3 state machine | Pair by scanning; run a turn with the screen locked; **lock the phone, trigger a permission prompt, and confirm the escalated notification arrives and is answerable well inside the 5-minute deny deadline** |
| **5. Push (deferred)** | Turn-complete + blocked-on-approval notifications via FCM | out of v1 scope |

**Phases 1–3 deliver the feature via a mobile browser.** Phase 4 makes it a real
app. That ordering is deliberate: it means the risky, security-sensitive work
gets exercised through a trivially debuggable client before any Gradle project
exists, and if Phase 4 stalls you still have a working remote setup.

**Status:** Phases 1–3 landed (commit chain ending at `168440b`). Phase 4 is
code-complete (🔨) but **not yet verified on a device** — the §7 Phase 4
verification row is still outstanding and is the gate on calling it done.

Three defects found while wiring the shell to the SPA are worth recording,
since each silently defeated a guarantee stated above:

- The SPA hard-coded `http://127.0.0.1:4096` for `/api` and `/events`, so a
  phone fetched its *own* loopback. This broke the Phase 3 mobile-browser
  path too, not just the app — §7's "approve a bash call from a phone
  browser" cannot have passed as written. Base URL is now derived from the
  page origin (`web-app/src/lib/connection.ts`).
- The native bridge exposed `FreecodeBridge.getCredentials()` while the SPA
  read `window.__freecodeAuth`, so the token never crossed the seam and
  every request 401'd. Both carriers are now accepted.
- The §5.3 state machine had no producer: nothing in the SPA ever called
  `setTurnState`, and the service never called `startForeground` outside the
  `blocked` branch, used a plain `startService` (illegal from background on
  API 26+), never ran its watchdog, and posted the blocked escalation to an
  `IMPORTANCE_LOW` channel where API 26+ ignores `PRIORITY_HIGH`.
  `POST_NOTIFICATIONS` was absent entirely, so on API 33+ every notification
  was dropped. The escalation is now a separate high-importance channel.

One deliberate deviation from §5.3: a resolution broadcast returns the state
machine to `working`, not `idle`. Stopping the service on a broadcast is a
trap on Android 12+, where a backgrounded app cannot legally start a
foreground service again — the next `permission_asked` of the same turn
could not re-escalate. `done`/`error` remain the only routes to `idle`.

## 8. Open questions

1. **Session attach semantics.** v1 attaches to one session — is that the
   most recent active one, or is a minimal picker needed to make the app usable
   at all? Leaning: auto-attach to the newest active session, which needs no new
   RPC (`session.list` already exists).
2. **Ring buffer sizing.** 1000 events / 4 MB is a guess. Should be measured
   against a real `bash` turn with verbose build output before being fixed.
3. **Token rotation.** Currently manual (delete the file, re-pair). Whether a
   `freecode web --rotate-token` is worth it depends on how many devices pair.
4. **Multiple phones.** One shared token, or per-device tokens with a revocation
   list? One token is right for a single-user tool; revisit only if it isn't.
5. ~~**Is 5 minutes the right prompt timeout for remote use?**~~ **Decided:
   raised globally to 30 minutes.** The original value was chosen for someone
   sitting at the machine; remote adds notification latency, phone-unlock, and
   the possibility of being somewhere you cannot answer for a while — and the
   penalty for missing it is a silent deny (§5.3).

   The spec leaned toward "configurable, unchanged default" to avoid silently
   extending how long a local loop can hang. That regression is real and is
   accepted rather than avoided: an unattended local loop can now sit for 30
   minutes before unwedging itself. The asymmetry is what settles it — a hung
   loop is visible and you can interrupt it, whereas a timeout is not a retry:
   `askPermission`'s callers treat it as **deny**, so the agent proceeds as
   though you refused, and you find out from the transcript afterwards.

   One knob rather than two also keeps the failure modes enumerable. A
   remote-aware timeout means the deny deadline depends on whether a
   subscriber happened to be attached when the prompt fired — a race that
   would be miserable to debug from the wrong end of a tailnet.

   Implemented as `PROMPT_TIMEOUT_MS` in `bus/index.ts`, shared by the
   question and permission paths so they cannot drift. The §5.3 watchdog is
   derived from it and is now 60 minutes.

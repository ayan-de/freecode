# Gemini web session as a provider — chat endpoint to `AIProvider`

> **Date:** 2026-08-29
> **Status:** Shipped in `0.27.0` — the provider (commit `1170324`, PR #22) and
> the pickers + credential storage (commit `698e1fa`, PR #23) landed in the same
> release. Listed in the catalogue by default, used only when the user picks it.
> **Extends:** `specs/2026-05-28-multi-provider-api-design.md` — same `AIProvider`
> contract, same registry, no change to the agent loop's provider handling.
> **Code:** `apps/core/src/providers/gemini-web/` (6 modules, ~800 lines),
> plus `providers/local-catalogue.ts` and the `web` block in `providers/config.ts`.
> **Explicitly not:** browser automation. There is no Playwright, no sidecar
> process, and no new dependency — `fetch` and one `sha1` are the whole surface.
> The legacy `browser/` ChatGPT adapter is unrelated and stays legacy.

---

## 1. Problem

Every provider in `providers/` spends a metered API key. There was no way to run
a session on an account the user already has and already pays nothing for.
`gemini.google.com` serves a capable model to a free account; the only thing
between it and the agent loop is that it speaks a private protocol instead of a
public API.

The naive framing — "add a provider that talks to the web endpoint" — is the
easy half. The hard half is that a chat UI backend is **not** an API backend,
and the difference is not the transport. It is that the model on the other end
was never trained to be reliable at tool calling over this channel, and it fails
by fabricating rather than by erroring. §4 is the record of finding that out.

---

## 2. Design in one paragraph

`gemini-web` registers as an ordinary `AIProvider`. A turn is flattened to one
string (there is no message array on the wire), files the user `@mentioned` are
read by core and appended verbatim, and the whole thing is posted as slot 0 of a
102-slot positional array to Google's `batchexecute` RPC. The response is a
stream of frames that each carry the **entire** reply so far; streaming is the
diff between consecutive frames. The provider declares `supportsTools: false`,
`auxiliaryCalls: false` and `requiresApiKey: false` — three capability flags that
between them say "this thing cannot call tools, cannot afford background calls,
and needs no key". Everything else in FreeCode is unchanged.

### Module layout

| File | Lines | Responsibility |
| --- | --- | --- |
| `protocol.ts` | 112 | Request construction: the 102-slot array, headers, `SAPISIDHASH`, URL |
| `client.ts` | 164 | Transport: one POST per turn, build-label scrape + cache, retry |
| `parse.ts` | 113 | Frame parsing, longest-wins extraction, `DeltaFold` for streaming |
| `inline.ts` | 191 | `@mention` → file contents, with budget, traversal refusal, binary skip |
| `models.ts` | 71 | The web UI's model table (`mode`/`think` slot values) |
| `settings.ts` | 76 | Optional cookie / cookieFile / authUser / xsrfToken |
| `index.ts` | 191 | `AIProvider` impl, system prompt, prompt assembly, registration |

---

## 3. The transport

### 3.1 Request — `batchexecute`

The endpoint is
`POST /_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`,
form-encoded, with the payload in `f.req` as a JSON array of ~102 **positional**
slots. There are no field names. Every slot set in `buildPayload` is annotated in
place, because an unlabelled `inner[41] = [2]` is unmaintainable the first time
the shape moves:

| Slot | Meaning |
| --- | --- |
| 0 | the message |
| 1 | language |
| 2 | conversation / response / choice ids — **left empty on purpose** |
| 17 | thinking depth, `[[0..4]]`, 0 deepest |
| 41 | `[2]` = persist to history (`1` + slot 45 would be a temporary chat) |
| 59 | a fresh UUID per request |
| 79 | `MODE_CATEGORY` — which model |

Slot 2 is the load-bearing decision. The server-side thread is real (replies
carry `c_`/`r_` ids) but using it would put conversation state somewhere FreeCode
cannot inspect, resume, fork or export, which is most of what `session/` is for.
So every request is a fresh chat and history is re-sent as text. That choice is
what makes §5.2 necessary.

### 3.2 The build label

The front end stamps its own version into every request (`bl=`). It moves every
few weeks, and a stale one is the single most common cause of a sudden 400 on a
session that worked yesterday. `getBuildLabel()` scrapes it off the live page and
caches it for an hour; `withRetry` force-refreshes on any 4xx, because that
failure is fixed by re-scraping and not by waiting. The pinned constant
(`boq_assistant-bard-web-server_20260827.05_p0`, observed live) is a fallback,
not a source of truth, and a previously-good scrape is preferred over it so a
transient network failure does not downgrade a working session.

### 3.3 Response — cumulative frames

```
)]}'
177
[["wrb.fr",null,"<JSON string>"]]
1396
[["wrb.fr",null,"<the same reply, longer>"]]
```

Each frame carries the whole reply so far, not a delta, and frames repeat. So:

- **The answer** is the longest text seen across the body (`extractResponseText`).
- **A streaming delta** is whatever the newest frame adds to what was already
  emitted (`DeltaFold.push`). A frame that is not a prefix-extension of what the
  user has already read means the model restarted upstream, and that throws
  rather than printing text contradicting what is on screen.
- A frame that fails to parse is **skipped, not fatal** — the next frame carries
  the whole reply again, so one bad frame costs nothing.

Two other quirks: an upstream rejection arrives as a `BardErrorInfo [n]` marker
inside a **200** body, so it is sniffed rather than read off the status code; and
Gemini inlines its own web-UI artefacts (code-execution echo blocks,
`googleusercontent.com/card_content` links) into the markdown, which `cleanText`
strips.

Retry wraps only connect + first byte on the streaming path. Once text has
reached the caller a retry would replay it, and the fold would reject the replay.

---

## 4. Measurements

Everything in §5 is downstream of these. They are recorded here in full because
each decision looks arbitrary — or looks like a shortcut — without the number
that forced it.

### E1 — Tool-call reliability over 9 real agent-loop turns

Running the session as an ordinary tool-using provider:

| Outcome | Rate |
| --- | --- |
| Emitted a tool call | **~56%** (5/9) |
| Answered from priors instead | **~44%** (4/9) |

The 44% is the finding, not the 56%. It did not error, refuse, or hedge — it
answered with total fluency and invented the evidence:

- Invented file contents wholesale.
- Reported **"23 quarantined cases"** for a file that says **3**, and supported
  it with a fabricated verbatim quote.
- Answered *"what is the first line of TRACE.md"* with **US Census population
  statistics**.

A backend that silently fabricates on nearly half its turns is worse than one
that errors, because an error is visible and a confident wrong answer is not.

### E2 — Three arms, one task

Task: *"quote the first line of TRACE.md"*. The hypothesis under test was that
the fabrication was a prompt-size or tool-count problem.

| Arm | Prompt | Tools | Result |
| --- | --- | --- | --- |
| Minimal system prompt + `read` | 1.8 KB | 1 | 5/9 called the tool |
| Full FreeCode system prompt | 100.7 KB | 16 | 5/9 correct |
| **No tools, contents inlined** | 9.8 KB | 0 | **4/4 correct, 0 empty** |

Shrinking the prompt **55×** and cutting 16 tools to 1 changed nothing —
both arms land at 5/9. The variable that mattered was not how much context the
model had to wade through, or how many tools it had to choose between. It was
whether answering *required* a tool call at all. Remove the requirement and the
failure disappears.

This is the whole reason the provider ships with `supportsTools: false`. It is a
measured design, not an unfinished one.

### E3 — Request spacing and empty replies

The session is throttled, and throttling surfaces as an empty reply rather than
a 429:

| Spacing | Empty replies |
| --- | --- |
| Back-to-back | **3/5** |
| 25 s apart | **1/4** |

So the budget for this provider is **requests**, not tokens.

### E4 — What a background call actually costs

One `freecode run` was measured at **two** requests: the user's turn, then
memory extraction re-uploading the same inlined file to mine memories out of it.
Under E3, that second request is not free — it is roughly a coin-flip on whether
the *next* user turn comes back empty. This produced `auxiliaryCalls` (§5.3).

### E5 — Mention scope across turns

First cut inlined mentions from the newest message only. Because §3.1 keeps no
server-side thread, a file named on turn 1 is simply gone by turn 2:

- Follow-up turn prompt collapsed to **634 bytes**.
- The model then **correctly** answered that it had never been shown the file.

Correct behaviour, useless session. Fixed by collecting mentions across every
user turn and inlining once on the newest message (§5.2).

### E6 — Observed limits

- Payload ceiling: **~60 KB** observed. Inline budget set to **45,000 bytes**,
  deliberately under it, because history is re-sent every turn.
- Build label observed live: `20260827.05_p0`; moves every few weeks.

### E7 — Verification at ship

- `1091` tests pass at commit 1; `1100` at commit 2 (9 new).
- 36 tests specific to this work: `parse.test.ts` (9), `inline.test.ts` (13),
  `web-credentials.test.ts` (9), `auxiliary-calls.test.ts` (5).
- `parse.ts` is tested against a **real captured response**
  (`fixtures/hello.txt`), scrubbed of conversation ids.
- `providers.list` over real JSON-RPC: `kind: "web"` ⇒ `gemini-web` `ready`;
  `kind: "api"` ⇒ 211 with no web entries; no `kind` ⇒ 212 (no existing caller
  changes).
- Credential write against a sandboxed `HOME` lands in `web`, **merges** rather
  than replaces, and leaves `providers` untouched.
- The TUI picker was driven end-to-end over a **pty**, which is what found both
  bugs in §6.3.

---

## 5. Decisions

### D1 — No tools reach the wire

`supportsTools: false`. Forced by **E1 + E2**. The corollary is that this
provider cannot edit, run, or search anything, which is why it needs **no mode
gating**: with no tools on the wire there is nothing for a permission profile to
deny. `plan`/`review`/`explore` restrictions are irrelevant here by construction.

### D2 — The user names files, core reads them

`inline.ts`. `@src/a.ts why does this fail?` becomes the same question with
`src/a.ts` appended verbatim in a fenced block, **after** the question — burying
the question under 40 KB of source is how it gets lost.

The rules are all failure-driven:

| Rule | Why |
| --- | --- |
| Mention must start at a word boundary | `me@example.com` is not a file read |
| Trailing punctuation trimmed after match | `@read.ts,` is a path plus a comma; `@read.ts` is not `@read` plus `.ts` |
| Traversal **refused**, not clamped | `@../../.ssh/id_rsa` is a request to leave the project; reading something else instead would be worse than refusing |
| Directories and binaries skipped | A binary inlined as text is pure payload burn |
| Over-budget file marked `[truncated]` | Silent shortening is exactly what the model would fill in itself (E1) |
| Over-budget *later* files reported skipped | Same reason |
| Collected newest-first | When budget runs out, the stalest file is dropped, not the one just asked about |

The budget is therefore **not a performance knob**. Content that does not fit is
content the model will be tempted to invent.

### D3 — Mentions are collected across all turns, inlined once

Forced by **E5**. Not "newest message only" (the file vanishes), and not "expand
in place" (the same bytes re-sent once per turn that mentioned them).

### D4 — A short system prompt, and one load-bearing sentence

E2 showed the 100 KB FreeCode preamble scored no better than 1.8 KB, and every
byte is re-sent every turn against an opaque quota. The prompt is ~8 lines.

The last clause matters more than its length suggests. An earlier draft ended
*"say which one and stop"* and was obeyed too well: one mistyped filename among
several made the model refuse the entire question instead of answering the parts
it did have files for. It now reads *"name it and answer whatever the included
files do cover"*.

The `dynamic-context` synthetic message (file tree, git head, clock) is filtered
out — it was the single largest contributor to the 100 KB and answers nothing
here, since files arrive by name.

### D5 — `auxiliaryCalls`, a new `ProviderInfo` capability

Forced by **E3 + E4**. A new optional flag meaning *may background subsystems
spend this provider on calls the user did not ask for?* Five sites in
`agent/loop.ts` check it via `allowsAuxiliaryCalls()`:

| Site | Fallback when denied |
| --- | --- |
| Memory extraction (and the consolidation in its slot) | Skipped, logged |
| Retrieval judge | Reuses the judge's designed off switch — omit the context |
| LLM compaction summaries | Heuristic summary, which costs nothing |
| Trajectory redirection | Disabled |

It **fails open**:

```ts
return registry.get(id)?.info.auxiliaryCalls !== false;
```

`!== false`, not `=== true`. An unregistered id or one that never declares the
flag is allowed. This gates politeness, not safety — a wrong `false` would
silently switch memory off for **every** provider, which is a far worse failure
than one extra request against a quota.

### D6 — No usage is reported

The endpoint returns no token counts at all. The obvious stand-in (`chars / 4`)
would flow into the daily spend tracker and the context meter as though it had
been measured. **Absent beats invented.** Compaction estimates locally anyway.

### D7 — `requiresApiKey: false`, and four-state status

A `hasApiKey` boolean cannot express the one provider that works out of the box.
`gemini-web` authenticates **anonymously**; a cookie only buys `gemini-3.1-pro`
real Pro routing, and only on a Gemini Advanced account — a free account
authenticates and then silently serves Flash. Rendering that as "not configured"
is a lie that sends the user hunting for a credential that does not exist.

`ProviderStatus` is therefore four states:

| State | Meaning |
| --- | --- |
| `ready` | Usable right now with nothing on file |
| `signed-in` | Optional credential present, session upgraded |
| `configured` | Required credential present |
| `needs-setup` | Required credential missing — **the only state that prompts** |

Nothing is `needs-setup` today. `providers.list` still returns `hasApiKey`
("selectable right now") for the VS Code and Tauri shells, and without `kind`
still returns all 212 providers, so no existing caller changed.

### D8 — Unknown model ids degrade, they do not error

`models.ts` holds the **web UI's** ids and their slot values, not the public
API's. They move when Google ships a new front end. `resolveGeminiWebModel`
falls back to the default rather than throwing: a stale id in someone's config
should degrade to a working model, not to a dead session. A `@think=N` suffix
overrides thinking depth.

---

## 6. Config surface

### 6.1 A separate `web` block

```json
{
  "web": { "gemini-web": { "cookie": "SID=…; SAPISID=…", "authUser": "1" } }
}
```

Kept out of `providers` on purpose. A key in `providers` bills a card; a `web`
entry holds a cookie or a JWT lifted from a signed-in tab — different secrets,
different lifetimes, different blast radius. One shared block and you cannot tell
by looking whether an entry costs money.

The entry stores the **credential only**. `current.model` already holds the
model, and a second copy would be the third dead `model` field in this file.

`hasWebCredential` counts `cookie`/`cookieFile`/`apiKey` and deliberately **not**
`authUser` or `xsrfToken`: those modify a session rather than authenticate one,
so an entry holding only those is still anonymous and must say so.

`readWebCredential` still falls back to `providers["gemini-web"]`, where the
cookie was documented before this block existed. Dropping that read would surface
as Pro quietly serving Flash, not as an error.

Everything in `settings.ts` is optional, and a missing or malformed cookie file
degrades to anonymous rather than failing the session.

### 6.2 The picker, and why `local-catalogue.ts` exists

`providers.list` / `models.list` are served from **models.dev**, which indexes
public metered APIs and will never index a web session. Without a local
catalogue, `gemini-web` was invisible in the picker and selectable only by
hand-editing `config.json`.

`LOCAL_PROVIDERS` entries carry a `WebCredentialSpec` — the field to write, the
noun for the prompt, and a hint about what it buys. Core declares what to prompt
for; the shell renders it and writes wherever `field` says. It does **not** carry
a table of which provider wants a cookie. Adding a second web provider is one
catalogue entry plus a `readWebCredential` call.

Two pickers over one `current`: `/model` lists the models.dev catalogue and
spends an API key, `/web` lists web-session providers and spends a request quota.
Both write `current`, so switching either way is symmetric.

### 6.3 Two bugs found by driving the real TUI over a pty

Both pre-existing, neither introduced here:

- **Picking a model left the input dead until restart.** `hideModelSelector`
  spliced the selector out of `tui.children` but never restored focus, so
  keystrokes landed on a detached component. Every *cancel* path restored focus;
  the *select* path — the one everyone takes — did not. This is also the entire
  content of "the switched model needs a restart": `session.send` already
  re-reads `config.json` every turn.
- **The credential row rendered first**, so Enter opened the cookie prompt
  instead of selecting a model. An optional credential not on file now sorts
  last; replacing one that exists stays first, where `/model` has always put it.

---

## 7. Non-goals

- **Tool use.** See D1. Not deferred — designed out, on evidence.
- **Server-side conversation threads.** See §3.1.
- **Browser automation.** No Playwright, no sidecar, no new dependency.
- **Usage accounting.** See D6.
- **Mode gating.** Unnecessary by construction (D1).
- **The Python reference implementation this protocol work was ported from.**
  Never entered the tree and should not.

---

## 8. Known gaps

Carried into `TODO.md` under *Findings (gemini-web provider — 2026-08-29)*.

1. **`writeConfig` sets no file mode.** A fresh `config.json` lands `0644` on a
   default umask while holding every API key *and* now a session cookie.
   `web/auth.ts` already does this correctly with `0o600` plus a `chmod` for
   existing files. Explicitly not addressed at ship; the highest-value fix here.
2. **The pinned build label will rot.** By design it is a fallback, but if the
   scrape breaks permanently (page restructure) the failure is a hard 400 with a
   misleading message.
3. **Model ids move.** `models.ts` mirrors a UI that Google reships. D8 makes a
   stale id degrade quietly — which also means a user can be served a different
   model than the one they picked, with no signal.
4. **No usage means no meter.** D6 is right, but the consequence is that the
   daily tracker and context meter are blank for this provider, and there is
   currently no per-provider "not measurable" affordance in the UI to say so.
5. **`readWebCredential`'s `providers` fallback is a compatibility shim** for
   pre-`web`-block configs and has no removal plan.
6. **`ProviderCredentials.model` is declared and read by nothing** — noticed
   while designing §6.1, pre-existing dead field.
7. **E1–E5 were run by hand.** None of them is an eval case, so nothing detects
   it if a future change re-introduces tools here or breaks mention inlining.
   The `evals/` harness now has a sandbox and could hold at least E2 and E5.

---

## 9. Open questions

- Should E3's spacing become an actual client-side rate limiter, rather than
  relying on human typing speed to provide it?
- Is `auxiliaryCalls` the right granularity, or does it eventually want to be a
  budget (n background calls per hour) rather than a boolean?
- Does the `@mention` inlining in `inline.ts` belong to this provider at all, or
  is it generally useful — a metered provider with a cold cache pays real money
  for a tool round trip that a mention would have avoided.

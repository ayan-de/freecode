# Fire-Fighter Mode for FreeCode

> A FreeCode-native implementation of the [fire-fighter trial brief](markdown.md).
> One rotating dev owns incoming Slack questions, bugs, and feature requests. An
> agent running on the FreeCode CLI backend does the work; the on-duty dev
> supplies judgment and approval only. Shifts rotate, memory doesn't.

The brief describes a system, not a stack. This document maps every requirement
onto FreeCode's architecture — thin-client frontends talking JSON-RPC to the
`apps/core` backend, which runs the agent loop, holds memory, fires hooks, and
gates tools through the permission rules engine.

Every file reference has been checked against the tree. Where a mechanism does
not exist yet, it says so. Where this design departs from the brief's *suggested*
stack, §16 states the departure and what conforming would cost. §21 traces all
eleven core requirements to the section that satisfies them.

---

## 1. The problem

Support traffic arrives in Slack: questions, bug reports, small feature requests,
large feature requests. Today the fire-fighter copy-pastes:

```
slack message ──▶ paste into FreeCode TUI ──▶ agent runs ──▶ paste answer back
```

The human supplies routing, judgment, and approval. The agent already supplies
the thinking. **Fire-fighter mode removes the routing and the copy-paste, and
keeps the judgment.**

Three message shapes, each with its own contract:

1. **Questions** — resolve immediately and correctly.
2. **Feature requests** — small ones ship; large ones get follow-ups, a scoped
   issue with a value/blocking/customer-weight assessment, and an honest
   acknowledgment (§12).
3. **Bug reports** — reproduce, fix, PR, human merges, reply in thread (§11).

These are *contracts the model honors*, not branches in your code. There is no
`if (type === "bug")` anywhere in this design, and no bug-handling state machine.
There is no "handle a bug" capability — only the pieces a bug happens to need.

---

## 2. What you build

| Piece | Lives in | Status |
| --- | --- | --- |
| Slack Events webhook | `apps/core/src/firefighter/webhook.ts`, mounted on `web-server.ts` | **new** |
| Triage | `firefighter/triage.ts` → `providers/registry.ts` | **new** (registry exists) |
| Opening-prompt builder | `firefighter/build-prompt.ts` | **new** |
| Rotation | `firefighter/rotation.ts` | **new** |
| Generic agent | `agent/loop.ts` + a firefighter skill | **reuse** |
| Integrations | MCP servers via `mcp/init.ts` | **new servers**, existing plumbing |
| Approval | `firefighter_ask` tool modeled on `tools/question.ts` | **new tool**, existing transport |
| Sandbox + browser + recording | E2B MCP server (§11) | **new** |
| Dashboard + chat | New frontend against existing IPC (§14) | **new** |
| Memory | `memory/` + `memory/graph/` | **reuse**, org-scope change (§13) |

No new tool loops. No per-message-type state machines. **One generic agent, two
ways in, one approval surface.**

---

## 3. Architecture

```
                      Slack workspace
                            │
                            │ Events API  (message.channels)
                            ▼
      ┌───────────────────────────────────────────────────┐
      │ apps/core — firefighter ingest                     │
      │  ┌────────────┐  verify sig, 3s ack, dedup, drop   │
      │  │ hear all   │  own-message echoes  (§4.1)        │
      │  │ channels   │                                    │
      │  └─────┬──────┘                                    │
      │        │ every message ──▶ memory (both sides)     │
      │        ▼                                           │
      │  ┌────────────────┐   customer channels only       │
      │  │ cheap triage   │   {wake: bool, reason}         │
      │  └───────┬────────┘                                │
      │          │ wake                                    │
      │          ▼                                         │
      │  ┌───────────────────────────┐                     │
      │  │ build opening prompt      │  thread hydrated    │
      │  │  msg + thread + memories  │  server-side, with  │
      │  │  + on-duty identity       │  the user token     │
      │  └───────────┬───────────────┘                     │
      └──────────────┼─────────────────────────────────────┘
                     │ session.start → session.send
                     ▼
      ┌───────────────────────────────────────────────────┐
      │ Agent loop (agent/loop.ts)                         │
      │ identical to the human-facing chat; only the       │
      │ first message differs                              │
      └──────────────┬────────────────────────────────────┘
                     │
       ┌─────────────┴──────────────┐
       ▼                            ▼
 ┌──────────────┐          ┌─────────────────────┐
 │ work tools   │          │ firefighter_ask     │  ← the MODEL calls this
 │ read/edit/   │          │ (blocks on a human) │     when IT decides it
 │ bash/grep/   │          └──────────┬──────────┘     needs approval
 │ MCP: slack,  │                     │
 │ github,      │                     │ question_asked event
 │ linear,      │                     ▼
 │ supabase,    │          ┌─────────────────────┐
 │ langsmith,   │          │ Dashboard           │
 │ betterstack, │          │ approve/edit/reject │ ── the only writer
 │ e2b          │          └──────────┬──────────┘
 │              │                     │ question.answer
 │ NOT gated ───┘                     │ (edited text wins)
 │ on outbound  │  ◀──────────────────┘
 └──────┬───────┘
        ▼
   Slack reply / PR / Linear issue, as the on-duty engineer
```

**Key principle, and the thing most likely to be built wrong:** the harness does
not gate outbound messages. At the tool layer a Slack reply, a Linear issue, and
a PR are the same shape of call — gating that layer gates everything and leaves
an agent that can't act. So `hooks/PermissionRequest.ts` and the `permission/`
rules engine are deliberately **left open** on outbound tools. Escalation is a
tool the model chooses to call.

---

## 4. Ingest and triage

### 4.1 Webhook

`apps/core/src/firefighter/webhook.ts`, mounted as a route on the existing HTTP
server. `web-server.ts:159` is a raw `http.createServer` dispatching on
`pathname` (`POST /api` for JSON-RPC at line 206, `GET /events` for SSE at line
231); a `POST /slack/events` branch slots in alongside them.

Five things that are not optional and each cost a day if missed:

- **Verify the signing secret.** HMAC over `v0:{timestamp}:{rawBody}`, reject if
  the timestamp is more than five minutes old. This needs the *raw* body, so the
  route reads the buffer before any JSON parse.
- **Ack in under 3 seconds, then work.** Slack retries on timeout. Return `200`
  immediately, queue the event, process async.
- **De-dup on retries.** Slack resends with `X-Slack-Retry-Num`. Key on
  `event_id`, drop repeats, or the drill produces duplicate replies.
- **Drop the agent's own echo.** The reply posted with the on-duty engineer's
  *user* token comes straight back as a new `message.channels` event. Without a
  suppression set keyed on the `ts` you post, the agent replies to itself in a
  live customer channel. This is the single most likely way to lose a day — test
  it in `#test-firedrill` on day 2, not day 6.
- **Channels only.** `message.im` / `message.groups` rejected at the edge even
  though the app has no DM scopes. Defense in depth, and it documents the intent.

**Everything heard goes into memory** — including internal channels, which are
stored but never triaged.

### 4.2 Triage

A cheap model gets the message and a small system prompt:

```
You are a triage classifier for a software team's Slack channels.
Decide whether the latest message in this thread needs a coding agent.
Output JSON: { "wake": boolean, "reason": string }
```

Only customer channels reach this step. Most messages are banter and return
`wake: false`.

Before the model call, a free pre-filter drops joins/leaves, bot messages,
reactions, and messages under ~15 characters. Note `providers/registry.ts` has
**no response cache** — it resolves providers, nothing more — and prompt caching
wouldn't help here anyway, since each triage prompt is short and unique. The
pre-filter is the cost lever, not caching.

### 4.3 Model selection

Two models, both configured in `.freecode/settings.json` under a `firefighter`
key, following the pattern `memory.autoExtract` already uses
(`memory/extract-policy.ts:106`):

```jsonc
{
  "firefighter": {
    "model": "claude-fable-5",              // main agent
    "triageModel": "claude-haiku-4-5-20251001"
  }
}
```

The brief is explicit that this loop talks to real customers under real names and
that tokens are the wrong thing to economize on (`markdown.md:104`). The main
agent runs the strongest model available; the savings come from triage filtering
and from subagents keeping the main context small, not from a weaker model.

### 4.4 Building the opening prompt

`firefighter/build-prompt.ts` assembles, in order:

1. The message text and its channel/thread identifiers.
2. **The full Slack thread**, fetched server-side. This must *not* go through the
   `webfetch` tool: `executeWebFetch` (`tools/webfetch.ts:86`) issues a hardcoded
   `GET` with a fixed header set and no `Authorization`, so it cannot call
   `conversations.replies`. Thread hydration is prompt construction, not a tool
   call — it belongs in the ingest module with the user token.
3. Relevant org memories via `findRelevantMemories` (`memory/mem-query.ts:50`),
   widened by `cascadeRetrieve` (`memory/graph/cascade.ts:30`) when the graph
   sidecar is built.
4. The on-duty engineer's identity: Slack handle, GitHub handle, which token the
   run acts under.
5. The standard system prompt the loop already prepends.

**Protocol gap:** the run must be *marked* as a fire-fighter run so the dashboard
can list it. `session.start` takes only `{ projectPath, provider }` and
`session.send` only `{ sessionId, message, images? }`
(`packages/shared/src/ipc/protocol.ts:188,192`) — neither carries metadata. Add
an optional `metadata?: Record<string, unknown>` to `session.start` and thread it
into the session record. Small, but it touches shared protocol — do it day 1.

---

## 5. The agent

The same `agent/loop.ts` contributors already use. **No fire-fighter mode in the
loop.** A bug and a feature request differ only in which tools the model reaches
for.

What differs is the prompt and the tool set:

- **A skill** carries the domain: message contracts, identity model, escalation
  rules, writing guide, the §12 assessment rubric. FreeCode discovers skills at
  `<skills-dir>/<name>/SKILL.md` (`skills/loader.ts:71`), searching
  `.freecode/skills/`, `.claude/skills/`, `.agents/skills/` under project and
  home — so this lives at **`.freecode/skills/firefighter/SKILL.md`**, not in
  `apps/core/src`. On-demand loading (`skills/injection.ts`) lets the model pull
  deeper guidance once it knows the message shape.
- **Read the repo's conventions first.** The brief requires PRs to follow repo
  convention (req 7) and points at `AGENTS.md` at the monorepo root. The skill
  instructs the agent to read it before its first PR, and the opening prompt
  includes it once the repo is known — conventions are context, not a lookup the
  agent should rediscover per run.
- **Permission posture is deliberately permissive.** `permission/profiles.ts`
  profiles are capability booleans — `fileRead / fileWrite / network / shell /
  subprocess / mcpServers` on a fixed `PROFILES` const — *not* per-tool allow/ask
  lists. Per-tool posture lives in `permission/rules.ts` +
  `.freecode/settings.json`. Consequences:
  - `standard` has `network: false`, so a fire-fighter run needs `elevated` or a
    new entry in the const.
  - Outbound MCP tools (`mcp__slack__*`, `mcp__github__*`, `mcp__linear__*`) get
    blanket `allow` rules. Gating them is the failure mode §3 describes.
  - `write` / `edit` / `bash` may still be path-gated as a seatbelt on the
    checkout. That protects the repo; it must never be the approval path for
    customer communication.

### 5.1 Subagents

`agent/subagent.ts` via the `agent` tool already exists. The skill teaches
delegation so the main context stays small:

- **repro** — boot a sandbox, bring the dev server up, drive the browser, record,
  report logs (§11.2).
- **fix** — implement, run the verifier, return a diff summary.
- **reply** — draft in the on-duty engineer's voice (§10).

Subagents take a permission profile, which is where the capability booleans are
the right tool: the `reply` subagent has no business holding shell.

### 5.2 Recording every step

`rollout/recorder.ts` already persists every tool call and result, and
`rollout/trace.ts` renders spans, so fire-fighter runs get replay and
`freecode trace` for free. This is also the audit log referenced in §15.

One thing to watch: a parked approval shows as a tool span open for however long
the human takes. The fetch-layer timeouts won't fire (no provider call is in
flight), but confirm the trace renderer reads a long `firefighter_ask` as waiting
rather than hung.

---

## 6. Reaching the integrations — the code-mode decision

The brief calls this "the central decision of this trial" (`markdown.md:37`):
flat tool schemas, generated code against typed APIs, or MCP servers.

**Decision: MCP servers for the integrations, with a code-mode escape hatch via
`bash`.**

- FreeCode's tool path is `buildTool` → `tools/index.ts` → orchestrator, and MCP
  tools ride the identical path via `registerMcpTool` (`tools/index.ts:84`,
  called from `mcp/init.ts:73`) under an `mcp__<server>__` prefix. Integrations
  cost a config entry, not a code change, and inherit batching, permission
  evaluation, rollout recording, and tracing unmodified.
- The argument for code mode is tool-count bloat: seven integrations × ~8
  operations is ~55 schemas in every request. FreeCode has an answer that isn't a
  second architecture — MCP servers connect and disconnect at runtime
  (`mcp/init.ts:127,165`), so a run loads Slack and GitHub always, and Supabase /
  LangSmith / Better Stack only when debugging.
- Where code mode genuinely wins is multi-step data work — "pull the last 200
  events, group by user, find the ones that also errored." That is `bash` with a
  script against a CLI wrapper that reads credentials from its own environment.
  The model already has `bash`; no new surface is needed.

**What the Cloudflare posts change here.** Code Mode's core claim is that models
write code better than they chain tool calls, and Project Think extends that to
letting the model author against typed APIs in a sandbox. That claim is accepted
above — it is exactly why the `bash` escape hatch exists rather than a fortieth
tool schema. What is *not* adopted is Worker Loader as the execution substrate,
because that presumes the Workers runtime, which §16 explains this build does not
use. The mechanism is borrowed; the runtime is not.

**Credentials.** Model-authored code never touches raw secrets (`markdown.md:38`).
Tokens live in the MCP servers' and wrappers' environments; the model addresses
them by handle (`--as-engineer luka`), never by value. The one easy way to break
this is `bash` — a wrapper that echoes its token, or a `curl` the model writes
with a token pasted from context. Keep tokens out of the agent's context entirely
and the failure mode cannot occur. See §15.

### 6.1 Adding a first-party tool

If any integration becomes a built-in rather than MCP, `buildTool` +
`tools/index.ts` is **not sufficient** — several tables key off the tool name and
a miss fails closed. Per `CLAUDE.md`, also update:

- `permission/mode-policy.ts` — `READONLY_TOOLS` (line 15) if it only reads.
- `permission/rules.ts` — `PATH_TOOLS` (line 10) or `URL_TOOLS` (line 11) so
  path/url-scoped rules match. `extractTarget` reads `filePath`/`path`/`cwd` and
  `url`/`query` respectively (lines 51–56) — name params accordingly.
- `permission/suggest.ts` — `DISPLAY_NAMES` for the permission prompt label.

---

## 7. The integrations, and when the agent reaches for each

The brief lists seven capabilities and gives each a usage context. Listing the
servers is not enough — the skill has to say *when*, or the model won't reach for
them.

| Trigger in the thread | Server | What it answers |
| --- | --- | --- |
| Any run | `slack` | Read the thread, post the reply, upload proof (§11.3) |
| A fix is ready | `github` | Open the PR as the fire-fighter; read `AGENTS.md` and PR conventions |
| Anything worth tracking | `linear` | File and update issues; assessment on large asks (§12) |
| "my data looks wrong" / "the number is off" | `supabase` (prod, **read-only**) | Query the customer's actual rows before assuming a code bug |
| "your AI did something weird" | `langsmith` | Pull the trace for that run and read the real prompt and response |
| "is it down?" / "everything is slow" | `betterstack` | Logs and uptime — check prod before reproducing locally |
| Repro needed | `e2b` | Boot a machine, dev server, headless browser, recording (§11) |

Two rules the skill states explicitly:

- **Check prod before reproducing.** Better Stack and Supabase are cheap and
  fast; booting a sandbox is not. A customer reporting breakage during an outage
  needs an honest status reply, not a four-minute repro.
- **Supabase is read-only and stays read-only.** The credentials are read-only,
  and the skill says so, so the model never plans a write it cannot perform.

---

## 8. Identity

The customer never sees a bot. Replies come from the on-duty engineer's own Slack
account; PRs open under their own GitHub identity.

- **One Slack app, two tokens.** The user token posts replies; the bot token
  sends the nudge. A second app is never needed.
- **A self-DM with your own user token does not push-notify.** That is what the
  bot token is for. The nudge is a bot DM with a preview and a plain URL button
  to the dashboard — a link button needs no interactivity endpoint and no handler
  code.
- **Per-engineer OAuth, once, on the dashboard.** Slack and GitHub. You build the
  OAuth flow, the token storage, and the webhook; you do not touch the app
  manifest. The dashboard shows connect status for all four fire-fighters.
- **Rotation is derived, not advanced.** `firefighter/rotation.ts` holds
  `{ engineers[], anchorDate, shiftLengthDays: 3 }` and computes who is on duty
  from the clock. Derived means it cannot drift and a restart cannot skip a
  shift. Viewers have no rotation slot and no OAuth.

---

## 9. Approval

**Approval is model-decided.** The model calls a tool when it judges a human
should see something. The harness does not intercept outbound calls.

### 9.1 The mechanism already exists

`tools/question.ts` is exactly this shape: `executeQuestion` (line 193) mints a
`requestId`, `await`s `askQuestion(...)`, and the loop parks until a human
answers. The request surfaces as a `question_asked` stream event
(`protocol.ts:156`) and resolves via `question.answer` / `question.reject`
(`protocol.ts:271,275`). On rejection the tool returns an error the model can
read and act on, rather than killing the run.

`firefighter_ask` is that tool with an approval payload:

```
firefighter_ask({
  action: "slack_reply" | "linear_issue" | "pr_body",
  channel, threadTs,
  draft: string,
  rationale: string,     // why this needs a human
})
  → { decision: "approved" | "edited" | "rejected", text?: string }
```

On `edited`, the returned text is what the model sends — the human's wording wins
and becomes the canonical stored text (§13). On `rejected`, the reason returns to
the model and goes to memory.

Register it per §6.1; it belongs in `READONLY_TOOLS` (`mode-policy.ts:15`)
alongside `question`, since asking is not a mutation.

### 9.2 What the model escalates

Carried into the skill verbatim, because this is prompt work, not code:

> **Escalate:** committing the team to something, closing a thread, telling a
> customer no, anything that would embarrass the engineer whose name is on it.
>
> **Send without asking:** a clarifying question, a "we're on it" while a fix is
> in review. Four messages of scoping a feature request should cost the on-duty
> engineer one click, not four.

It will sometimes be wrong. Best effort is what is graded — and drill scenario 4
counts the clicks, so an over-cautious agent fails just as surely as a reckless
one. §12 makes the click discipline concrete.

### 9.3 One writer

Approval happens on the dashboard and nowhere else. Slack nudges; the dashboard
decides. One writer means no Slack interactivity infra and no two-surface sync.

A TUI panel may *display* pending approvals — natural for FreeCode, cheap to
build — but it must not write. If it writes, there are two surfaces to reconcile,
which is what the single-writer rule exists to prevent.

---

## 10. How the messages read

Every reply that reaches a customer should be indistinguishable from one the
on-duty engineer typed. Rules first, then the thing that actually works:

- Direct, technical, no preamble.
- No "Great question!"
- No bulleted summary of what was just said.
- No closing paragraph restating the answer.

Models pattern-match far better off contrast than off rules, so the skill carries
paired counter-examples — the same reply written both ways:

> **Bad**
> Great question! Let me help you with that.
>
> To add a second language variant without duplicating the funnel, you'll want to
> use variant groups. Here's how:
>
> 1. Navigate to your funnel settings
> 2. Click "Add variant"
> 3. Select the language
>
> Let me know if you have any other questions!

> **Good**
> Variant groups — Funnel settings → Add variant → pick the language. It shares
> the step graph, so edits to the base funnel propagate. The one gotcha is that
> per-variant copy overrides don't inherit, so you'll set those once per language.

> **Bad**
> Thanks for reporting this! I've investigated the issue and found the root
> cause. The export handler was not properly handling the 403 response. I've
> opened a PR with a fix. Please let me know if you need anything else!

> **Good**
> The export handler was swallowing a 403 after yesterday's auth change. PR is
> up with a recording of the fix — live once it merges.

The `reply` subagent's prompt enforces this. Approved and edited replies
accumulate in memory as further examples, so the voice sharpens across shifts —
an edit is the team teaching the agent its register, and §13 stores it as such.

It goes out under a real person's name. If prompt work stops at correctness, this
is where the drill catches you.

---

## 11. Shipping a fix: bug or small feature

```
triaged message
  └─▶ check prod first (Better Stack / Supabase) — §7
  └─▶ file the Linear issue
      └─▶ subagent: repro in an E2B sandbox, dev server up, headless
          browser, recording captured
          └─▶ subagent: fix + runVerify (agent/verify.ts:78)
              └─▶ open the PR as the on-duty engineer
                  ├── base: staging
                  ├── body: Linear link + repro + verifier output + recording
                  └── on merge: closes the issue
  └─▶ draft the reply, with the recording
      └─▶ firefighter_ask → dashboard → sent under the engineer's name
```

The verifier is the same one the human loop uses: `runVerify`
(`apps/core/src/agent/verify.ts:78`) is imported by `agent/loop.ts:57`, with the
command resolved by `resolveVerifyCommand` (line 49). No fire-fighter-specific
verification logic.

### 11.1 Sandbox provider: E2B

**Decision: E2B**, reached through its MCP server so the choice stays reversible.

Why, in the order that matters:

- **Custom templates with warm dependencies.** The monorepo's `node_modules`
  bakes into the template image, so a repro starts from an installed tree rather
  than a cold `pnpm install`. That is the difference between a ~20-second repro
  and a ~4-minute one, and scenario 3 is judged partly on "within minutes."
- **Per-second billing** on a $500 ceiling that also has to cover tokens.
- **A real Linux filesystem and a first-class Node SDK**, so the MCP wrapper is
  thin and the agent's mental model is just "a machine."
- **Chromium available in-image**, which keeps browser verification (§11.2) in
  the same box as the dev server — no cross-network flakiness between the
  browser and the app under test.

The alternative worth naming: **Fly Machines**, better if you want a stable
public URL per sandbox and longer-lived instances. It loses on boot latency and
on template warmth. **Cloudflare Sandboxes** would be the natural pick if core
ran on Workers — §16 explains why it doesn't, and picking a sandbox to match a
runtime you aren't using is the wrong tail wagging the dog.

Template rebuild is keyed on the lockfile hash: change the lockfile, rebuild the
image; otherwise reuse. A hard TTL kills any sandbox after 15 minutes so a
crashed run cannot bill overnight (§17).

### 11.2 Getting the dev server up

The brief requires the agent to get the monorepo's dev server running on the
machine it booted (req 6). Concretely, the `repro` subagent:

1. Clones at the PR's base SHA (or `staging` HEAD) into the warm template.
2. Reads `AGENTS.md` at the repo root for the documented dev command — the brief
   says local dev setup is documented there, so the agent reads it rather than
   guessing between `dev`, `start`, and `serve`.
3. Runs the dev command in the background, then **polls the port until it
   answers** rather than sleeping a fixed interval. Fixed sleeps are how this
   step becomes flaky under drill conditions.
4. On timeout, returns the server's stdout/stderr to the main agent instead of
   failing silently — a dev server that won't boot is itself a finding worth
   telling the customer about.

### 11.3 The recording pipeline

This is three separate problems and the brief needs all three (req 6: recording
attached to *both* the PR and the customer reply).

- **Capture.** Playwright with `recordVideo` against the sandbox's Chromium
  produces a `.webm` of the failing flow, then of the fixed flow. Both are worth
  keeping; the customer sees the fixed one.
- **Store.** Pull the bytes back over the MCP call and put them in Cloudflare R2
  — same account already holding Access and Tunnel (§16), so it adds no vendor.
  A signed URL with a long expiry goes in the PR body.
- **Attach to Slack.** Slack does not render an arbitrary URL as an inline
  player, so proof in the thread means a real file upload:
  `files.getUploadURLExternal` → PUT the bytes → `files.completeUploadExternal`
  with the thread's `channel` and `thread_ts`.

**This needs a scope you do not have on day 0.** The brief states event
subscriptions and scopes are locked to channel history and `chat:write`, and that
you request anything else in `#eng-firefighter` with a reason
(`markdown.md:112`). File upload needs `files:write`. Ask on day 1, not day 6.

Fallback if the scope is declined: post the R2 link in the thread as a plain URL
with a one-line description. Weaker, still passes "the recording in both places,"
and costs nothing to keep as a code path behind a flag.

---

## 12. Large feature requests

This is drill scenario 4, and the one most likely to be lost on process rather
than capability. The brief wants three things: useful follow-up questions, a
scoped Linear issue with a value/blocking/customer-weight assessment, and an
honest acknowledgment that doesn't overpromise — with the clicks counted.

### 12.1 The click discipline

The insight that makes this pass: **clarifying questions are in the
send-without-asking bucket** (§9.2). A four-message scoping conversation is four
outbound Slack messages and **zero** approvals. Only two things escalate:

- the final acknowledgment, because it tells the customer where this stands, and
- anything that reads as a commitment.

So the shape is: question → answer → question → answer → *one*
`firefighter_ask` for the acknowledgment. One click, four messages. An
implementation that routes each question through approval fails this scenario
even if every message is perfect.

The second discipline: **batch the questions**. Three related questions in one
Slack message beats three messages, for the customer as much as for the count.

### 12.2 The assessment

Three axes, scored 1–5 with anchors so the scores mean the same thing across
shifts and across runs. The rubric lives in the skill:

| Axis | 1 | 3 | 5 |
| --- | --- | --- | --- |
| **Value to the platform** | One customer's workflow only | Several customers would use it | Changes what the product is for |
| **How blocking** | Nice to have; they have a workaround | Painful workaround, they're doing it | They cannot ship without it |
| **Customer weight** | New, small, exploring | Established, healthy usage | Strategic; churn would hurt |

The scores don't decide anything on their own — they make the decision legible to
whoever reads the issue in three weeks. The skill instructs the agent to write
one sentence of rationale per axis, because a bare `4/5/3` is not an assessment.

### 12.3 The Linear issue

```
Title:  <verb-first, one line, what the customer would call it>

Context
  Who asked, when, thread link.

Ask
  What they actually want, in their words where possible.

Assessment
  Value to platform:  N/5 — one sentence
  How blocking:       N/5 — one sentence
  Customer weight:    N/5 — one sentence

Scope sketch
  What building it would touch. Not a plan; a size.

Open questions
  Anything the follow-ups didn't resolve.
```

### 12.4 The acknowledgment

Honest means honest about position, not vague. The skill's rule: say what is
true, say what happens next, do not name a date the team has not agreed to.

> **Bad** — "Great idea! We've added it to our roadmap and will keep you posted."
>
> **Good** — "Filed as ZEL-412 with the scoping from this thread. It's a real
> chunk of work — the variant model doesn't support per-market pricing today, so
> it's not a small change. I'm not going to promise a date before the team
> looks at it. If the workaround is blocking you this week, tell me and I'll
> push on it."

---

## 13. Memory model

Two sides, both durable across shifts.

- **What the customer said** — channel, thread ts, author, text. Cited by the
  chat page when answering "what happened with X?"
- **What the agent did** — run id, triage verdict, tools run, what was drafted,
  approved, edited, rejected, and the final sent text.

### 13.1 Two constraints the existing store imposes

**Memory is per-project, not org-scoped.** `MemoryStore`'s constructor takes a
`projectPath` and `getMemoryBaseDir` (`memory/mem-store.ts:20`) derives the
directory from a sanitized project name. "Org-scoped" therefore means every
fire-fighter run — and the chat page — constructs its store against **one fixed
project path**, or `MemoryStore` grows an explicit shared-base-dir option. Decide
day 1; retrofitting means migrating files between directories. Pin the constant
in one place: `/repo` and `/repo/` produce two stores and the second shift
inherits nothing.

**`MemoryEntry` has no `source` field.** The shape is
`{ name, description, type, content, createdAt, updatedAt, tags?, supersedes? }`
(`memory/mem-types.ts:19`), and `type` is a closed union of
`"user" | "feedback" | "project" | "reference"` (line 6). Provenance goes in
**`tags`**:

| Memory | `type` | `tags` |
| --- | --- | --- |
| A customer message | `reference` | `slack`, `channel:<id>`, `thread:<ts>`, `customer:<name>` |
| A run outcome | `project` | `firefighter-run`, `run:<id>`, `customer:<name>` |
| A rejected or edited draft | `feedback` | `firefighter-rejection` / `firefighter-edit`, `customer:<name>` |
| A shift handoff | `project` | `shift-handoff`, `shift:<n>` |

`tags` feed `HasTag` edges in the knowledge graph, so tagging by customer makes
"everything about PulseFit" a graph walk rather than a substring search.
`feedback` is right for rejections and edits because they are guidance about how
to work — which is exactly what they are.

**There are no `memory.*` IPC methods.** Despite the table in `CLAUDE.md`,
`packages/shared/src/ipc/protocol.ts` defines none — memory is reached through
the `memory` tool and `MemoryStore` in-process, with a `memory_saved` stream
event (line 112). The chat page's search needs `memory.query` added to the
protocol; add it once and let both the chat page and any CLI use it.

### 13.2 Shift handoff

Every three days, summarize what the last shift taught the agent: which customers
were touchy, which drafts got rejected and why, what got punted. A
`findRelevantMemories` query over the shift window, written back as one `project`
memory tagged `shift-handoff`. The next fire-fighter inherits it without reading
three days of runs, and it lands in the retrieval set for every subsequent run.

---

## 14. The dashboard

Two pages. Don't build more.

1. **Dashboard** — rotation (previous / current / next), per-engineer connect
   status, counters (heard / ingested / triaged / escalated / sent), the run
   list, and the approval card for the active run.
2. **Chat** — a human types first. "Did PulseFit complain about checkout before?"
   answers with citations to the actual threads. "Ship the copy-ID button Priya
   asked for" starts a run by hand. Same session shape as a triaged run; only the
   first message differs.

The wireframe prototype in the brief (`markdown.md:76`) is illustrative only —
shadcn defaults are fine and nobody is grading CSS.

Live runs are watchable and steerable: the stream exists (`GET /events` SSE at
`web-server.ts:231`, `StreamEvent` in `protocol.ts`), and steering mid-flight is
`session.send` into a running session, which the loop already handles by queueing
the follow-up.

**The UX bar, which is graded.** The brief wants an app that works and then
disappears: nothing to configure, nothing to learn, the approval waiting where
the engineer already was. Concretely —

- Someone opening the dashboard cold understands it in 30 seconds. That means the
  approval card is the largest thing on the page when one is pending, and the
  page is mostly empty when none is.
- Loading, error, and empty states exist on both pages. Empty state matters most:
  a fresh dashboard on day 1 should read as "nothing needs you" rather than as
  broken.
- The engineer should never need to keep a tab open. The Slack nudge is the
  entry point; the dashboard is where the decision happens.

**Honest scoping note.** `apps/web` today has exactly two pages — the landing page
and an internal architecture diagram — and no session-streaming client. The chat
UI exists only in `apps/tui` and `apps/vscode`. The dashboard is a fresh frontend
against the existing IPC surface, not a composition of existing web components.
It is the single largest net-new piece.

**Auth gate.** Cloudflare Access with an email or Google policy in front of the
deployment, restricted to the team domain, plus a temporary personal-email
override noted in the README so it can be pulled afterwards. Nothing custom, no
login code in the app.

**Roles are hardcoded.** A map of email → `{ role: "firefighter" | "viewer",
slackUserId, githubHandle, rotationSlot? }` — four fire-fighters who rotate and
connect accounts, three viewers with dashboard and chat only. Nobody is grading
IAM.

---

## 15. Security model

The brief requires that model-authored code never touches raw credentials and
that the README's security section match the code (`markdown.md:38`). This
section is that security section; it is written to be checkable against the
implementation.

| Surface | Control |
| --- | --- |
| Slack webhook | HMAC signature over the raw body + 5-minute timestamp window; unsigned or stale requests rejected before parsing (§4.1) |
| Per-engineer tokens | Encrypted at rest, keyed by engineer, decrypted only in the MCP server process. Never placed in a prompt, a tool result, or a memory entry |
| Model-authored code | Reaches credentials only by handle (`--as-engineer luka`). Wrappers read from their own env; the model cannot read the env it passes through |
| `bash` | The one hole — a model-written `curl` with a pasted token, or a wrapper that echoes one. Mitigated by keeping tokens out of context entirely, so there is nothing to paste |
| Supabase | Read-only production credentials. The skill states this so the model never plans a write |
| Core process | Not publicly routable. Only `POST /slack/events` is exposed, via Cloudflare Tunnel |
| Dashboard | Cloudflare Access, domain-restricted, with a documented temporary override. No custom auth code |
| Customer data at rest | The memory store holds customer conversations and is on the core VM behind the same gate — it is not served from a public URL |
| Audit | `rollout/recorder.ts` records every tool call, argument, and result per run; `freecode trace <id>` reconstructs what the agent did and with what |

The rule that makes the rest tractable: **secrets live in process environments,
never in the agent's context window.** Every control above is downstream of it.

---

## 16. Deployment, and the three deviations

The brief's suggested stack is Cloudflare Workers + Durable Objects for the
runtime, Vercel for the dashboard, and a third-party graph memory engine. This
build deviates in three places. All three are within what the brief permits —
it says the sandbox provider is your call, that how integrations reach the model
is yours to decide, and that any graph-based memory engine is fine — but each is
stated here rather than assumed, because the interview will ask.

**Deviation 1 — runtime: a long-running daemon, not Workers + DO.**
FreeCode's core is a persistent Node/Bun process (`server.ts` over stdio,
`web-server.ts` over HTTP/WS) holding session state, the provider connection, and
the context cache between turns. It is not a Worker. *Conforming would cost:* a
rewrite of the agent loop against an unfamiliar runtime inside a seven-day
window, which is how trials get lost. *What the deviation costs:* no Durable
Object means no per-run isolation for free, so concurrent runs share one process
— which is precisely what FreeCode's session manager already handles and what the
rollout recorder already keeps separable.

**Deviation 2 — memory: FreeCode's own graph memory, not Zep or Honcho.**
The brief asks for a graph-based memory engine. FreeCode has one:
`memory/mem-store.ts` for durable entries, `memory/graph/` for embeddings,
tag/wikilink edges, clustering, and `cascadeRetrieve` for graph-walk retrieval.
*Conforming would cost:* swapping a working, already-integrated store for a
vendor SDK, plus a data model translation, for no capability gain. *What the
deviation costs:* the org-scoping work in §13.1, which a hosted engine would give
for free.

**Deviation 3 — code mode: MCP plus a `bash` escape hatch, not Worker Loader.**
The mechanism from the Cloudflare posts is adopted (§6); the substrate is not,
because it presumes Deviation 1's runtime. *Conforming would cost:* Deviation 1.

Note that 2 and 3 both follow from 1. There is one architectural choice here, not
three.

**The resulting deployment:**

- **Core on an always-on VM or container**, running `web-server.ts` with the
  `/slack/events` route. Long-lived, which is what the loop wants anyway.
- **Dashboard on Vercel**, talking to core over HTTP/SSE. This part matches the
  sanctioned combo.
- **Cloudflare Access** in front of the dashboard; **Cloudflare Tunnel** in front
  of core so the webhook has a stable public URL without exposing the VM.
- **Cloudflare R2** for recordings (§11.3).
- **E2B** for sandboxes (§11.1).

---

## 17. Cost model

Ceiling is $500 all-in for the week, tokens included, with a ping before crossing
rather than after (`markdown.md:114`).

| Item | Estimate | Basis |
| --- | --- | --- |
| Triage | **~$0.50** | ~150 msgs/day × 7 days, minus the pre-filter, at Haiku-class rates on a short prompt |
| Main agent | **the bulk of the budget** | ~8–12 woken runs/day. A question run is small; a bug run with three subagents is the expensive one |
| Sandboxes (E2B) | **~$5–15** | ~20 repros × ~5 min, per-second billing, warm templates |
| Recording storage (R2) | **<$1** | A few hundred MB of webm |
| Core VM | **~$20–40** | One small always-on instance for the week |
| Vercel | **$0** | Hobby tier |
| Memory | **$0** | Own store; no vendor (§16) |

**Everything except the main agent rounds to noise.** The budget is a token
budget, and the honest version of this table is produced by measurement, not
estimation: `rollout/recorder.ts` already records usage per model call, so a
`freecode trace`-derived tally gives the README a real number rather than a
guess. Instrument on day 2 so the day-7 breakdown is data.

**Three things that would actually blow it, and their brakes:**

- **A stuck run looping on the same tool.** `effect/loop-health.ts` already
  detects repeated identical calls, stagnant turns, and oscillation. Make sure
  the fire-fighter path doesn't disable it.
- **A sandbox left running.** Hard 15-minute TTL on every sandbox, enforced by
  the wrapper, not by the model remembering to stop it.
- **Re-reading the monorepo every run.** `context/tree-cache.ts` already caches
  the file tree and invalidates after mutating tools. Free, as long as runs share
  a project path — which §13.1 pins anyway.

A daily spend check against the recorded usage, with a Slack ping at 60% of the
ceiling, turns "ping before crossing" into something that happens on its own.

---

## 18. Build order

Ordered by what blocks what.

1. **Protocol + memory scoping.** `session.start` metadata; the fixed org-memory
   project path. Cheap now, expensive later.
2. **Webhook: ack, dedup, echo suppression, ingest to memory.** Verify against
   `#test-firedrill` before anything else exists — until this is solid, nothing
   downstream is testable. **Request the `files:write` scope today** (§11.3).
3. **Triage + prompt builder + a run that starts and streams.** End-to-end
   skeleton: message in, session out, watched over SSE.
4. **`firefighter_ask` + the approval card.** The loop closes; a message can
   reach a customer.
5. **The skill** — escalation rules, voice counter-examples, the §12 rubric.
   Scenarios 1 and 4 are won here, and it is prompt iteration rather than code,
   so start early and keep tuning all week.
6. **Slack / GitHub / Linear MCP + per-engineer OAuth.** Scenario 2 becomes
   possible.
7. **E2B template, dev server bring-up, browser, recording pipeline.** Scenario 3.
   Longest pole — start the template bake in parallel with 5–6.
8. **Supabase / LangSmith / Better Stack**, which are small once the MCP pattern
   is established.
9. **Dashboard states, auth gate, README, cost tally, Loom.**

Scenarios 1 and 4 pass on prompt quality; 2 and 3 on integration plumbing. If the
week runs short, a system that nails 1 and 4 and half-passes 3 reads far better
than one that ships all four raggedly.

---

## 19. Deliverables

Due end of day 7 (`markdown.md:141`). Two of these are only cheap if started early.

**The repo, deployed.** Agent runtime live (§16), dashboard behind the domain
gate with the temporary override in place.

**README**, with sections matching the brief:
- Architecture, with the §3 diagram
- Security model — §15, written to be checkable against the code
- Cost breakdown for the week — §17, from recorded usage, not estimates
- AI-tool notes — which parts were pair-programmed, where the AI was wrong, where
  you overrode it. **Keep a running log from day 1** in `docs/ai-notes.md`; this
  cannot be reconstructed on day 7, and the brief singles out the surfaces where
  models confidently invent APIs as the interesting part
- What another week would buy

**A ≤5-minute Loom.** Rough allocation, because five minutes goes fast:
60s architecture · 90s a live run end to end · 60s the approval flow including an
edit · 60s memory answering "what happened with X?" plus the shift handoff ·
30s what's next.

**The live fire drill**, run cold in `#test-firedrill` (§20).

**The interview.** The questions this design invites first are §16 (why not
Workers) and §6 (why not code mode as the substrate). Both are answered above;
be able to give the short version and the long one.

---

## 20. The day-7 drill

Four scenarios, run cold:

1. **A how-to question.** Correct answer in the thread within minutes, in the
   on-duty engineer's voice. *Won by:* §10 and retrieval quality in §4.4.
2. **A small feature request.** PR opened as the fire-fighter with proof
   attached, merged after human review, customer replied to. *Won by:* §8 identity
   and §11.
3. **A planted bug.** Repro on a cloud machine, fix, browser-verified recording,
   PR, merge, reply — recording in both the PR and the thread. *Won by:* §11.1–11.3.
   Longest pole; most likely to fail on the recording attachment.
4. **A large feature request.** Useful follow-ups, a scoped issue with the
   assessment, an honest acknowledgment. **Clicks are counted.** *Won by:* §12.1 —
   scoping questions must go out ungated.

---

## 21. Requirements traceability

| # | Requirement (`markdown.md:89–99`) | Section |
| --- | --- | --- |
| 1 | Hear every channel, ingest to org memory, channels only, triage customer channels, only actionable wake | §4.1, §4.2, §13 |
| 2 | One generic agent, two surfaces, one session shape, live runs watchable and steerable | §5, §14 |
| 3 | Replies via the engineer's own Slack, per-engineer OAuth, one app, user acts / bot nudges | §8 |
| 4 | Model asks explicitly; dashboard approve/edit/reject; state lives there alone; rejections feed memory | §9, §13.1 |
| 5 | Customer-facing messages read as the engineer wrote them | §10 |
| 6 | Boots a cloud machine, dev server up, headless repro, fix, verify, recording on PR *and* reply | §11.1, §11.2, §11.3 |
| 7 | PRs as the fire-fighter against `staging`, repo conventions, Linear linked, closes on merge, carries proof | §5 (conventions), §11 |
| 8 | Large features: follow-ups, scoped issue with value/blocking/customer-weight, honest acknowledgment | §12 |
| 9 | Org-scoped durable memory, both sides, thread citations, shift handoff | §13 |
| 10 | Dashboard behind a Cloudflare Access domain gate with a documented override | §14 |
| 11 | Two hardcoded roles — four rotating fire-fighters, three viewers | §8, §14 |

| Supporting requirement | Section |
| --- | --- |
| Code mode — the central decision | §6 |
| Model-authored code never touches raw credentials | §6, §15 |
| Suggested stack, and where this departs from it | §16 |
| Budget: $500 all-in including tokens | §17 |
| UX bar: 30-second comprehension, loading/error/empty states | §14 |
| Deliverables: README, Loom, AI-tool notes, drill, interview | §19 |
| Out of scope | §22 |

---

## 22. Out of scope

- DM and group-DM ingestion. Channels only; the app has no DM scopes and
  shouldn't ask for them.
- Multi-tenant / multi-workspace anything, billing, teams.
- Ungated autonomy in real customer channels — post-benchmark, not this week.
- Visual design. States must exist; styling doesn't have to impress.
- IAM past the domain gate. Hardcoded emails and Slack user IDs are fine.
- Extending `apps/core/src/browser/` — it is legacy and off the primary path.

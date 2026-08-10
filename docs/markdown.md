# Trial Project: The Fire-Fighter Agent

**Duration:** 7 days
**Deliverables:** codebase (new repo), README, deployed dashboard URL, a live fire drill, a ≤5-minute Loom, an interview where you defend your decisions

## The problem

Zellify's customers are mobile app marketers, and they live in external Slack channels. Every three days one engineer becomes the fire-fighter: for that shift they own everything customer-related while everyone else stays heads-down.

Customer messages come in three shapes, each with its own contract:

1. **Questions** ("how do I add a second language variant without duplicating the funnel?"): resolve immediately and correctly.
2. **Feature requests**: small ones (a copy-this-ID button) ship right away. Large ones get engagement: ask follow-ups, weigh value to the platform against how blocking it is and how much this customer matters, then either ship it or file it and tell them honestly where it stands.
3. **Bug reports**: reproduce, fix, raise a PR, get a human to approve the merge, reply in the thread.

Most fire-fighter shifts today run on copy-paste. The customer's message goes into a coding agent verbatim; the agent's answer comes back into Slack verbatim. The human supplies routing, judgment, and approval. The agent already supplies the thinking. This trial builds the version where the human supplies judgment and approval only.

You build it on real infrastructure. Your agent listens to our actual customer channels, works against our actual monorepo, and its PRs (reviewed and merged by humans) ship to real customers during your trial week.

## What you build

One generic agent, two ways to invoke it, a two-page dashboard, and an approval gate.

**Ingest and triage**

- A Slack Events webhook hears every message in every channel the team is in. Channels only, never DMs.
- Everything it hears goes into memory. So does every agent interaction: what a run was asked to do, what it did, what it drafted, what got approved, edited, rejected.
- Only customer channels (roughly 150 messages a day) reach triage. A cheap model (about $0.0003 per message) decides what wakes the main agent; most is banter and doesn't.
- Triage writes the opening prompt: the message, the thread, and what memory knows about this customer.
- Shifts rotate every three days; memory doesn't. Each fire-fighter inherits what every previous shift learned.

**The agent**

- One generic agent, no per-ticket-type pipelines. A bug-handling state machine or `if (type === "feature")` branching is a fail. There's no "handle bug" capability, only the pieces a bug happens to need.
- Claude Code on the web, plus our integrations. Everything a coding agent does on a laptop (read the tree, grep it, edit files, run the dev server and the tests, drive a browser, commit, push, open a PR) on a machine it boots for itself.
- On top of that: Slack (read threads, draft replies), GitHub (PRs as the fire-fighter), Linear (file and update issues), Supabase prod read-only (the customer's real data while debugging), LangSmith (pull a trace when a customer says our AI did something weird), Better Stack (logs and uptime when something looks broken in prod), org-scoped memory.
- How any of that reaches the model, whether as flat tool schemas, generated code against typed APIs, or MCP servers, is yours to decide. It's the central decision of this trial. Read the next section first.
- Model-authored code never touches raw credentials, and the README's security section has to match the code.

**Runs, and the two ways in**

- A run is a chat session: same UI and session shape as the human-facing chat, except triage wrote the first message.
- Anyone on the team can open a live run, watch the tool calls stream, and type into it to steer the agent mid-flight.
- The other way in is the chat page, where a human types first. "Did PulseFit complain about checkout before, and what did we do?" gets an answer with citations to the actual threads. "Ship the copy-ID button Priya asked for" starts a run by hand.
- Marcus, Nils, and Eric use the chat page too: viewers with dashboard and chat only, no rotation and no OAuth.

**Identity**

- The customer never sees a bot. Replies arrive from the on-duty engineer's own Slack account; PRs open under their own GitHub identity.
- Each rotating engineer (Ronit, Luka, Zurab, Misho) connects both accounts once, and the agent acts as whoever is on duty.
- When something needs a human, Slack notifies the on-duty engineer with a preview and a dashboard link. Nobody should have to keep a tab open to find out the agent is waiting.
- Two hints, since both cost a day to discover the hard way: one Slack app carries both a user token and a bot token, so you never need a second app; and a self-DM sent with your own user token doesn't push-notify, which is what the bot token is for. A dashboard link is a plain URL button, so no interactivity endpoint and no handler code.

**Approval**

- The agent decides when to ask. At the harness layer there's no such thing as an outbound message: a Slack reply, a Linear issue, and a PR are the same shape of call, so gating that layer gates everything and leaves you with an agent that can't act.
- Escalate: committing us to something, closing a thread, telling a customer no, anything that would embarrass the engineer whose name is on it.
- Send: a clarifying question, or a "we're on it" while a fix is in review. Four messages of scoping a feature request should cost the on-duty engineer one click, not four.
- That judgment lives in the model and in your prompting. It will sometimes be wrong; best effort is what we're grading.
- Approval happens on the dashboard, nowhere else: approve / edit / reject. Slack nudges; the dashboard decides. One writer of approval state means no Slack interactivity infra and no two-surface sync.
- Rejections go into memory, so the agent learns both what this team won't send and what it should have escalated.

**How the messages read**

- Every reply that reaches a customer should be indistinguishable from one the on-duty engineer typed. Direct, technical, no preamble, no "Great question!", no bulleted summary of what was just said, no closing paragraph restating the answer.
- It goes out under a real person's name. If your prompt work stops at correctness, this is where the drill will catch you.

**Shipping**

- Bug or small feature: file the Linear issue, boot a machine, fix, verify in a real browser, record the proof, open a PR as the fire-fighter following the repo's conventions so the issue closes on merge.
- Review and merge happen on GitHub. The dashboard approves Slack messages and nothing else.

**The dashboard**

- Two pages. Dashboard (rotation, per-engineer connect status, heard/ingested/triaged/escalated counters, the run list, the approval card) and Chat. Don't build more.
- Wireframe prototype: https://claude.ai/code/artifact/431fe837-ba16-4716-8eaf-ad4feeb69e11. Illustrative only, so shadcn defaults are fine and nobody is grading CSS.

## Code mode

Read these before you architect anything:

- Code Mode: https://blog.cloudflare.com/code-mode/
- Project Think: https://blog.cloudflare.com/project-think/
- MCP tools in the Agents SDK: https://developers.cloudflare.com/agents/tools/mcp/
- Agents SDK docs: https://developers.cloudflare.com/agents/

## Core requirements

1. Every message in every channel the team is in is heard by the webhook and ingested into org-scoped memory. Channels only, never DMs. Customer-channel messages are additionally triaged by a cheap model. Only actionable messages wake the main agent.
2. One generic agent, two invocation surfaces (triage-curated prompt, chat page), one session shape. Live runs are watchable and steerable from the dashboard.
3. Customer replies go out through the on-duty engineer's own Slack account via per-engineer OAuth. One Slack app: user tokens act, the bot token nudges with a dashboard link.
4. The agent decides when to ask for human approval and asks for it explicitly, rather than the harness gating every action. What it escalates gates on a dashboard approve / edit / reject. Approval state lives there alone. Rejections feed memory.
5. Customer-facing messages read as though the on-duty engineer wrote them. No AI tells.
6. The agent boots a real cloud machine, gets the monorepo dev server running on it, reproduces the bug in a headless browser, fixes it, verifies, and attaches a screen recording to both the PR and the customer reply. Provider is your call; defend it.
7. PRs open as the fire-fighter against `staging`, follow the repo's PR conventions (Linear issue linked, closes on merge), and carry the proof.
8. Large feature requests produce follow-up questions to the customer, a Linear issue with a value / blocking / customer-weight assessment, and an honest acknowledgment in the thread.
9. Memory is org-scoped and durable, and holds both sides: customer messages and the agent's own runs, drafts, and approval outcomes. The chat page answers "what happened with X?" with thread citations, and a shift handoff summarizes what the last three days taught the agent.
10. The dashboard is behind login. This is an internal app holding customer conversations and prod data, so it doesn't sit on an open URL. Put a Cloudflare offering in front of it (Access with an email or Google policy is the obvious one) and restrict it to `@zellify.app`. You won't have a Zellify address, so add your personal email as a temporary override in the policy and note it in the README so we can pull it afterwards. Nothing custom.
11. Two roles, hardcoded. Fire-fighters (`ronit@`, `luka@`, `mikheil@` — Misho — and `zurab@`) rotate on 3-day shifts, connect Slack and GitHub, and act on threads. Viewers (`marcus@`, `nils@`, `eric@`) get the dashboard and chat, no rotation and no OAuth. A hardcoded map of seven emails to roles is fine; nobody is judging IAM here.

## Suggested stack

- Cloudflare Workers + Durable Objects (the Agents SDK is a good base) on your own account for the agent runtime. Vercel for the dashboard if you want Next.js there. Cloudflare + Vercel is the sanctioned combo.
- Any LLMs, any prompts. A cheap model for triage and a strong one for the agent is the obvious split. Claude Fable 5 is fair game for the main agent: this loop talks to real customers under our names, so we'd rather you spend tokens on the strongest thing available than optimize the bill.
- Memory: any graph-based memory engine. Zep and Honcho are both fine. Not Supermemory — we've used it and it didn't hold up.
- Cloud machines: your pick. Candidates: Cloudflare Sandboxes / [@cloudflare/computer](https://blog.cloudflare.com/cloudflare-computer/), Blaxel, E2B, Fly Machines. We judge whether the loop works and whether your reasoning holds, not the logo.
- Your own accounts everywhere; we reimburse.

## What you get on day 0

- **GitHub org invite**: monorepo access (read `AGENTS.md` at the root first; local dev setup is documented) plus a fresh repo for your build.
- **Slack onboarding**: our workspace, the external customer channels, and `#eng-firefighter`. The Slack app already exists — we create it, you're added as a collaborator, and you get the client ID, client secret, and signing secret on day 0. Scopes and event subscriptions are locked to channel history and `chat:write`; DM scopes are deliberately not granted. If you need a scope that isn't there, ask in `#eng-firefighter` and say what for. You build the OAuth flow, the token storage, and the webhook; you don't touch the manifest. Your webhook listens to real traffic from the day it's live. Customer channels stay gated; `#test-firedrill` is yours to run ungated.
- **Linear API key**, **Supabase prod read-only credentials**, **LangSmith access**, **Better Stack access**.
- **Budget**: your own Anthropic / Cloudflare / Vercel / memory / VM accounts, receipts reimbursed. Ceiling is $500 all-in for the week, tokens included. Ping Ronit before crossing it, not after.

## The benchmark: day-7 fire drill

On the last day we show up cold in `#test-firedrill` playing customers and run four scenarios live:

1. **A how-to question.** Pass: a correct answer in the thread within minutes, reading as though a support engineer typed it.
2. **A small feature request** (a copy-this-ID-button-sized ask). Pass: PR opened as the fire-fighter with proof attached, merged after human review, customer replied to.
3. **A planted bug** (we break something reproducible ahead of time). Pass: repro on a cloud machine, fix, browser-verified recording, PR, merge, reply, with the recording in both the PR and the thread.
4. **A large feature request.** Pass: the agent asks useful follow-ups, files a scoped Linear issue with a value/blocking assessment, and acknowledges without overpromising. We'll also count the clicks: a multi-turn scoping conversation that gates every reply fails this one.

## What we're looking for

The gap between a vibe-coded prototype and something that looks finished.

- **Decisions you can defend, and the ability to walk us through the whole thing.** High level where it's a judgment call, low level where it matters.
- **UX knowhow and product sense.** How easy is this to actually use on a shift? The bar is an app that works and then disappears: minimal UI, nothing to configure, nothing to learn, the approval waiting where the engineer already was. Loading, error, and empty states exist, and someone opening the dashboard cold understands it inside 30 seconds. Nobody is grading CSS. The best version of this is one the fire-fighter forgets is running.
- **Honest AI-tool notes.** Use coding agents as hard as you like; we do. The README says which parts were pair-programmed, where the AI was wrong, and where you overrode it. We're most interested in the Agents SDK and Worker Loader surfaces, where the training data is thin enough that the model will confidently invent APIs.

## Out of scope

- DM and group-DM ingestion. The app has no DM history scopes and shouldn't ask for them; channels only.
- Multi-tenant or multi-workspace anything, billing, teams.
- Ungated autonomy in real customer channels (post-benchmark, not this week).
- Visual design. shadcn defaults are fine; states have to exist, styling doesn't have to impress.
- Roles, permissions, invites, anything IAM-shaped past the domain gate. Hardcoded emails and Slack user IDs are fine.

## Deliverables at end of day 7

- The repo, deployed: the agent runtime live on your Cloudflare account, and a dashboard URL behind the `@zellify.app` gate that the seven of us can log into.
- README: architecture with a diagram, the security model, a cost breakdown for the week, AI-tool notes, and what you'd do with another week.
- The live fire drill, run cold.
- A ≤5-minute Loom walking the whole loop end to end.
- The interview.

The week is hackathon pace on a stack you probably haven't touched. Ask questions early in `#eng-firefighter`. We'd rather re-scope on day 1 than find out at the drill.
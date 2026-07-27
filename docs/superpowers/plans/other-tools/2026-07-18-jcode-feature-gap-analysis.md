# jcode → FreeCode: Feature Gap Analysis

> **Date:** 2026-07-18
> **Source:** `~/Projects/githubProjects/jcode` — jcode by 1jehuang (Rust agent harness, ~75 crates)
> **Status:** Analysis / roadmap candidates — nothing here is committed work.
> **Companion doc:** `2026-07-18-grok-build-feature-gap-analysis.md` (some items overlap; cross-references noted).

jcode ("possibly the greatest coding agent ever built") is a Rust TUI agent
built around three obsessions: **multi-session/multi-agent workflows,
performance, and passive semantic memory**. Compared to Grok Build, it is far
more experimental — swarm coordination, ambient mode, self-dev — and several
ideas are genuinely novel. FreeCode matches it on the basics (tools, hooks,
skills, MCP, sessions, compaction), so the gaps are in memory intelligence,
multi-agent coordination, provider breadth, and UX polish.

---

## Quick Reference

| # | Feature | jcode source | Effort | Value |
|---|---------|--------------|--------|-------|
| 1 | Semantic passive memory (embeddings) | `docs/MEMORY_ARCHITECTURE.md`, `jcode-embedding` | High | High |
| 2 | Single-server multi-client architecture | `docs/SERVER_ARCHITECTURE.md` | Medium | High |
| 3 | Soft interrupt / interleaved input | `docs/SOFT_INTERRUPT.md` | Medium | High |
| 4 | Swarm: multi-agent coordination + task DAG | `docs/SWARM_ARCHITECTURE.md`, `docs/SWARM_TASK_GRAPH.md`, `jcode-swarm-core` | High | High |
| 5 | OAuth subscription providers + multi-account | README "OAuth and Providers" | Medium–High | High |
| 6 | Cross-harness session import | `jcode-import-core`, `/resume` | Medium | Medium–High |
| 7 | Agent grep (structure-aware, adaptive truncation) | README "Misc." | Low–Medium | High |
| 8 | Semantic skill injection | README "Misc." | Medium | Medium |
| 9 | Prompt-cache awareness UX | README "Misc." | Low | Medium |
| 10 | Ambient mode (proactive background agent) | `docs/AMBIENT_MODE.md`, `jcode-overnight-core` | High | Medium |
| 11 | Safety system for unmonitored agents | `docs/SAFETY_SYSTEM.md` | Medium | Medium |
| 12 | Side panel + fast mermaid + info widgets | README "UI", `jcode-tui-mermaid` | Medium | Medium |
| 13 | Browser tool (Firefox Agent Bridge) | README "Browser Automation" | Medium | Medium |
| 14 | Performance discipline (RAM/startup budgets) | README benchmarks | Ongoing | Medium |
| 15 | Self-dev mode | `jcode-selfdev-types`, `docs/UNIFIED_SELFDEV_SERVER_PLAN.md` | Very High | Low (novelty) |
| 16 | Smaller niceties (provider doctor, dictation, named sessions, PDF) | various | Low each | Low–Medium |

**Recommended first three:** agent grep (#7), soft interrupt (#3),
prompt-cache awareness (#9) — small, self-contained, immediately felt.
Strategic bets: semantic memory (#1) and the server/multi-client split (#2),
which is also the foundation for swarm (#4).

---

## Tier 1 — Novel, high value

### 1. Semantic passive memory with local embeddings

jcode's flagship feature. How it works:

- Every turn/response is embedded as a semantic vector (local ONNX MiniLM via
  `tract`, no API call — behind an `embeddings` feature flag).
- Each turn queries a **memory graph** by cosine similarity; hits are injected
  into the conversation automatically — the agent recalls without spending
  tool calls ("not a token burner").
- Optionally, a **memory sideagent** verifies relevance and does extra
  retrieval before injection.
- Extraction is also automatic: on semantic drift, K turns since last
  extraction, or session end, a sideagent extracts memories into the graph.
- Memories are periodically **consolidated** (reorganized, staleness/conflict
  checked) by ambient mode.
- Explicit memory tools + traditional RAG over past sessions still exist.

**Gap in FreeCode:** `memory/` is explicit store/query (`mem-store`,
`mem-query`, `mem-prompt`) — the model must actively use it.

**Fit:** a local embedding model (e.g. MiniLM via `transformers.js` /
`onnxruntime-node`) + cosine search over stored memories, with injection in
`session/prompt.ts`. Start with passive *recall* only (inject top-k hits per
turn); add automatic *extraction* later. This is the single most
differentiating feature jcode has.

### 2. Single-server, multi-client architecture

One `jcode serve` process owns all sessions, providers, and a **shared MCP
pool**; TUI clients attach over a Unix socket (`jcode connect`) and reconnect
transparently after disconnects or server reloads. Session registry at
`~/.jcode/servers.json`; sessions get memorable names (fox, bear, owl).
Marginal cost per extra session: ~10 MB RAM.

**Gap in FreeCode:** each frontend spawns its own core over stdio. Two TUIs =
two cores, two MCP pools, no shared session view.

**Fit:** core already speaks JSON-RPC and has a `web-server.ts` bridge —
generalize to a named-socket daemon that multiple frontends attach to
(`freecode serve` / `freecode connect`). This is also the prerequisite for
swarm (#4) and a cross-session dashboard (see grok-build doc #8).

### 3. Soft interrupt / interleaved input

Typing during generation does **not** cancel the turn. jcode injects the
user's message at the next safe point where the provider connection is idle —
without breaking the KV/prompt cache — so no partial work is lost. Plain Enter
interleaves; Shift+Enter queues for after the turn completes.

**Gap in FreeCode:** the standard cancel-and-restart flow loses in-flight
work.

**Fit:** in `agent/loop.ts`, check a pending-input queue between tool batches
/ before the next model call and append it as a user message instead of
cancelling. The TUI needs the two-mode submit. Pairs with grok-build's prompt
queue (#3 there) — same UX family, this is the stronger version.

### 4. Swarm: multi-agent coordination + task DAG

Two layers:

- **Coordination (live):** spawn multiple agents in the same repo; the server
  mediates. When agent A edits a file agent B has read, B gets notified
  ("code shifted under your feet") and can check the diff. Agents can DM one
  another, broadcast server-wide or repo-wide. Agents can spawn their own
  swarms via a tool — the spawner becomes coordinator, spawned agents become
  workers; groups, channels, and completion statuses are managed
  automatically. Works headless or headed.
- **Task DAG (being implemented):** reframes swarm from agent-first to a
  **task DAG as the primary object** — declare tasks with dependency edges
  and per-node specs; the scheduler walks the graph, assigns runnable nodes
  to fungible workers (reuse-or-spawn), and completion unblocks dependents.
  Includes verification gates and coverage guarantees.

**Fit:** FreeCode has subagents but no peer coordination. Requires #2
(shared server) first, plus read/write tracking per session (compare
grok-build's hunk tracker) and a messaging tool. The task-DAG framing is a
better orchestration model than free-form agent chat — worth adopting
directly if multi-agent is ever on the roadmap.

### 5. OAuth subscription providers + multi-account

jcode lets users burn the subscriptions they already pay for:

- Built-in OAuth login flows: Claude, OpenAI/ChatGPT/Codex, Gemini, GitHub
  Copilot, Azure OpenAI, Alibaba, Fireworks, MiniMax, LM Studio, Ollama, and
  a generic OpenAI-compatible flow.
- **One shared OpenAI-compatible provider** with ~15 named profiles
  (openrouter, deepseek, kimi, huggingface, …) — new services need a profile
  entry, not a new adapter. `extra_body` config injects non-standard request
  fields (e.g. NVIDIA NIM `chat_template_kwargs`).
- Scriptable setup: `jcode provider add <name> --base-url … --api-key-stdin`;
  headless OAuth (`--no-browser`, two-step `--print-auth-url` /
  `--callback-url`).
- **Multi-account switching**: `/account` swaps to a second ChatGPT/Claude
  subscription when the first runs out of tokens.
- `jcode provider-doctor` diagnostics and `auth-test` smoke tests.
- On first run, imports credentials/MCP config from Claude Code
  (`~/.claude.json`), Codex (`~/.codex/config.toml`), OpenCode.

**Fit:** FreeCode has four API-key providers via the AI SDK. The cheapest
wins: a generic OpenAI-compatible provider with named profiles (the AI SDK's
`createOpenAI({ baseURL })` makes this nearly free) and `extra_body`
passthrough. OAuth subscription flows are a bigger lift but a huge
cost-of-use win for users.

---

## Tier 2 — Strong quality-of-life wins

### 6. Cross-harness session import

`/resume` can resume sessions **from other harnesses**: Claude Code, Codex,
OpenCode, and pi. "Claude Code broke on you? Resume the session from jcode
and continue where you left off."

**Fit:** FreeCode has `session.import` and a `session/normalize/` layer
already — adding readers for `~/.claude/projects/*.jsonl` and Codex/OpenCode
session formats is a natural extension and a great adoption hook.

### 7. Agent grep

A grep tool tuned for agents, two ideas:

- Results include **file structure info** — the list of functions, their
  offsets — so the model infers what a file does without reading it.
- **Adaptive truncation at the harness level** — output is trimmed based on
  what the agent has *already seen*, saving significant context.

**Fit:** extend `tools/grep.ts` with a lightweight symbol pass (tree-sitter
or regex-based) around matches, and track served content per session for
dedup/truncation. Small effort, direct token savings every session.

### 8. Semantic skill injection

Skills are **not** loaded at startup. The conversation embedding is matched
against skill descriptions; on a hit, the skill is auto-injected (same
mechanism as memory recall). Manual activation via skill tool or slash
command still works.

**Fit:** FreeCode's `skills/injection.ts` exists; this adds an
embedding-based trigger. Depends on the embedding infra from #1 — cheap once
that lands.

### 9. Prompt-cache awareness UX

Anthropic's prompt cache goes cold after ~5 minutes. jcode warns in the UI
when the cache has gone cold before you send, and notifies on unexpected
cache misses (which cost real money on long contexts).

**Fit:** providers already return cache usage via the AI SDK; core knows the
last-request timestamp. A `StreamEvent`/notification + TUI hint. Tiny
feature, saves users actual money.

### 10. Ambient mode (proactive background agent)

An always-on background loop (single instance, self-scheduling, resource
limited) that in one pass: **gardens** the memory graph (consolidate, prune),
**scouts** recent sessions/git history to learn what the user cares about,
and **works** — proactively completing tasks "the user would appreciate being
surprised by." Subscription-first (never burns API keys unless configured);
interactive sessions always take priority. An `overnight-core` crate covers
long unattended runs.

**Fit:** ambitious; gate it behind the safety system (#11). The *memory
gardening* slice alone (periodic consolidation of `memory/`) is a reasonable
standalone adoption.

### 11. Safety system for unmonitored agents

A human-in-the-loop layer for anything running unsupervised (ambient,
overnight, swarm workers): two tiers only — **auto-allowed** and
**requires-permission** (no permanent deny; explicit user approval unlocks
anything). Core principle: *anything that communicates with another human or
leaves a trace outside the local sandbox requires permission.* Includes a
`request_permission` tool, pending-request notifications, wait-or-move-on
semantics, and post-session reports of what was done.

**Fit:** layers on FreeCode's `permission/profiles.ts` + `question` tool +
bus. Prerequisite for any background/ambient work.

---

## Tier 3 — UX, performance, and misc

### 12. Side panel, fast mermaid, info widgets

- **Side panel:** auxiliary pane the agent can target — load a file with live
  updates, write to it directly, or use it as a diff viewer.
- **Mermaid everywhere:** diagrams render inline in chat and panel via a
  custom Rust renderer (~1800× faster than mermaid-cli, no browser dep —
  [mermaid-rs-renderer](https://github.com/1jehuang/mermaid-rs-renderer)).
- **Info widgets:** status info only ever occupies *negative space* on
  screen and gets out of the way when content needs the room.
- Also: >1000 fps rendering (no flicker), custom scrollback, left/center
  alignment toggle.

**Fit:** side panel is a pi-tui layout project; a "render to side panel" tool
in core is small. Mermaid in-terminal is possible via their renderer (it's a
standalone library).

### 13. Browser tool

First-class `browser` tool backed by **Firefox Agent Bridge**: status/setup/
open/snapshot/get_content/interactables/click/type/fill_form/select/wait/
screenshot/eval/scroll/upload/press. Setup is agent-driven (`jcode browser
setup`). The provider architecture allows Chrome/CDP backends later. UI
summarizes actions without echoing sensitive typed text.

**Fit:** FreeCode's Playwright layer is legacy/unwired; jcode shows the shape
of a *modern* version — a single `browser` tool with action verbs, wired into
the normal tool pipeline. Revive `browser/` behind `tools/factory.ts` rather
than as a provider.

### 14. Performance discipline

jcode publishes benchmark tables against every major CLI agent:

- ~27.8 MB PSS for one active session (embeddings off); **~10 MB marginal
  RAM per additional session**; 14 ms to first frame; 49 ms to first input.
- Techniques: jemalloc, per-crate opt-level pinning for hot paths, lazy
  loading of everything, benchmark bins (`tui_bench`,
  `session_memory_bench`) in-repo.

**Fit for a Node/TS stack:** the absolute numbers aren't reachable, but the
practice is — track startup time and per-session RSS in CI, lazy-load
providers/MCP/skills, and treat multi-session marginal cost as a budget. The
single-server split (#2) is what makes per-session marginal cost matter.

### 15. Self-dev mode

The agent modifies **its own source code**, builds, tests, then hot-reloads
its own binary and continues work across active sessions, fully
automatically (dedicated `selfdev` cargo profile, unified selfdev server
plan). Novel, but tightly coupled to jcode being its own codebase.

**Fit:** low priority; the transferable slice is graceful in-place restart
with session continuity (core restarts, frontends reconnect, sessions resume
from rollout) — worth having regardless.

### 16. Smaller niceties

- **`jcode run "prompt"`** — headless one-shot (same as grok-build #1).
- **`jcode dictate`** — voice input via a user-configured STT command
  (no bundled speech stack).
- **Memorable session names** (fox, bear, owl) — nicer than UUIDs for
  `--resume fox`.
- **Provider doctor** — one command that diagnoses provider/auth/config
  problems.
- **PDF ingestion** (`jcode-pdf`) and terminal image rendering (kitty
  protocol).
- **Email notifications** (`jcode-notify-email`) for long-running/ambient
  work.
- **Copy-paste bootstrap prompt** in the README that any agent can follow to
  install and configure jcode — clever docs-as-onboarding.
- **iOS app (planned)** — phone access to your machine's sessions via
  Tailscale.

---

## Overlap with the grok-build analysis

| Theme | grok-build | jcode | Take |
|-------|-----------|-------|------|
| Headless mode | `-p` + output formats | `jcode run` | Same feature; do once |
| Input while running | Prompt queue | Soft interrupt (stronger) | Implement jcode's version |
| Multi-session UX | Dashboard TUI | Server + named sessions + attach | Complementary; server first |
| External-edit awareness | fsnotify + hunk tracker | Swarm file-conflict notify | Same primitive underneath |
| Parallel agents | Subagents + worktrees | Swarm + task DAG | DAG is the better end-state |
| Code-structure context | Codebase graph (tree-sitter) | Agent grep (lighter) | Agent grep is the cheaper first step |

## Already at parity (no action)

Tool loop, hooks (`docs/HOOKS.md`), skills, MCP client (incl. project/global
config files), sessions with resume/fork, compaction, permission prompts,
markdown TUI, slash commands, subagents. FreeCode's rollout event sourcing
and Effect-based DI have no jcode equivalent; jcode's storage is
session-file based.

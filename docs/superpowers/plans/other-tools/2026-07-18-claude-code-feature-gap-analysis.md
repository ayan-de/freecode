# Claude Code → FreeCode: Feature Gap Analysis

> **Date:** 2026-07-18
> **Source:** Public documentation only — docs.claude.com/claude-code and the
> public changelog (github.com/anthropics/claude-code). Claude Code is
> proprietary; unlike the Grok Build / jcode / OpenCode analyses, this one is
> **not** based on source inspection, and no implementation details from any
> source copy were used. Feature descriptions reflect documented product
> behavior.
> **Status:** Analysis / roadmap candidates — nothing here is committed work.
> **Companion docs:** grok-build, jcode, and opencode gap analyses (same date).

Claude Code is the market-defining CLI agent, so most of its core loop
features already appear in the other three analyses (and in FreeCode). What
it uniquely demonstrates is **product depth**: layered configuration and
memory, introspection commands, a hooks contract for end users, output
styles, checkpointing, and an enterprise story (managed settings, OTEL,
Bedrock/Vertex). This doc focuses on items not already captured in the other
three docs, then cross-references the overlaps.

---

## Quick Reference

| # | Feature | Effort | Value |
|---|---------|--------|-------|
| 1 | Layered instruction files + imports + quick-add memory | Low–Medium | High |
| 2 | User-facing hooks contract (shell commands, JSON I/O) | Medium | High |
| 3 | Introspection commands: /context, /cost, /doctor, /usage | Low | High |
| 4 | Checkpointing + /rewind (code, conversation, or both) | Medium | High |
| 5 | Permission rules syntax in settings (allow/ask/deny) | Medium | High |
| 6 | Output styles | Low | Medium |
| 7 | Agent SDK as a product surface | Medium–High | High |
| 8 | Enterprise: managed settings, OTEL, Bedrock/Vertex | High | Medium (audience-dependent) |
| 9 | Status line + terminal polish (vim mode, keybindings) | Low–Medium | Medium |
| 10 | Microcompaction | Medium | Medium |
| 11 | Session UX: queued messages, thinking toggle, model/effort switching | Low–Medium | Medium |
| 12 | Web/desktop sessions + CLI handoff ("teleport") | High | Medium |
| 13 | Native installer + release channels | Medium | Medium |

---

## Tier 1 — Product-depth features FreeCode lacks

### 1. Layered instruction files, imports, and quick-add memory

CLAUDE.md exists at multiple levels, all merged: enterprise (managed),
user (`~/.claude/CLAUDE.md`), project (checked in), and local
(`CLAUDE.local.md`, gitignored). Files support `@path` imports so a root
file can pull in per-package guides. Typing a message starting with `#`
offers to save it to a chosen CLAUDE.md — frictionless capture of
corrections while working. Subdirectory CLAUDE.md files load on demand when
the agent works in that subtree.

**Gap in FreeCode:** context compilation reads project context, but there's
no documented hierarchy (user + project + local), no import mechanism, and
no one-keystroke "remember this" capture into instruction files.

**Fit:** extend `context/collector.ts` to merge a file hierarchy with
`@import` resolution; add a `#`-prefix affordance in the TUI that appends to
the chosen file. Cheap, and it compounds — instruction quality is the
biggest lever on agent quality.

### 2. User-facing hooks contract

FreeCode's `hooks/` are internal lifecycle hooks; Claude Code's hooks are a
**user-configurable contract**: shell commands declared in settings.json per
event (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart,
Notification, …) with matchers (e.g. only for `Bash`, or `Edit|Write`).
Hooks receive JSON on stdin (session, tool name, tool input) and can return
JSON that **controls the outcome**: block a tool call with a reason the
model sees, allow it bypassing permission prompts, add context to the
prompt, or force continuation on Stop. Exit code 2 = block with stderr fed
to the model.

**Fit:** FreeCode already fires the right events internally — exposing them
to user-defined commands with a documented stdin/stdout JSON contract makes
the whole hook system end-user extensible without writing plugins. This is
complementary to OpenCode's JS plugin API (#1 there): shell hooks for users,
JS plugins for developers. FreeCode could offer both from one event system.

### 3. Introspection commands

- **/context** — visual breakdown of what's consuming the context window
  (system prompt, tools, MCP, memory files, messages) so users can see why
  context is full.
- **/cost** — token/cost totals for the session.
- **/usage** — plan limits and current consumption.
- **/doctor** — diagnoses installation, config, and MCP problems.

**Fit:** FreeCode's core already tracks usage accounting and config; these
are mostly aggregation + TUI rendering. `/doctor` overlaps jcode's
provider-doctor recommendation. Low effort, high perceived quality —
introspection builds user trust faster than almost anything.

### 4. Checkpointing + /rewind

Automatic checkpoints of code state as the agent works; `/rewind` (or
double-Esc) restores **code, conversation, or both** to a prior point.
Recommended in the OpenCode doc (#3 snapshots) — Claude Code's version adds
the important UX detail that code and conversation can be rewound
*independently*, which is what makes it safe to explore aggressive changes.

**Fit:** pair rollout event sourcing (conversation state — already built)
with shadow-git snapshots (file state — recommended in the OpenCode doc) and
expose them behind one `/rewind` picker.

### 5. Permission rules syntax

Fine-grained allow/ask/deny **rules** in settings.json, e.g.
`Bash(npm run test:*)`, `Read(./secrets/**)` deny, `WebFetch(domain:...)`,
merged across enterprise → project → user scopes, plus permission modes
(default, acceptEdits, plan, bypassPermissions, and a sandboxed
auto-allow mode). Additional-directory access grants. Tool-specific
matchers make "allow npm but ask for git push" expressible.

**Gap in FreeCode:** `permission/profiles.ts` has five coarse profiles but
no documented per-rule pattern syntax users can edit.

**Fit:** add a rule layer (tool name + argument glob → allow/ask/deny)
evaluated before the profile default. This is also what makes headless/CI
use safe (pairs with grok-build's `--allow`/`--deny` flags).

### 6. Output styles

Named presets that swap the system prompt's delivery style while keeping
tool behavior: default, explanatory (teaches while coding), learning
(collaborative, asks the user to write pieces), plus user-defined styles
stored as markdown. Distinct from instruction files: styles change *how the
agent communicates*, not project facts.

**Fit:** a `styles/` directory merged into `session/prompt.ts` with a
`/style` command. Small feature, differentiating for education use cases.

### 7. Agent SDK as a product surface

The Claude Agent SDK packages the same loop that powers Claude Code
(tools, hooks, MCP, permissions, sessions) as TypeScript/Python libraries
for building custom agents. This is the "harness as a library" strategy —
the CLI is one consumer of it.

**Fit:** overlaps OpenCode's SDK recommendation (#2 there) but goes further:
beyond a client SDK for the server, FreeCode's `apps/core` internals (agent
loop + tool registry) could be exported as an embeddable library. Decide
deliberately whether FreeCode's product is "a CLI" or "a harness with a CLI
frontend" — the architecture already leans harness.

---

## Tier 2 — Polish and enterprise

### 8. Enterprise story

- **Managed settings**: org-deployed settings files (including via MDM on
  managed machines) that override user config — permissions, providers,
  disallowed tools.
- **OpenTelemetry export**: metrics/events (sessions, tokens, cost, tool
  decisions) to org collectors. Same theme as grok-build #14.
- **Bedrock / Vertex AI providers**: run through cloud accounts instead of
  direct API keys — often the deciding factor for enterprise adoption.
  (jcode ships Bedrock + Azure too; FreeCode's AI SDK dependency has
  first-party `@ai-sdk/amazon-bedrock` and `@ai-sdk/google-vertex`
  packages, making this unusually cheap.)

### 9. Status line + terminal polish

- User-defined **status line** rendered from a shell command (JSON context
  on stdin → text out), like a shell prompt for the agent: model, dir, git
  branch, cost.
- **Vim mode** for input editing; fully customizable **keybindings**.
- Terminal title updates, desktop notifications on attention-needed.

**Fit:** status line is a small, beloved feature; the command contract makes
it infinitely customizable without FreeCode shipping widgets.

### 10. Microcompaction

Rather than one big compaction event when context fills, older tool outputs
are compacted incrementally in the background, keeping sessions running
much longer before a visible /compact. FreeCode's `compaction/` has
selector/summarizer stages already — adding an incremental tool-output pass
(oldest, largest outputs first) is a natural extension and pairs with
OpenCode's tool-output store (#11 there).

### 11. Session UX details

- **Queued messages**: type while the agent works; queued input is folded
  into the turn (same family as jcode's soft interrupt — that doc has the
  stronger design).
- **Extended thinking toggle** (Tab) and per-request thinking budgets.
- **/model switching mid-session** including effort levels; fast-mode
  toggle.
- **Double-Esc history jump** to edit an earlier message and fork from it.
- **@-file mentions** with fuzzy path completion; paste images directly.
- **/resume picker** with session titles generated automatically (FreeCode
  has `agent/title-generator.ts` — surface it in a picker).

### 12. Web/desktop sessions + CLI handoff

Sessions can run on claude.ai/code (cloud sandboxes) or the desktop app,
and be **handed off to the CLI** ("teleport") and back. FreeCode's remote
thread store (`store/remote.ts`) plus session upload/download already point
this direction; the missing piece is a hosted runner. Long-term item.

### 13. Native installer + release channels

Self-contained native builds (no Node prerequisite), `stable`/`latest`
channels, in-place auto-update with rollback. Same theme as grok-build #15;
for a TypeScript project, Bun's `--compile` single-binary build is the
practical route.

---

## Overlaps with the other three analyses (no new writeup)

| Claude Code feature | Already covered in |
|---------------------|--------------------|
| Headless `-p` mode, `--output-format stream-json`, `--max-turns` | grok-build #1 |
| Background bash (Ctrl+B), task monitoring | grok-build #2 |
| Plan mode with enforced read-only + approval | grok-build #5 |
| OS-level sandboxed execution | grok-build #6 |
| Subagents defined as markdown files | OpenCode #10 |
| Plugins + marketplaces (bundling commands/agents/hooks/MCP) | grok-build #13, OpenCode #1 |
| GitHub Actions integration (@claude in issues/PRs) | OpenCode #9 |
| Skills system with progressive disclosure | Parity (FreeCode has skills) |
| MCP client (+ Claude Code can also *be* an MCP server) | Parity; MCP-server side is FreeCode's deferred item |
| Prompt caching awareness | jcode #9 |
| Session fork/resume/export | Parity |

## Where FreeCode is already ahead

Rollout event sourcing (full replayable event log), pluggable thread stores
(sqlite/json/remote), Effect-based DI, multi-provider breadth via one
adapter interface, and four first-party frontends driven by one protocol.
Claude Code's lesson is less about missing subsystems and more about
finishing depth: layered config, introspection, user-facing contracts
(hooks, status line, styles), and safety UX (checkpoints, permission rules)
— the things that make users trust an agent with real work.

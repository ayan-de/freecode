# OpenCode → FreeCode: Feature Gap Analysis

> **Date:** 2026-07-18
> **Source:** `~/Projects/githubProjects/opencode` — OpenCode by Anomaly (TypeScript/Bun monorepo)
> **Status:** Analysis / roadmap candidates — nothing here is committed work.
> **Companion docs:** `2026-07-18-grok-build-feature-gap-analysis.md`, `2026-07-18-jcode-feature-gap-analysis.md`

OpenCode is the most architecturally comparable of the three agents studied:
TypeScript, Effect-based, client/server split, multiple frontends (TUI via
opentui/SolidJS, desktop, web, IDE), tools registered through a factory. Many
patterns port almost directly. Its distinguishing strengths are its
**ecosystem surface** (JS plugin API, OpenAPI server + generated SDKs, GitHub
integration, share links) and its **language-tooling depth** (30+ LSP servers,
25+ formatters). Notably, OpenCode has **no persistent memory system** —
FreeCode is ahead there.

---

## Quick Reference

| # | Feature | OpenCode source | Effort | Value |
|---|---------|-----------------|--------|-------|
| 1 | JS/TS plugin system | `packages/plugin`, docs `plugins.mdx` | Medium | High |
| 2 | HTTP server + OpenAPI + generated SDK | `opencode serve`, `packages/sdk` | Medium | High |
| 3 | Snapshot / undo-redo | `src/snapshot/` | Medium | High |
| 4 | LSP diagnostics feedback (30+ servers, auto-install) | `src/lsp/`, docs `lsp.mdx` | Medium–High | High |
| 5 | Code Mode (script-orchestrated MCP tools) | `src/tool/code-mode.ts`, `packages/codemode` | Medium | Medium–High |
| 6 | Post-edit formatters (25+) | `src/format/`, docs `formatters.mdx` | Low–Medium | Medium |
| 7 | models.dev provider catalog | `packages/core/src/models-dev.ts` | Low–Medium | High |
| 8 | Session sharing (public links) | `src/share/`, docs `share.mdx` | Medium–High | Medium |
| 9 | GitHub / GitLab integration | docs `github.mdx`, `packages/function` | Medium–High | Medium–High |
| 10 | Custom agents + custom commands (markdown-defined) | docs `agents.mdx`, `commands.mdx` | Low–Medium | Medium |
| 11 | Tool-output store + adaptive truncation | `src/tool/truncate.ts`, `core/tool-output-store.ts` | Low–Medium | Medium |
| 12 | ACP support | `src/acp/` | Medium | Medium |
| 13 | Policies (resource-level control) | docs `policies.mdx` | Low | Low–Medium |
| 14 | Ecosystem/distribution polish | install scripts, i18n, Slack, http-recorder | Varies | Low–Medium |

**Recommended first three:** plugin system (#1) — same language, highest
ecosystem leverage; snapshot/undo (#3) — big trust win; models.dev catalog
(#7) — cheap way to go from 4 providers to 75+.

---

## Tier 1 — High value, directly portable (same language!)

### 1. JS/TS plugin system

OpenCode plugins are in-process JS/TS modules loaded from
`.opencode/plugins/` (project), `~/.config/opencode/plugins/` (global), or
**npm packages** listed in config (auto-installed with Bun, cached). A plugin
exports a function returning hooks:

- `tool.execute.before` / `tool.execute.after` — intercept/modify tool calls
- `tool.definition` / custom `tool` — register new tools from a plugin
- `chat.message`, `chat.params`, `chat.headers` — modify requests
- `permission.ask` — programmatic allow/deny/ask decisions
- `auth` — add OAuth/API-key flows for custom providers
- `config`, `event` (bus subscription), `command.execute.before`
- experimental: system-prompt transform, message transform, compaction hooks

Community ecosystem exists (wakatime, helicone, notification plugins, …).

**Gap in FreeCode:** `hooks/` is an internal lifecycle system; there's no
supported way for *users* to extend core without forking.

**Fit:** FreeCode is also TypeScript — this ports almost directly. Expose the
existing hook lifecycle + tool registry through a stable plugin API
(`.freecode/plugins/`, npm packages). Highest ecosystem leverage of anything
in these three analyses, and it subsumes grok-build's "plugins" item (which
bundles config; OpenCode's adds *code*).

### 2. HTTP server + OpenAPI + generated SDKs

`opencode serve` runs a headless HTTP server exposing an **OpenAPI** endpoint
(port 4096, optional basic auth via env, `--cors`, even mDNS discovery).
From the spec they generate a type-safe JS SDK (`@opencode-ai/sdk`) and a Go
SDK; `createOpencode()` boots server + client in one call. The TUI, desktop
app, web UI, and IDE extension are all just SDK clients.

**Gap in FreeCode:** JSON-RPC over stdio + an ad-hoc `web-server.ts` bridge;
no spec, no generated client — each frontend hand-rolls IPC.

**Fit:** describe the existing `METHODS` surface as an OpenAPI (or keep
JSON-RPC but publish a schema), generate a typed client package, and make all
four frontends consume it. Enables third-party integrations for free.

### 3. Snapshot / undo-redo

A git-based snapshot system (separate from the user's git state): patches
with hashes and file lists are recorded around agent changes, powering
`/undo` and `/redo` in the TUI, with automatic pruning (7 days, 2 MB patch
cap). The user's actual repo/index is untouched.

**Gap in FreeCode:** rollout event sourcing replays *conversation* state, but
there's no file-state checkpointing — no one-keystroke undo of an agent's
edits.

**Fit:** shadow-git (or patch-stack) snapshots taken per turn in core, with
`session.undo`/`session.redo` IPC methods. Pairs with jcode's hunk-tracker
idea; this is the proven, shipped version. Major trust feature.

### 4. LSP integration with diagnostics feedback

~30 built-in LSP servers (gopls, pyright, rust-analyzer, jdtls, clangd,
eslint, …) — many **auto-install** when the project type is detected.
After the agent edits a file, diagnostics are fed back into the loop so it
sees type errors immediately instead of discovering them at build time.

**Gap in FreeCode:** an `lsp` tool exists, but not the breadth, the
auto-install, or (crucially) the automatic post-edit diagnostics feedback.

**Fit:** wire diagnostics into the edit/write tool results (PostToolUse hook
is a natural seam), and adopt their server catalog as a config-driven
registry. The feedback loop is the valuable part; breadth can grow over time.

### 5. Code Mode

An `execute` tool: the model writes a **confined orchestration script** that
calls connected MCP tools programmatically (loops, conditionals,
intermediate variables) instead of emitting one tool call per round-trip.
Tool-call activity inside the script is tracked and surfaced in the UI;
permissions still apply per underlying tool.

**Fit:** big win when many MCP tools are connected — collapses N model
round-trips into one. Needs a sandboxed JS interpreter (they ship
`@opencode-ai/codemode`); registers as a normal tool via `tools/factory.ts`.

---

## Tier 2 — Quality and ecosystem wins

### 6. Post-edit formatters

25+ built-in formatters (prettier, biome, ruff, gofmt, rustfmt, mix, shfmt,
…) run automatically after write/edit, gated on the project actually using
that formatter (config file or dependency present). Opt-in via config.

**Fit:** a formatter registry keyed by extension + detection predicate,
invoked from the write/edit pipeline (or a built-in PostToolUse hook). Ends
the "agent wrote unformatted code" class of diff noise.

### 7. models.dev provider catalog

Provider/model metadata (context windows, costs, capabilities) is sourced
from [models.dev](https://models.dev) — an open catalog also maintained by
the OpenCode team — giving **75+ providers** through a mostly uniform
config, with a `/connect` flow for keys. On top sits **Zen**, their curated
"these model/provider combos actually work for coding, benchmarked" gateway
(optional, paid).

**Fit:** FreeCode hard-codes four adapters. Consuming models.dev JSON for
metadata + a generic OpenAI-compatible adapter covers most of the long tail
(same conclusion as jcode #5, and this is the cleanest data source for it).

### 8. Session sharing

`/share` creates a public link (`opncd.ai/s/<id>`); conversation history
syncs to their servers and renders in a web viewer. Modes: `manual` /
`auto` / `disabled`. Great for collaboration and bug reports.

**Fit:** FreeCode already has `session.export` and a remote store
(`store/remote.ts`) — a share service + static web viewer (`apps/web` could
render exported sessions read-only) is a natural extension. Requires hosting;
consider self-hosted-first.

### 9. GitHub / GitLab integration

Mention `/opencode` (or `/oc`) in an issue or PR comment and the agent runs
**inside the repo's own GitHub Actions runner**: triages issues, implements
fixes on a new branch, opens PRs. `opencode github install` walks through
app + workflow + secrets setup. GitLab equivalent exists.

**Fit:** depends on headless mode (grok-build #1) — once `freecode -p` exists,
a reusable workflow + comment-trigger action is mostly packaging. High
visibility feature for adoption.

### 10. Custom agents + custom commands

- **Agents** defined as markdown files with frontmatter (model, prompt,
  tool allowlist, permissions) at project or global scope — e.g. a
  read-only `plan` agent, a `review` agent. Primary/subagent distinction.
- **Custom commands**: markdown templates invocable as `/name` with
  arguments, shell interpolation, and frontmatter config.

**Fit:** FreeCode's `skills/` + `agent/subagent.ts` cover part of this;
what's missing is *user-defined* agent profiles and slash-command templates
as plain files. Cheap to add on top of the existing skills loader.

### 11. Tool-output store + adaptive truncation

Large tool outputs are stored out-of-band (`tool-output-store.ts`) and
truncated in-context with a reference; the agent can retrieve the full
output on demand. Prevents one noisy `bash` call from flooding the context.

**Fit:** slot into `tools/orchestrator.ts` — truncate past a threshold,
stash full output, expose a retrieval tool. Same family as jcode's agent
grep truncation; this is the general mechanism.

### 12. ACP support

`src/acp/` implements the Agent Client Protocol (Zed integration). Same
recommendation as grok-build #7 — two of the three agents studied now ship
ACP; it's becoming table stakes for editor embedding.

### 13. Policies (experimental)

Separate from permissions: rules controlling whether a *resource* may be
used at all — e.g. deny a specific LLM provider org-wide. Useful for
enterprise/compliance stories; cheap to evaluate at provider/tool
resolution time.

### 14. Distribution & ecosystem polish

Not features, but worth copying as practice:

- Install via curl script, npm, brew, scoop, choco, pacman, mise, nix.
- README translated into 22 languages.
- `ecosystem.mdx` — a curated page of community plugins/projects.
- **Slack integration** (`packages/slack`) — the agent as a Slack app.
- **http-recorder** package — record/replay provider HTTP traffic for
  deterministic tests of streaming/tool-call handling (directly reusable
  idea for testing `providers/streaming.ts`).
- Desktop (Tauri-like) + web + IDE clients all driven by the same SDK —
  validation of FreeCode's thin-client architecture, executed via a
  published client library instead of per-frontend IPC code.

---

## Cross-repo synthesis (all three analyses)

| Theme | grok-build | jcode | OpenCode | Best version to adopt |
|-------|-----------|-------|----------|----------------------|
| Headless / scripting | `-p` + output formats | `jcode run` | `serve` + OpenAPI + SDK | OpenCode's server+SDK, plus a `-p` shortcut |
| Extensibility | Plugins (config bundles) | Self-dev | JS plugin API | OpenCode's plugin API |
| Editor protocol | ACP | — | ACP | ACP (two of three ship it) |
| Undo / file safety | Hunk tracker | — | Snapshot /undo /redo | OpenCode's snapshots |
| Provider breadth | Single vendor | OAuth + 30 providers | models.dev (75+) + Zen | models.dev catalog + jcode's OAuth flows |
| Context efficiency | Codebase graph | Agent grep | Output store + truncation | Truncation first, agent-grep second |
| Multi-agent | Subagents + worktrees | Swarm + task DAG | Task tool + worktrees | Start simple; DAG if ambitious |
| Sandboxing | Landlock/Seatbelt | — | — | grok-build's (unique) |
| Memory | Basic | Semantic passive recall | **none** | jcode's (unique) |

## Already at parity (no action)

Effect-based DI (both use Effect!), tool factory/registry, MCP client,
skills, permission system with glob rules, plan mode, question tool,
worktrees, background jobs, PTY handling, compaction, multi-frontend
thin-client architecture. FreeCode's persistent memory and rollout event
sourcing have no OpenCode equivalent.

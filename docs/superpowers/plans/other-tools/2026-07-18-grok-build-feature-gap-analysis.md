# Grok Build → FreeCode: Feature Gap Analysis

> **Date:** 2026-07-18
> **Source:** `~/Projects/githubProjects/grok-build` — xAI's Grok CLI (Rust agent runtime, ~60 crates)
> **Status:** Analysis / roadmap candidates — nothing here is committed work.

Grok Build is xAI's terminal-based AI coding agent. FreeCode already matches it
on the fundamentals — hooks, skills, memory, MCP client, sessions with
fork/resume, compaction, event sourcing, permission profiles, subagents,
loop-health. The gaps are mostly in **execution safety, automation, and
orchestration UX**. This doc catalogs what's worth adopting, ordered by
value-to-effort.

---

## Quick Reference

| # | Feature | Grok crate / doc | Effort | Value |
|---|---------|------------------|--------|-------|
| 1 | Headless mode | `user-guide/14-headless-mode.md` | Low | High |
| 2 | Background tasks | `user-guide/20-background-tasks.md` | Medium | High |
| 3 | Prompt queue | `xai-prompt-queue` | Low | Medium |
| 4 | File-watch cache invalidation | `xai-fsnotify`, `xai-gix-status` | Low | High |
| 5 | Full plan mode workflow | `user-guide/19-plan-mode.md` | Low–Medium | Medium |
| 6 | OS-level sandboxing | `xai-grok-sandbox` | High | High |
| 7 | ACP editor protocol | `xai-acp-lib`, `user-guide/15-agent-mode.md` | Medium | High |
| 8 | Agent dashboard | `user-guide/23-dashboard.md` | Medium | Medium |
| 9 | Codebase graph (tree-sitter) | `xai-codebase-graph` | Medium–High | Medium |
| 10 | Hunk tracker / checkpoints | `xai-hunk-tracker` | Medium | Medium |
| 11 | Fast CoW worktrees | `xai-fast-worktree` | Medium | Medium |
| 12 | PTY-backed shell | `ptyctl` | Medium | Medium |
| 13 | Plugins system | `user-guide/09-plugins.md`, `xai-grok-plugin-marketplace` | Medium | Medium |
| 14 | Privacy-first OTEL export | `user-guide/24-monitoring-usage.md` | Medium | Low–Medium |
| 15 | Operational hardening | `xai-grok-update`, `xai-crash-handler`, `xai-sqlite-journal` | Low each | Low–Medium |

**Recommended first three:** headless mode (#1), background tasks (#2),
file-watch cache invalidation (#4). Strategic bets after that: sandboxing (#6)
and ACP (#7).

---

## Tier 1 — High value, very feasible

### 1. Headless mode

Grok runs one prompt non-interactively and exits:

```bash
grok -p "Your prompt here" --output-format json
```

Key flags:

| Flag | Purpose |
|------|---------|
| `-p, --single <PROMPT>` | One-shot prompt (also `--prompt-json`, `--prompt-file`) |
| `--output-format` | `plain`, `json`, `streaming-json` |
| `-r <ID>` / `-c` / `--fork-session` | Resume / continue latest / fork into new session |
| `--max-turns <N>` | Cap agentic turns |
| `--tools` / `--disallowed-tools` | Allow/deny lists for built-in tools |
| `--yolo` / `--permission-mode` | Auto-approve or set permission mode |
| `--allow` / `--deny` | Glob-based permission rules (repeatable) |
| `--rules <TEXT>` | Extra system-prompt rules |

**Why FreeCode wants it:** unlocks CI, scripting, and third-party integrations.

**Fit:** `apps/core` is already a long-running JSON-RPC server. A one-shot CLI
mode (`freecode -p ...`) is a thin wrapper over `session.start` +
`session.send` that streams `StreamEvent`s to stdout and exits on `done`.
Lives in `apps/core/src/cli/`. Probably the single highest-leverage gap.

### 2. Background tasks

Grok runs long-lived processes without blocking the conversation:

- `run_terminal_command` accepts `background: true` → returns a `task_id`
  immediately; a notification lands in the conversation on completion.
- `get_command_or_subagent_output(task_id, timeout_ms?)` — poll or wait for
  output/status.
- `wait_commands_or_subagents(task_ids, mode, timeout_ms)` — block on up to 20
  tasks; `wait_any` or `wait_all`.
- `kill_command_or_subagent(task_id)` — SIGTERM then SIGKILL for shells;
  Cancel + Shutdown for subagents.
- A scheduler and `/loop` command for recurring runs.

The same task-ID mechanism covers **subagents**, so parallel subagent
orchestration falls out of the same primitives.

**Fit:** add a `background` param to the bash tool, a task registry in core,
and two or three companion tools registered via `tools/factory.ts`. Completion
notifications flow through the existing bus (`bus/`). Makes the agent
genuinely capable of dev-server + test-watch workflows.

### 3. Prompt queue

Users type the next prompt while the agent is still working; it queues and
dispatches when the turn ends (`xai-prompt-queue` defines shared wire types
between shell and TUI).

**Fit:** small state addition in the TUI + a queue drained on `done`. Big UX
win for cheap.

### 4. File-watching for context invalidation

Grok pairs `xai-fsnotify` (filesystem events) with `xai-gix-status`
(fast git status) to detect **external** edits.

**Gap in FreeCode:** `context/tree-cache.ts` only invalidates after our own
mutating tools. Edits made outside the agent — user in their editor, another
process, git checkout — leave the cache stale.

**Fit:** a chokidar watcher in core that invalidates the tree cache (and
optionally flags files the agent has read that changed since). Small change,
fixes a real correctness hole.

### 5. Full plan mode workflow

FreeCode has a `plan` permission *profile*; Grok has a plan *workflow*:

- `enter_plan_mode` tool (agent-initiated, requires user approval) or
  user-initiated entry.
- While active: read/search everywhere, but the **only writable file is
  `plan.md`** in the session directory. Edits to any other file hard-fail with
  a message naming the plan file — in every permission mode, including
  always-approve.
- `exit_plan_mode` presents the plan for approval before implementation.
- Guidance on when plan mode is appropriate (genuine ambiguity) vs not
  (clear implementation path).

**Fit:** two tools + an enforcement check in the orchestrator layered on the
existing `permission/profiles.ts` plan profile.

---

## Tier 2 — High value, bigger investment

### 6. OS-level sandboxing

`xai-grok-sandbox` enforces filesystem/network limits with **kernel
primitives** — Landlock on Linux, Seatbelt on macOS — for the process
lifetime. Built-in profiles:

| Profile | FS Read | FS Write | Child network |
|---------|---------|----------|---------------|
| `off` (default) | all | all | all |
| `workspace` | all | CWD + `~/.grok/` + temp | allowed |
| `devbox` | all | all top-level dirs except `/data` | allowed |
| `read-only` | all | `~/.grok/` + temp | blocked (Linux) |
| `strict` | CWD + system paths | CWD + `~/.grok/` + temp | blocked (Linux, via seccomp) |

Custom profiles support kernel-enforced glob deny lists (`**/*.pem`, `.env`)
on top of any profile.

**Gap in FreeCode:** permission profiles are policy-level — the model asks
nicely; nothing physically stops a bash command from writing anywhere.

**Fit:** from Node, wrap tool subprocesses with bubblewrap/Landlock helper
binaries rather than in-process enforcement. Even sandboxing only the bash
tool would be a real safety upgrade. CLI surface: `freecode --sandbox
workspace|read-only|strict`.

### 7. ACP (Agent Client Protocol) support

`grok agent stdio` speaks the [Agent Client Protocol](https://agentclientprotocol.com)
— a standard JSON-RPC protocol for agent↔editor communication: session
management, prompt submission with streamed responses, tool visibility,
thought streams, permission handling.

**Fit:** FreeCode's protocol in `packages/shared/src/ipc/protocol.ts` is
structurally very similar (JSON-RPC over stdio, streaming events). An ACP
adapter alongside the native protocol gets Zed and other ACP-capable editors
for free, without touching existing frontends. Candidate: `freecode agent
stdio` subcommand mapping ACP methods onto the session service.

### 8. Agent dashboard

A centralized TUI view of every top-level session in flight:

- Entry: `grok dashboard`, `/dashboard`, or a keybinding.
- Rows grouped by state: Needs input → Working → Idle → Inactive →
  Completed → Failed.
- Per-row: peek (preview without attaching), attach, rename, pin, stop.
- Dispatch a new agent from the same screen.
- Subagents are not listed — they show under their parent session.

**Fit:** core already persists sessions and has a bus; `session.list` exists.
Mostly TUI work in `apps/tui`, plus a session-state summary endpoint.
Transforms multi-session workflows.

### 9. Codebase graph

`xai-codebase-graph`: "high-performance code graph generation using
tree-sitter queries" — structural, symbol-level context instead of a flat
file tree.

**Fit:** tree-sitter has good JS/WASM bindings. Slots in as a new strategy
under `context/strategies/`, complementing the tree cache. Improves the
model's first-shot navigation on large codebases.

---

## Tier 3 — Smaller ideas worth stealing

### 10. Hunk tracker

`xai-hunk-tracker`: tracks file hunks (diffs) with **agent vs external
attribution**. Foundation for:

- Checkpoints / undo of agent changes only.
- "The user edited this file since I last read it" awareness.
- Cleaner conflict handling when user and agent edit concurrently.

Pairs naturally with #4 (file watching).

### 11. Fast CoW worktrees

`xai-fast-worktree`: high-performance git worktree creation using
copy-on-write cloning — cheap isolated workspaces for parallel subagents.
Candidate integration point: `agent/subagent.ts` isolation option.

### 12. PTY-backed shell

`ptyctl`: headless PTY controller built on `alacritty_terminal`. Interactive
commands (TUIs, password prompts, watch modes) work under the agent; a plain
`child_process` bash tool can't handle those. `node-pty` gets most of the way
in Node. Grok also has persistent shell sessions
(`xai-grok-shell-session-support`) so state (cwd, env) survives across tool
calls.

### 13. Plugins

One installable unit bundling any combination of:

- `skills/` (SKILL.md files)
- `commands/` (slash commands)
- `agents/` (agent definitions)
- `hooks/hooks.json` (lifecycle hooks, with plugin-scoped env vars)
- `.mcp.json` (MCP server configs)
- `.lsp.json` (LSP server configs)
- optional `plugin.json` manifest (convention over configuration without it)

Grok also ships a marketplace crate (`xai-grok-plugin-marketplace`).

**Fit:** FreeCode already has skills, hooks, and MCP registries — a plugin
loader is mostly composition of existing loaders plus an install command.

### 14. Privacy-first usage telemetry (OTEL)

Export usage metrics/events to the **user's own** OpenTelemetry collector:

- Off by default; double opt-in (master switch + explicit exporter).
- Content-free by default: no prompts, no code, no file paths (extension
  only), no tool args; MCP/skill names collapsed to categories.
- Structurally separate from vendor telemetry; versioned schema.

Worth copying the *pattern* if FreeCode ever wants fleet observability for
teams.

### 15. Operational hardening

- **Self-updater** (`xai-grok-update`) — in-place binary/package update.
- **Crash handler** (`xai-crash-handler`) — capture panics with context.
- **Announcements** (`xai-grok-announcements`) — in-app news channel.
- **SQLite journal selection** (`xai-sqlite-journal`) — WAL on local disks,
  rollback journal on network mounts where WAL's mmap'd `-shm` is unsafe.
  Directly applicable to `store/sqlite-store.ts`.
- **Token estimation** (`xai-token-estimation`) — shared client-side token
  estimation primitives (FreeCode has `compaction/tokens.ts`; compare
  approaches).
- **Voice input** (`xai-grok-voice`) — niche, listed for completeness.

---

## Already at parity (no action)

Both agents have: lifecycle hooks, skills, persistent memory, MCP client,
sessions (resume/fork/export), subagents, permission modes, compaction,
markdown TUI rendering, slash commands, theming, project rules
(CLAUDE.md-style), and an LSP tool. FreeCode additionally has rollout event
sourcing and multi-provider support via the AI SDK, which Grok (single-vendor)
doesn't need.

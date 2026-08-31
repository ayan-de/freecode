# @thisisayande/freecode

## 0.27.1

### Patch Changes

- 5b51de0: ## v0.27.1

  A documentation and hardening release on top of `v0.27.0`. The 26 commits since `0.27.0` are mostly docs cleanup — the Mermaid conversion work moved ASCII box-drawings on `/internals/*` into proper flowcharts, and several internals pages were rewritten (subagents, runtime, permissions, bus, sessions, eval reference). Underneath, the agent-loop audit closed its last three known gaps, MCP got an interactive picker and stricter tool-conversion validation, `applyEdit` handles ambiguous matches, sessions got a cleanup pass, and the TUI gained `@mention` autocomplete plus fd-less file search and PowerShell clipboard image support.

  ### Added
  - **MCP command and interactive server picker** (`apps/tui/src/commands/built-in.ts`, `apps/tui/src/components/mcp-picker.ts`). A `/mcp` slash command lists configured servers with status, and the picker supports adding/removing entries without dropping to a config file. Tool-conversion (`apps/core/src/mcp/convert-tool.ts`) now validates input schemas before they reach the orchestrator and refuses the malformed ones earlier.
  - **`@mention` autocomplete and fd-less file search** (`apps/tui/src/utils/at-mention-provider.ts`, `file-search.ts`). The TUI input recognises `@` and offers file-path completions from a worker-pool search that doesn't depend on `fd` being installed — falls back to a hand-rolled directory walker and returns ranked by recency.
  - **PowerShell clipboard image handling** (`apps/tui/src/utils/clipboard.ts`). On Windows, the existing image-paste path now also reads PowerShell's clipboard (`Add-Type` + `System.Windows.Forms.Clipboard`) so an image copied from Snipping Tool lands in the prompt the same way a macOS/Linux paste does.
  - **`gemini-web` provider specification** (`docs/superpowers/specs/2026-08-29-gemini-web-provider.md`). The internal spec behind the gemini-web provider landed in `0.27.0`; this release ships the doc.

  ### Changed
  - **Doc diagrams: ASCII → Mermaid** across `/internals/context`, `/internals/hooks`, `/internals/ipc`, `/internals/compaction`, `/internals/providers`, and `/internals/sessions`. The `/internals/context` "What actually reaches the model" diagram is now a four-band flowchart showing the cache breakpoint explicitly (cached system → dynamic system → frozen `messages[0]` → conversation). A global CSS rule scales Mermaid text 15% across all 8 pages that render diagrams.
  - **`/internals/eval` rewritten to match the gate that shipped** (`apps/docs/app/internals/eval/page.mdx`). The reference page used to describe the pre-`0.27.0` gate (unconfigured judge passes by design, etc.); it now documents the post-`0.27.0` behaviour and points operators at `EVAL.md` and `TRACE.md` at the repo root.
  - **Internals pages rewritten** for `/subagents`, `/runtime`, `/permissions`, `/bus`, `/landing`. Each moved from prose-only to a structured page with diagrams and a "where to look" table at the end.

  ### Fixed
  - **`applyEdit` handles ambiguous matches** (`apps/core/src/tools/edit.ts`). When a unique substring matches in more than one place the tool now reports the ambiguity and the number of matches rather than silently picking the first — the previous behaviour could corrupt files when a substring appeared twice in the same line.
  - **Agent-loop audit close-outs** (`apps/core/src/agent/loop.ts`, `effect/loop-health.ts`, `tools/defs-cache.ts`, `recovery/manager.ts`, `title-generator.ts`):
    - `6668c61` closed 6 known gaps affecting cost and correctness (cache-write accounting, prune-state timing, defs cache invalidation, subagent tool gating, end-session flush ordering, breakdown format drift).
    - `815165f` removed the `title-generator` duplicate and the `recovery/manager` dead paths surfaced by the audit.
    - `e18de29` closed the remaining gaps around the `Stop` hook, `SessionStart` ordering, the tree-cache invalidation trigger, and loop-health heuristic D.
  - **Session cleanup** (`apps/core/src/session/manager.ts`, `store.ts`, `normalize/`). Stale sessions are now pruned on access and the dead normaliser module was removed.
  - **`/internals/sessions` event type counts corrected** to reflect the post-`0.27.0` `function.denied` event.

  ### Docs
  - **Mermaid text scaling** (`apps/docs/app/globals.css`) — 15% bump scoped to `.nextra-content` so it doesn't affect non-doc pages.
  - **Sessions "Three logs, three readers" → "Two logs, two readers"** (`apps/docs/app/internals/sessions/page.mdx`). The third log never existed; the section title was carried over from an earlier design and was misleading.

- Updated dependencies [5b51de0]
  - @thisisayande/freecode-core@0.27.1
  - @thisisayande/freecode-shared@0.4.1

## 0.25.9

### Patch Changes

- Memory-graph auto-injection is now visible in the chat. The `memory_injected` stream event from core surfaces in the TUI as `*Recalled N thing(s) from memory: type/name, …*` so the user can see what saved memories the loop pulled in for the current turn — previously the recall happened silently and the only signal was whatever the model did with it. One notice per user message (deduplicated by query text), not one per inner-loop tool-call turn.

- Updated dependencies
  - @thisisayande/freecode-core@0.25.9

## 0.25.8

### Patch Changes

- Agent-loop iteration safety valve: runs no longer get cut off mid-task with no output. Three pieces working together:
  - Interactive sessions (server.ts, `run` CLI) now default to `maxIterations: Infinity`, matching Claude Code's headless mode and opencode's `agent.steps` default — `maxTurns` is opt-in for subagents and `-p`-style invocations that pass an explicit cap, not a default on every run. `loop-health` (stuck-pattern detection) and the todo/verify gates are what actually end an interactive run.
  - New `wrapUpReminder()` (apps/core/src/agent/reminders.ts) injects a one-shot `<system-reminder>` into the final turn _before_ a cap trips, telling the model to stop calling tools and hand back a plain-text summary. Mirrors opencode's `MAX_STEPS_PROMPT`.
  - When the cap trips anyway, `AgentLoop` returns the model's last text + a `_Stopped: reached the N-turn iteration safety limit…_` footer instead of the previous bare `"Max iterations reached"` with no content. New `lastResponseText` field on `AgentLoop` keeps that text available across normal and abnormal stops.

  Covered by `apps/core/src/agent/max-iterations.test.ts`: wrap-up reminder shape, exact stop-at-cap (no runaway calls), last-text + footer in the returned content, and that the reminder is injected only on the final turn — not the first.

- Updated dependencies
  - @thisisayande/freecode-core@0.25.8

## 0.5.0

### Minor Changes

- 1ef2dd2: feat: add danger mode with permission bypass for agent operations

  Introduces a new `danger` agent mode that skips permission hooks,
  enabling fully automated execution for trusted workflows. Includes
  mode-specific badge colors and enhanced mode display in TUI.

### Patch Changes

- Updated dependencies [1ef2dd2]
  - @thisisayande/freecode-shared@0.3.0
  - @thisisayande/freecode-core@0.5.0

## 0.4.0

### Features

- Compaction indicator plus a `/compact` command
- Permission "ask" prompts are now queued so concurrent requests are handled cleanly
- `ls` tool renders with its own icon in tool output
- `tui` command supports navigating to a project directory

## 0.3.8

### Bug Fixes

- `/usage` heatmap now renders reliably and exits cleanly. pi-tui is detached while the heatmap runs so its render loop no longer paints over the alternate screen and the Kitty keyboard protocol no longer swallows the `q`/`Esc`/`Ctrl+C` exit keys; freecode's alternate screen is restored afterwards so quitting returns to the chat instead of the shell scrollback
- Bumped `@thisisayande/terminal-heatmap` to 1.3.0, which hardens the heatmap's own exit-key handling against input batched with mouse-motion reports

## 0.3.7

### Features

- Agent mode label is now rendered in uppercase (e.g. `BUILD`) in both the top status header and the mode line below the input
- The fixed top status bar (mode + model + context usage) now has a dark grey background spanning the full terminal width

## 0.3.6

### Features

- Fixed status header pinned to the top row once the first prompt is sent: agent mode and model on the left, live context-window usage with a progress bar on the right. The redundant mode/model line below the input is hidden after the first message
- In-progress line now shows a real live output-token count derived from the streamed response text, replacing the time-based estimate that only mirrored the elapsed seconds. The input-token count is seeded with an estimate at turn start instead of showing 0 until completion

## 0.3.5

### Features

- `freecode --resume <session-id>` resumes a previous session from the command line
- Ctrl+C interrupt handling: first press stops the current generation, second press exits and prints the resume command
- `/usage` shows real daily token usage instead of placeholder data

## 0.3.4

### Bug Fixes

- Large multi-line tool results corrupted the display: they were rendered as a single row with embedded newlines, throwing off the renderer's row accounting. Results now show a collapsed 5-line preview with a "… +N lines" tail
- Tool args containing newlines (e.g. edit's `old_string`) no longer break the tool header row

### Maintenance

- pi-tui upgraded 0.74.0 → 0.80.10: render throttling under streaming load, viewport reset after terminal shrink, full redraw on resize, and a stack-overflow fix for very large outputs

## 0.3.3

### Features

- Message history scrolling (PgUp/PgDn) works in any terminal, not just inside VS Code
- Claude Code–style `❯` prompt prefix on the input line
- `/model`: type-to-search across providers and models (167 providers from models.dev)
- `/model`: green ✓ mark for providers with a configured API key
- `/model`: new "Update API key" entry to replace a saved key
- Dedicated API key input with a visible prompt and Esc to cancel

### Bug Fixes

- Saved API keys could never be changed from the TUI (only by editing `~/.freecode/config.json`)
- Entering an API key no longer hijacks the chat input; an abandoned key prompt could previously swallow the next chat message as an API key
- `/model` no longer leaves a permanent "Use the selector below" system message in chat history

## 0.3.2

### Features

- Core CLI commands (`mcp`, `session`, `web`) now work from the installed binary
- New `freecode serve` command starts the headless JSON-RPC backend (stdio)
- Single yargs command surface: TUI is the default command, `-h` lists everything, unknown commands are rejected

## 0.3.1

### Bug Fixes

- Strip Windows-illegal characters (the drive-letter colon) from session directory names, so sessions can be created on Windows
- CI: let `pnpm/action-setup` read the version from `packageManager`, fixing the release workflow

## 0.3.0

### Features

- Ship as a single self-contained binary (TUI + backend bundled via `bun --compile`)
- One-line installer: `curl -fsSL https://freecode.ayande.xyz/install | bash` (+ PowerShell)
- `freecode update` to fetch the latest release; versioned installs with in-place updates
- GitHub Actions release workflow cross-compiles Linux/macOS/Windows binaries on tag push

## 0.2.0

### Features

- Add `danger` agent mode with permission bypass
- Mode-specific badge colors in TUI
- Enhanced agent mode display with cycling instructions
- Combine agent mode and model display in header

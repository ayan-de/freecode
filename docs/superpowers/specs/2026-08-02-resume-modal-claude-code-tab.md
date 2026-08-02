# Resume Modal — Claude Code Tab

**Date:** 2026-08-02
**Status:** Implemented (v2) — 2026-08-02
**Extends:** `2026-08-02-resume-modal.md` (v1 — two-pane modal, Freecode-only)
**Reference implementation:** `claude-config/src-tauri/src/storage/sessions.rs`
(the Rust module that lists Claude Code sessions from `~/.claude/projects/`)

## Goal

Add a **second tab to the resume modal** so users browsing `/resume` can also
see (and, in this iteration, browse) their Claude Code sessions. The current
modal only lists Freecode's own sessions; Claude Code users keep a parallel
history elsewhere and have no way to reference it from inside Freecode without
leaving the app.

The tab is **read-only in this PR**: the user can browse the Claude Code list
and preview transcript, but Enter does not import or resume — it shows a
"Coming soon" message. Import is a follow-up change once the Claude Code
transcript → Freecode message conversion is settled. The Freecode tab is
unchanged.

## Non-goals (this PR)

- Importing a Claude Code session into Freecode (the actual copy-and-resume).
  Tracked as a follow-up; the spec section below sketches the wire shape so
  the next change is purely additive.
- Editing Claude Code transcripts from the modal.
- Sidechain / sub-agent Claude Code sessions. The scanner skips them,
  matching the claude-config reference.
- A web frontend in this iteration. The web frontend does not implement
  `/resume` today; this spec describes the shape it should adopt when it does,
  but only the TS TUI is implemented here.

## Tab UX

The modal's title row gains a tab strip at the right edge:

```
┌────────────────────────────────────────────────────────────────────┐
│  Resume a session                Freecode  ◀  Claude Code  ▶       │
├────────────────────────────────────────────────────────────────────┤
│  ↑/↓ move · Tab focus preview · Enter resume · Esc cancel          │
├─────────────────────────────┬──────────────────────────────────────┤
│  › My deep dive · 12 turns  │                                      │
│    /home/user/proj          │       ### 🧑 You                     │
│    ...                      │       I was working on the spec…     │
│                             │                                      │
```

- The tab strip is rendered into the **title row only**, not as a separate
  strip below. The two tabs sit right-aligned within the title bar.
- The active tab renders with the pink/accent color and a `▎` marker under
  the label. The inactive tab renders dim.
- `←` and `→` swap the active tab. `Tab` (existing behavior) still moves
  focus between the list and preview panes *within* the active tab.
- The body (list + preview) is rebuilt when the tab changes. The cursor
  resets to 0 on every tab switch, and the preview cache is per-tab.
- When the user switches to a tab that has not yet been loaded, the body
  shows a single-shot spinner / "loading…" state until the list IPC resolves.
  A failed fetch shows `Failed to load <tab> sessions: <err>` in the preview
  pane and leaves the list empty.
- Switching tabs is **not** an `invalidate()` — list and preview caches
  persist across tab swaps so the user does not re-fetch a long transcript
  when they peek back at the other tab.

## Keybindings (delta from v1)

All v1 keys keep their meaning. New keys:

| Key           | Action                                                            |
|---------------|-------------------------------------------------------------------|
| `←`           | Active tab is `Claude Code` → swap to `Freecode`.                 |
| `→`           | Active tab is `Freecode` → swap to `Claude Code`.                 |
| `←` / `→` on the off-tab (Freecode active, `→` presses) | No-op (`→` from Claude Code also no-op). Tab is two-state, not a wrap-around cycle. |
| `Enter` on Claude Code tab | Show a non-modal information message: "Importing Claude Code sessions is coming soon." Modal stays open. |
| `h` / `l`     | Mirror `←` / `→` for vim-style users (matches `k`/`j` mirroring). |

The preview/list focus split still uses `Tab` — `Tab` never moves between the
tabs. This avoids a collision with the existing v1 keybinding.

### Pane focus + tab interaction

- Active tab is `Freecode`:
  - `↑`/`↓` move cursor (list) or scroll (preview) — unchanged.
  - `←` / `→` swap to the other tab regardless of which pane is focused.
- Active tab is `Claude Code`:
  - Same as Freecode, but `Enter` is the "coming soon" stub.
  - Mouse-wheel routing stays the same (wheel over the list column moves
    cursor; wheel over the preview column scrolls preview).

## Modal shape (Claude Code tab)

The list column shows the same five-row layout as the Freecode tab:

```
› My deep dive · 12 turns
  /home/user/proj
  Closed 2h ago
  Created 3d ago
```

with one cosmetic difference: the title is the **Claude Code session title**
(`customTitle`, fall back to `aiTitle`, then `firstPrompt`, then
`<session-id>`). The project path is the **transcript's `cwd`**, not the
folder slug. The Closed timestamp is the transcript's `modified` mtime; the
Created timestamp is the transcript's `created` mtime.

The preview column renders the **full transcript** as markdown, exactly like
the Freecode preview:

```
### 🧑 You
<text parts joined with newlines>

### 🤖 Assistant
<text parts joined with newlines>
```

`tool_use` blocks are rendered as a blockquote with the tool name
(`> 🔧 \`tool-name\``); `tool_result` blocks are skipped (they usually repeat
the tool output already shown when the assistant next speaks). Image/attachment
records are skipped.

## IPC contract

Two new methods, both handled by `apps/core/src/server.ts`. The shared
`packages/shared/src/ipc/protocol.ts` `METHODS` table pins their schemas.

### `session.claudeList`

```typescript
params: {
  /** Optional projectPath filter. Reserved for parity with session.list; the
   *  TUI does not pass it (the picker wants the global view). */
  projectPath?: string;
  /** Maximum rows to return. Defaults to 500. */
  limit?: number;
};
result: ClaudeSessionMeta[];
```

`ClaudeSessionMeta` is a slim row, mirroring `SessionMeta`'s shape:

```typescript
interface ClaudeSessionMeta {
  id: string;            // session uuid (the jsonl filename stem)
  title: string;         // customTitle → aiTitle → firstPrompt → "(untitled)"
  projectPath: string;   // transcript.cwd, or '' if unreadable
  provider: "claude-code";
  model?: string;        // transcript.model (when present)
  createdAt: number;     // transcript.created mtime, epoch ms
  updatedAt: number;     // transcript.modified mtime, epoch ms
  lastTurnAt: number;    // == updatedAt (Claude Code has no separate turn clock)
  turnCount: number;     // message_count from sessions-index, or jsonl length
  fullPath: string;      // absolute path to the .jsonl transcript
}
```

The field `provider: "claude-code"` is the discriminator that lets the
frontend route Enter correctly. The browser/codexbar cases also keep the
literal `"claude-code"` so a future "Codex" tab can use `"codex"` without
breaking the discriminator.

### `session.claudeTranscript`

```typescript
params: { sessionId: string };
result: ClaudeTranscript | { error: string };
```

```typescript
interface ClaudeTranscript {
  sessionId: string;
  messages: SerializedMessage[];   // ← reuse the existing serialized shape
}
```

The transcript is converted to `SerializedMessage[]` so the existing preview
markdown renderer is reused with no changes. The conversion is a best-effort:

- user/assistant text parts → `text` parts
- `tool_use` blocks → `tool` parts with `name`/`args` (no result yet; the
  next assistant text that follows is the natural result, but we do not
  group — each block is its own part)
- `tool_result` blocks → dropped (the wrapping assistant text already
  reflects the result)
- attachment / hook_success / file-history-snapshot / mode / system →
  dropped
- empty assistant messages (no content blocks) → dropped

Bounded by `IMPORT_HISTORY_MAX_MESSAGES` (160) to keep the IPC payload
predictable, matching the jcode reference.

### Wire types

`ClaudeSessionMeta` and `ClaudeTranscript` live in
`packages/shared/src/types.ts` next to `SessionMeta` and `SessionResumeResult`.

## Core scanner

`apps/core/src/claude-sessions/` is a new module. Three files:

```
apps/core/src/claude-sessions/
├── index.ts        # barrel: re-exports scanClaudeSessions + readClaudeTranscript
├── scanner.ts      # listClaudeSessions(opts) → ClaudeSessionMeta[]
└── transcript.ts   # readClaudeTranscript(sessionId) → SerializedMessage[]
```

### `scanner.ts` — `listClaudeSessions(opts)`

1. Resolve the Claude Code root dir:
   - `$CLAUDE_CONFIG_DIR` if set and non-empty (matches `claude-config`'s
     `discover_claude_dir()`).
   - Otherwise `~/.claude`.
2. If `<root>/projects/` does not exist, return `[]` (no error).
3. For each entry under `projects/`, attempt `sessions-index.json` first.
   - Parse the JSON; treat a missing-malformed file as "no index".
   - Skip entries with `isSidechain: true` or empty `sessionId`.
   - For each indexed entry, merge:
     - `sessionId`, `modified`, `created`, `messageCount`, `projectPath`
       from the index.
     - Title from the transcript's head+tail 64KB windows
       (`customTitle` → `aiTitle` → `summary` → `firstPrompt`).
     - If the index says the jsonl path exists but is unreadable, fall back
       to the index's `summary` / `firstPrompt` for the title.
4. For each jsonl file in the project dir that the index did not already
   account for, also emit a row (stat-only fallback). Helps when Claude Code
   has started but not yet flushed the index.
5. Sort by `modified` descending. Return `[..opts.limit ?? 500]` rows.

### `transcript.ts` — `readClaudeTranscript(sessionId)`

Resolves the absolute path from the metadata we already produced
(`ScannerMeta.fullPath`), then reads the jsonl line by line:

- Skip lines whose `type` is not `user` / `assistant`.
- For each kept line, parse the message content:
  - `content` is a string → one `text` part.
  - `content` is an array of blocks:
    - `type: "text"` → `text` part.
    - `type: "tool_use"` → `tool` part with `name` / `input`.
    - `type: "tool_result"` → drop.
    - `type: "image"` → drop (image data is not transferable without
      re-hosting).
- Drop messages with zero parts.
- Return at most 160 messages.

Bounded I/O: read with `createReadStream` (`utf8`); never load the whole
jsonl into memory at once. For our 64KB head+tail title scan, read separately
and concatenate.

### Filesystem decoder

The project folder under `~/.claude/projects/` is the cwd with `/` replaced
by `-`. We use the **transcript's own `cwd` field** when available (the
single source of truth); only fall back to filesystem-aware slug decoding
when the transcript is empty or corrupt. This matches the claude-config
reference.

### Env-var resolution

```typescript
function getClaudeConfigDir(): string {
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env && env.trim().length > 0) return path.resolve(env);
  return path.join(os.homedir(), ".claude");
}
```

The function is injected via a `claudeConfigDir?: string` option on both
`listClaudeSessions` and `readClaudeTranscript` so tests can point it at a
temp dir without touching the real `~/.claude`.

## Frontend wiring

### `apps/tui/src/index.ts::showResumePicker`

```text
1. Fetch freecodeSessions ← session.list, sorted by lastTurnAt desc.
2. Fetch claudeSessions   ← session.claudeList, sorted by modified desc.
3. Build a single ResumePicker with both lists present.
4. On left/right arrow, swap the active tab. The modal calls
   ensurePreview(sessionId) for the active tab's selected row.
5. On Enter:
     - Freecode tab  → existing resume flow (unchanged).
     - Claude Code tab → show info message, leave modal open.
6. The picker still closes on Esc / Ctrl+C.
```

If `session.claudeList` fails (e.g. no `~/.claude`, or permission error),
the Freecode tab is the only available tab — the right arrow is a no-op and
the Claude Code tab renders dimmed with a `failed to load` hint. This way
fresh installs (no Claude Code on the machine) silently degrade to the
existing single-tab UX.

### `apps/tui/src/components/resume-picker.tsx`

The `ResumePicker` constructor gains two new fields:

```typescript
constructor(
  freecodeSessions: SessionMeta[],
  claudeSessions: ClaudeSessionMeta[],
  private readonly callbacks: ResumePickerCallbacks,
)
```

The component now owns:
- `activeTab: "freecode" | "claude-code"` (default `freecode`).
- `loadingClaude: boolean` (true until `session.claudeList` resolves).
- `claudeError: string | null`.
- Per-tab preview caches: `previewsFreecode`, `previewsClaude`.

The list + preview renderers switch on `activeTab`. The title row renders
the tab strip inline, right-aligned. The card row generator (`cardRow`)
already supports right-aligning a styled fragment by padding the trailing
edge; the tab strip is built the same way.

### `apps/tui/src/ipc/client.ts`

Two new helpers:

```typescript
export async function sessionClaudeList(opts: {...}): Promise<ClaudeSessionMeta[]>
export async function sessionClaudeTranscript(sessionId: string): Promise<ClaudeTranscript>
```

## Invariants

1. **Core is the only reader of `~/.claude/`.** The frontend only calls
   `session.claudeList` and `session.claudeTranscript`. The on-disk shape is
   opaque to the frontend.
2. **Both IPC contracts are the source of truth.** TypeScript types live in
   `packages/shared/src/types.ts`. The Rust mirror (`apps/tui-rs`) is updated
   by hand, mirroring the v1 precedent.
3. **The Claude Code session is left untouched.** Read-only this PR — the
   scanner never writes back to the user's jsonl.
4. **Tab switch is a no-op on the active tab.** Pressing `→` from the right
   tab is a no-op, not a wrap-around. This matches Claude Code's own
   two-tab layout.
5. **Tab is decoupled from pane focus.** `Tab` still moves between list and
   preview; `←`/`→` move between Freecode and Claude Code. The two are
   independent.
6. **Failure on the optional tab is silent.** If `session.claudeList` fails,
   the modal still opens with the Freecode tab; the Claude Code tab is
   dimmed and the right arrow is a no-op. The error is logged but not
   surfaced.

## Verification

Manual:

- `pnpm build` passes in `packages/shared`, `apps/core`, and `apps/tui`.
- Opening `/resume` with both `~/.freecode/sessions` and `~/.claude/projects`
  populated shows two tabs; left/right switches between them.
- The list column on the Claude Code tab shows real titles from
  `customTitle` and the project path from `cwd`.
- The preview column renders the full transcript as markdown.
- Enter on the Claude Code tab shows the "coming soon" message without
  closing the modal.
- Esc / Ctrl+C close the modal at any time.
- A machine with no `~/.claude` opens the modal with the Freecode tab only
  and the Claude Code tab dimmed.

Tests:

- `scanner.test.ts` covers: empty dir / missing dir / index hit / index miss
  + jsonl fallback / sidechain skip / claude-config-dir override / title
  priority (`customTitle` > `aiTitle` > `summary` > `firstPrompt`).
- `transcript.test.ts` covers: user/assistant text conversion / tool_use
  → tool part / tool_result drop / image drop / message cap at 160.
- `resume-picker.test.ts` adds tests for: tab navigation (left/right
  swaps), tab-only Enter stub, no-op `→` from Claude Code, modal still
  opens when `session.claudeList` fails.

## Implementation notes (TS, pi-tui)

- The tab strip is rendered as part of the title row. The space is reclaimed
  from the right edge of the existing title bar; the title text is
  ellipsized to `innerWidth - tabStripWidth` so the two never collide.
- The "loading" state for the Claude Code tab is rendered in the preview
  pane (not the list pane), matching the v1 "loading preview…" pattern.
- Mouse-wheel routing is unchanged: column-based, independent of the tab.
- The HTML/web equivalence is out of scope for this PR (the web frontend
  does not implement `/resume`).

## Follow-up (not in this PR)

- `session.claudeImport(sessionId)` → copies the jsonl into a new Freecode
  session and resumes it. The wire shape is sketched in this spec so the
  change is purely additive.
- The "coming soon" message is replaced by the real import flow.
- A "Codex" tab with the same shape (`provider: "codex"`), pointing at
  `~/.codex/sessions/`.

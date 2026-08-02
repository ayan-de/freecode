# Resume Modal — Design Spec

**Date:** 2026-08-02
**Status:** Implemented (v1) — 2026-08-02
**Extends:** `2026-05-25-architecture-v4.md` (session lifecycle),
`2026-06-02-memory-session-design.md` (session store)
**Source analysis:** `apps/tui-rs/src/ui/session.rs`, `apps/tui-rs/src/app.rs`,
`apps/tui-rs/src/main.rs` (the Rust implementation that this spec formalizes),
`apps/tui/src/components/resume-picker.tsx` (the older single-pane variant)

## Goal

Replace the single-pane `/resume` picker (a plain scrollable list that resumes
on `Enter`) with a **two-pane modal**: a session list on the left and a
markdown transcript preview of the highlighted session on the right. The
preview is fetched lazily and cached per session, so opening the modal is fast
and only the hovered session pays a `session.resume` round-trip.

The behavior is **shared across frontends** by spec — the implementation
cannot be shared (TS vs Rust), but the visible UX, keybindings, and IPC
contract are pinned here so the two frontends stay in sync.

## Non-goals

- Editing transcripts, search, or any rich-text interactions in the preview.
- Per-session actions (`/delete`, `/archive`, `/fork`) — the picker is for
  *resume* only. These live behind their own `/` commands.
- Persisting the preview cache across restarts. The cache is in-memory and
  built lazily as the cursor moves.
- A web frontend in this iteration. The web frontend (`apps/web`) does not
  implement `/resume` today; this spec describes the shape it should adopt
  when it does.

## User-facing behavior

### Modal shape

```
┌────────────────────────────────────────────────────────────────────┐
│                       Resume a session                             │
│ ↑/↓ move · Tab focus preview · Enter resume · Esc cancel           │
├─────────────────────────────┬──────────────────────────────────────┤
│  › My deep dive · 12 turns  │                                      │
│    /home/user/proj          │                                      │
│    Closed 2h ago            │   ### 🧑 You                         │
│    Created 3d ago           │   I was working on the spec…         │
│                             │                                      │
│    Previous session · 5 t.. │   ### 🤖 Assistant                   │
│    /home/user/other         │   …                                  │
│    Closed 1d ago            │                                      │
│    Created 4d ago           │                                      │
├─────────────────────────────┴──────────────────────────────────────┤
│ Tab: focus preview      ↑/↓: scroll preview      Enter: resume     │
└────────────────────────────────────────────────────────────────────┘
```

- The modal is a full-bleed card: it spans the full terminal width (no
  horizontal margin) with a small vertical margin above and below.
- Internal layout: list (left, ~38%) | preview (right, ~62%).
- The list shows every session, one row per session, with the title, project
  path, last-activity relative time, and created-at relative time.
- The preview renders the highlighted session's transcript as markdown:

  ```text
  ### 🧑 You
  <text parts joined with newlines>

  ### 🤖 Assistant
  <text parts joined with newlines>
  ```

  `code` parts become fenced code blocks, `tool` parts become a single-line
  blockquote (`> 🔧 \`tool-name\``), other parts (image, unknown) are skipped.

### States

| State | What the user sees |
|---|---|
| List loading / modal opening | Title card; preview pane shows `loading preview…` |
| List loaded, no cursor item yet | Same as above |
| Cursor on a session whose preview is not yet fetched | `loading preview…` |
| Cursor on a session whose preview is fetched | Markdown transcript |
| Cursor on a session with empty transcript | `*Empty session.*` |
| `session.list` returns no sessions | Modal does not open. A non-modal system message is shown instead: `No previous sessions to resume.` |
| `session.list` fails | Modal does not open. System message: `Failed to list sessions: <error>`. |
| `session.resume` fails (per-item) | Preview stays as `loading preview…`; the failure is logged but does not surface to the user (logging is implementation-specific) |
| `session.resume` fails on Enter (the action) | Modal closes. System message: `Failed to resume session: <error>`. |

### Keybindings

When the modal is open, the keyboard is owned by it. The TUI's normal
input/editor/chrome handlers are suspended.

| Key | Focus on list | Focus on preview |
|---|---|---|
| `↑` / `k` | Move cursor up by 1 session (wraps) | Scroll preview up by 1 line |
| `↓` / `j` | Move cursor down by 1 session (wraps) | Scroll preview down by 1 line |
| `Tab` / `BackTab` | Move focus to preview | Move focus to list |
| `PageUp` | Scroll list up by 5 sessions (cursor stays put) | Scroll preview up by 5 lines |
| `PageDown` | Scroll list down by 5 sessions (cursor stays put) | Scroll preview down by 5 lines |
| `Home` | Move cursor to first session | Scroll preview to top |
| `End` | Move cursor to last session | Scroll preview to bottom |
| `Enter` | Resume the highlighted session (close modal, replace transcript) | Resume the highlighted session |
| `Esc` | Close modal, return focus to editor | Close modal, return focus to editor |
| `Ctrl+C` | Close modal (matches `Esc`), return focus to editor | Close modal |

The arrow keys (`↑`/`↓`) are the primary motion keys; `k`/`j` mirror them
because that is the prevailing convention in the rest of the TUI's keyboard
surface. The Rust implementation uses `k`/`j` for both the list and the
preview; the TS implementation should match.

**Cursor model.** The list has one cursor position per session, regardless of
how many terminal rows each session occupies (each session is rendered as 5
rows: title, project path, closed-relative-time, created-relative-time,
trailing blank). `↓` always advances to the next session; `↑` always retreats
to the previous session. Cursor wrap-around is supported: `↓` on the last
session moves to the first, `↑` on the first moves to the last.

**Auto-scroll (list).** When the cursor moves out of the visible list window,
the list scrolls so the cursor row stays in view. Concretely, if the cursor
moves above the topmost visible session, the list scrolls up; if it moves
below the bottom-most visible session, the list scrolls down. The list also
scrolls in response to user input (`PageUp`/`PageDown` on the focused list),
independent of the cursor.

**Scrollbars.** When the visible region is smaller than the total, a thin
vertical scrollbar is drawn at the right edge of each pane. The active pane
(the one with focus) shows its thumb in the accent color; the inactive pane
shows its thumb dimmed. The list scrollbar is rendered against the *session*
count; the preview scrollbar is rendered against the *rendered line* count.

### Lazy preview

The preview for the highlighted session is fetched with `session.resume`
when the cursor lands on it for the first time. Results are cached per
session id in a `Map<sessionId, SerializedMessage[]>`. A subsequent revisit
to the same row reads the cache.

Moving the cursor:

1. Updates the cursor index.
2. Resets the preview scroll to 0 (a new transcript restarts at the top).
3. Auto-scrolls the list if the cursor moved out of the visible window.
4. If the new cursor's id is not in the cache, fires `session.resume` in the
   background. The preview pane keeps showing the previous preview (or
   `loading preview…`) until the response lands.

The list itself is loaded once when the modal opens (`session.list`).

### Resume action

`Enter` (in either focus) fires one more `session.resume` for the selected
id (the cache may be stale or empty — for a fresh install it is empty, and
the modal might be opened and immediately entered). On success:

1. The modal closes.
2. The current session is replaced with the resumed session.
3. The transcript is replaced with the resumed messages.
4. A `Session resumed with N messages.` confirmation is shown.
5. The editor regains focus.

If the resumed session is the same as the currently active session (e.g. the
user opened `/resume` and picked the row they were already in), the modal
still closes and the transcript is reloaded — this is the safest behavior
because the user explicitly chose to resume.

### Entering the modal

- The `/resume` slash command opens the modal.
- `freecode --resume` (no id) opens the modal at startup.
- Both paths funnel through the same `open_session_picker` flow.

### Exiting the modal without resuming

- `Esc` and `Ctrl+C` both close the modal. The currently active session
  (if any) is left untouched. The editor regains focus.

## IPC contract

Two IPC methods are involved. The shared
`packages/shared/src/ipc/protocol.ts` `METHODS` table pins their schemas.

### `session.list`

```typescript
params: { projectPath?: string; status?: SessionStatus };
result: SessionMeta[];
```

- `projectPath` filters to sessions belonging to that project. Frontends
  SHOULD NOT pass this — the renderer wants the global view so users can
  resume work across projects.
- `status` filters to those in the given state. Frontends SHOULD NOT pass
  this — the picker wants all sessions, including `archived` and
  `interrupted`.
- `core/apps/core/src/server.ts` sorts the result by `lastTurnAt` descending
  (most recent first) *before* returning it. Frontends MAY sort again as
  a defensive measure but it is redundant.

### `session.resume`

```typescript
params: { sessionId: string };
result: SessionResumeResult; // { sessionId: string; messages?: SerializedMessage[] }
```

- The `sessionId` is the row the user picked.
- `messages` is the full transcript. It may be empty/missing for an empty
  session (the picker then renders `*Empty session.*`).
- The frontend uses both `sessionId` (to set the currently active session)
  and `messages` (to rehydrate the chat).

### Wire types

`SessionMeta`, `SerializedMessage`, `SessionResumeResult`, and the
`SessionStatus` literal are all defined in
`packages/shared/src/types.ts` and re-exported from
`packages/shared/src/index.ts`. The Rust implementation has its own hand-
maintained mirror in `apps/tui-rs/src/ipc/protocol.rs` and tracks the
canonical definition manually.

## Frontend responsibilities

Frontend is presentation + IPC only — `apps/core` decides what `session.list`
and `session.resume` return. The frontend NEVER reads the session store
directly.

### `apps/tui/src/components/resume-picker.tsx` (TS, pi-tui)

The single-pane `SelectList` implementation that exists today is replaced
with a component that:

- Holds a `Box` (or equivalent layout primitive) with two children:
  - An enhanced `SelectList` for the session list (the same component,
    repurposed; today it has `onSelect`/`onCancel` — the new variant
    switches to `onSelectionChange` so we can fire the lazy preview
    fetch on cursor move).
  - A markdown preview panel (a `Markdown` component built from the
    rendered transcript string; the cached message list is converted to
    markdown on cache hit).
- Maintains a `Map<sessionId, SerializedMessage[]>` cache as the cursor
  moves.
- Exposes `onSelectionChange` so the outer index.ts can fire the lazy
  `session.resume` IPC call (the TS reactivity model is callback-driven,
  so the IPC plumbing lives in the wiring layer, not in the component).
- Exposes `onSelect` (resume) and `onCancel` (close).
- Exposes `setPreview(messages: SerializedMessage[])` so the wiring layer
  can push the fetched preview into the component after the IPC round-trip.

### `apps/tui-rs/src/commands/session.rs` + `app.rs` + `ui/session.rs` (Rust, ratatui)

Already implements the behavior above. No change required for this spec.
The Rust implementation is the reference implementation.

### `apps/tui/src/index.ts` (wiring)

- `showResumePicker()` is refactored to:
  1. Call `sessionList()` and sort by `lastTurnAt` descending (defensive).
  2. Build a `createResumePickerWithPreview(...)` factory that returns a
     composite component with a `loadPreview(id, messages)` method.
  3. Insert the component into the TUI tree and focus it.
  4. On `onSelectionChange`, fire `sessionResume(id)` if the id is not in
     the cache. Push the result into the component via `loadPreview`.
  5. On `onSelect`, fire `sessionResume(id)`, replace the transcript
     (via `loadSessionMessages`), set the current session, and close the
     modal.
  6. On `onCancel`, close the modal and focus the editor.

- If `sessionList` returns an empty list, the modal does not open and a
  system message is shown instead.
- The `Ctrl+C` cancel branch in `index.ts` is updated to dismiss the new
  picker (it already does this for the current picker).

## Invariants

1. **Frontend does not read the session store.** It only calls
   `session.list` and `session.resume`. Any change to the on-disk shape
   (`apps/core/src/session/store.ts`) is opaque to the frontend as long
   as the IPC contracts above are preserved.
2. **The IPC contracts are the source of truth.** TypeScript types live in
   `packages/shared/src/types.ts`; the Rust types mirror them by hand.
3. **The preview is best-effort.** A failed `session.resume` for a preview
   leaves the preview pane showing `loading preview…`; the user can still
   navigate the list and pick a different session.
4. **The picker is a modal.** When it is open, it owns the keyboard — the
   editor and the slash-command completion menu are suspended.
5. **Cursor wrapping is supported.** `↓` on the last row moves to the
   first; `↑` on the first row moves to the last. The Rust implementation
   uses `rem_euclid`; the TS implementation should match.

## Verification

- `pnpm build` passes in `packages/shared` and `apps/tui`.
- Opening `/resume` shows the two-pane modal with a list on the left.
- Moving the cursor triggers a `session.resume` for the new id (visible
  in the IPC trace).
- The preview pane updates with the transcript once the response lands.
- `Tab` swaps focus between the list and the preview; arrow keys take
  the focused behaviour.
- `Enter` resumes the highlighted session, closes the modal, and
  replaces the transcript.
- `Esc` and `Ctrl+C` close the modal without resuming.
- `session.list` returning `[]` does not open the modal; a system message
  is shown instead.
- `session.list` failing does not open the modal; an error message is
  shown.

## Implementation notes (TS, pi-tui)

This is descriptive of the port's mechanics, not a hard contract — the
frontend may deviate where the pi-tui primitives require it.

- The composite picker is built by combining a `Box` (which gives padding
  and a background) with two children: a `SelectList` and a text view that
  renders the transcript markdown via `Markdown`.
- The TS pipeline reuses the *same* `SelectList` component the current
  `createResumePicker` uses, but flips the wiring from `onSelect` (which
  commits immediately) to `onSelectionChange` (which is informational).
  The `onSelect` handler is still wired for `Enter`.
- The preview cache lives in the wiring layer (`index.ts`), not inside
  the component, because the IPC call is async and the component must
  remain synchronous. The component exposes a `setPreview(messages)`
  method that the wiring layer calls after the IPC resolves.
- The preview text is rendered as a single string of markdown. The
  conversion is the same as `apps/tui-rs/src/ui/session.rs::preview_markdown`:
  - Emit `### 🧑 You` for user messages, `### 🤖 Assistant` otherwise.
  - For each part: `code` ⇒ fenced block, `tool` ⇒ blockquote with the
    tool name, anything else (text, image, unknown) ⇒ skip if no content.

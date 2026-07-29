# Terminal Text Selection & Clipboard Copy — Design

## Problem

Both `apps/tui` and `apps/tui-rs` run full-screen (alt-buffer) and enable
terminal mouse reporting (`\x1b[?1000h` / crossterm `EnableMouseCapture`) so
the mouse wheel can drive in-app scrolling. This has the side effect of
taking mouse events away from the terminal emulator, which silently breaks
the terminal's own click-drag text selection — nothing highlights, nothing
copies. Since both apps already own mouse input, the fix is to finish the
job: implement selection and clipboard copy ourselves rather than try to
hand mouse control back to the terminal.

## Goals

- Click-drag over rendered message history highlights the dragged text.
- Releasing the drag copies the selected text to the system clipboard.
- A transient "Copied N chars" indicator appears in the bottom-right corner.
- Works identically in `apps/tui` (TypeScript / pi-tui) and `apps/tui-rs`
  (Rust / ratatui + crossterm).
- Survives scrolling mid-drag (freecode's scrollback/virtualized history is
  load-bearing here — selection must not skew if the viewport scrolls).
- Works over SSH/tmux, since freecode sessions commonly run inside a
  session manager's PTY.

## Non-goals

- Shell-out clipboard fallback (`xclip`/`wl-copy`/`pbcopy`). Adds a
  dependency and a platform-detection branch for a failure mode not yet
  observed. Revisit only if a specific terminal is reported where OSC 52
  doesn't land.
- Selecting non-text UI chrome (borders, the editor's own input line is
  out of scope for v1 — selection applies to the scrollable message
  history only).
- Multi-region / rectangular selection. Single contiguous drag range only.
- Autoscroll-on-drag-to-edge. Dragging the cursor to the top/bottom edge of
  the viewport does not trigger scrolling in v1 — the user scrolls first,
  then drags within the visible viewport. Real added complexity on top of
  an already-nontrivial selection UX; revisit if it's requested.

## Design

### 1. Mouse mode

- TS: `terminal-screen.ts` changes `ENABLE_MOUSE` from `\x1b[?1000h\x1b[?1006h`
  to `\x1b[?1002h\x1b[?1006h` (button-event motion tracking — reports
  movement only while a button is held, not every hover).
- Rust: crossterm's `EnableMouseCapture` already delivers
  `MouseEventKind::Drag` once capture is enabled; no crate changes needed.

### 2. Selection state — scroll-invariant logical coordinates

Resolve mouse-down immediately to a **logical position**: `(messageIndex,
lineOffsetWithinMessage, column)`, using the existing rendered-row → message
map (`VirtualMessageList.lastLineMap` in TS; the equivalent index built in
`draw_messages` for Rust) at the moment of press — not re-derived from
screen row on every motion event. Drag and release events resolve the same
way. This makes the selection range immune to the buffer scrolling between
mouse-down and mouse-up (manual scroll mid-drag; there is no autoscroll —
see Non-goals).

`column` is a **display-column** index (terminal cell position), not a byte
or char-count index. Freecode's rendering includes box-drawing chrome and
Unicode content (CJK, emoji, status icons) where glyphs can be double-width,
so char-count columns would drift between a narrow-glyph row and a
wide-glyph row and land the reverse-video span off by one or more cells.
Both `lastLineMap` (TS) and the Rust row index must resolve column
positions using a display-width table (e.g. the wcwidth-style logic already
needed for correct line-wrapping in both renderers), not `string.length` /
`chars().count()`.

Selection is stored as `{ anchor: LogicalPos, cursor: LogicalPos }`;
normalized (start before end) when read for rendering/copy.

### 3. Highlight rendering

Both renderers already build styled output from a plain-text source before
compositing ANSI/styling (see §5). Highlighting reuses that same
plain-text-first path rather than operating on already-styled output:
- TS: `chalk.inverse(...)` is applied to the plain-text substring (sliced by
  display-column, per §2) *before* it's composited into the final styled
  line — never by slicing an already-ANSI-styled string, which risks
  cutting mid-escape-sequence.
- Rust: `Style::default().add_modifier(Modifier::REVERSED)` is applied by
  slicing `Span` boundaries at the plain-text display-column index, then
  building the styled `Span`, not by slicing an already-composed `Line`.

No new rendering pipeline — this is a style pass over the same plain-text
source and logical coordinates used elsewhere in this design.

### 4. Clearing selection

Selection clears on:
- New mouse-down outside the current selection (starts a new drag).
- A plain click (down+up with ~zero movement) *inside* the existing
  selection — matches normal text-select UX (a stray click shouldn't look
  like a no-op).
- `Escape` key.
- Terminal resize while a drag/selection is active. `lastLineMap` and the
  Rust row index are keyed to current viewport dimensions, so a resize
  invalidates any in-flight logical coordinates; clearing is cheaper and
  safer than trying to re-resolve them against the new layout.

### 5. Extracting plain text

On mouse-up, walk the logical range, pull the underlying plain text for
each covered line (already available pre-ANSI-styling — both renderers
build styled output from a plain-text source), join with `\n`.

### 6. Clipboard copy — OSC 52, with tmux passthrough

Shared helper (mirrored in both codebases, since there's no shared runtime
between TS and Rust):

```
osc52_copy(text: string) -> writes to stdout:
  base64 = base64(text, up to CAP)
  seq = "\x1b]52;c;{base64}\x07"
  if $TMUX is set:
      seq = "\x1bPtmux;" + seq.replace("\x1b", "\x1b\x1b") + "\x1b\\"
  write(seq)
```

- **Size ceiling**: cap at 100 KB of base64 output (~75 KB raw text) — the
  historical safe ceiling across common terminal OSC 52 implementations.
  Over the cap, **head-truncate**: keep the first N chars of the selection
  and drop the tail, then copy that instead of dropping the payload or
  sending something a terminal will reject. This matches the indicator text
  in §7 ("Copied first {n} chars") — if truncation direction ever changes,
  update both sections together.
- **No ack**: OSC 52 has no response. Silent no-op on terminals that don't
  support it — no crash, no error surfaced, since there's nothing to detect.

### 7. "Copied N chars" indicator

- TS: `tui.showOverlay(text, { anchor: 'bottom-right', nonCapturing: true })`,
  auto-`hide()` after ~1.5s via a timer, replacing any still-visible prior
  indicator.
- Rust: a small `Rect` drawn in the bottom-right corner of the frame for a
  tick-counted duration (matches the existing throbber/indicator timing
  patterns already in `apps/tui-rs`), cleared the same way.
- Text: `"Copied {n} chars"` normally; `"Copied first {n} chars (selection truncated)"`
  when the size cap was hit.

## Testing

- TS: unit test for logical-position resolution against `lastLineMap`
  across a scroll-mid-drag scenario; unit test for the OSC 52 helper
  (tmux-wrapping on/off, truncation at the cap).
- Rust: equivalent unit tests for the logical-position resolver and the
  OSC 52 helper (shared logic, mirrored implementation).
- Manual verification: drag-select in a plain terminal, in tmux, and across
  a scroll event mid-drag; confirm the indicator text and truncation
  message.

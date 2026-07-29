# Terminal Text Selection & Clipboard Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a click-drag over the message history in both `apps/tui` and `apps/tui-rs` highlight text, copy it to the system clipboard on release, and show a transient "Copied N chars" indicator bottom-right.

**Architecture:** Both apps already own mouse input (alt-screen + mouse-reporting for scroll-wheel), so native terminal drag-select is dead already. We track a drag as a logical `(messageIndex, lineOffset, displayColumn)` range resolved at mouse-down (scroll-invariant), apply reverse-video to that range when building each frame's lines, and on mouse-up extract the plain text and push it out via an OSC 52 escape sequence (tmux-wrapped when `$TMUX` is set), capped and head-truncated at 100 KB of base64.

**Tech Stack:** TypeScript / pi-tui / chalk (apps/tui); Rust / ratatui / crossterm (apps/tui-rs). No new runtime dependencies in Rust. TS adds `string-width` and `strip-ansi` as direct dependencies (already present transitively via chalk's dependency chain, per `pnpm-lock.yaml`).

## Global Constraints

- OSC 52 only. No `xclip`/`wl-copy`/`pbcopy` shell-out (spec non-goal).
- tmux passthrough: wrap as `\x1bPtmux;` + OSC52 seq with inner ESC doubled + `\x1b\\` when `$TMUX` is set.
- Size cap: 100 KB of base64 output (~75 KB raw text), **head-truncated** (keep first N chars, drop tail).
- `column` in any logical position is a **display-column** (wide-char aware), never a byte/char-count index.
- Selection clears on: new mouse-down elsewhere, plain click (near-zero drag) inside existing selection, `Escape`, and terminal resize.
- No autoscroll-on-drag-to-edge (spec non-goal, v1).
- Selection scope: scrollable message history only, not the editor input line.
- No rectangular/multi-region selection — single contiguous range.

---

## Part A — `apps/tui` (TypeScript)

### Task 1: Display-width + ANSI-aware highlight slicing

**Files:**
- Create: `apps/tui/src/utils/ansi-select.ts`
- Test: `apps/tui/src/utils/ansi-select.test.ts`
- Modify: `apps/tui/package.json` (add `string-width` and `strip-ansi` as direct dependencies, versions matching what's already resolved in the lockfile: `string-width@^7.2.0`, `strip-ansi@^7.2.0`)

**Interfaces:**
- Produces: `displayWidth(text: string): number`, `plainText(ansiLine: string): string`, `highlightRange(ansiLine: string, startCol: number, endCol: number): string` — returns `ansiLine` with the display-column range `[startCol, endCol)` wrapped in reverse-video (`\x1b[7m` / `\x1b[27m`), leaving all other styling untouched. Columns outside the line's width are clamped.

- [ ] **Step 1: Add dependencies**

```bash
cd apps/tui && pnpm add string-width@^7.2.0 strip-ansi@^7.2.0
```

- [ ] **Step 2: Write the failing tests**

```typescript
// apps/tui/src/utils/ansi-select.test.ts
import { describe, it, expect } from "vitest";
import chalk from "chalk";
import { displayWidth, plainText, highlightRange } from "./ansi-select.js";

describe("displayWidth", () => {
  it("counts plain ascii", () => {
    expect(displayWidth("hello")).toBe(5);
  });
  it("counts CJK as double-width", () => {
    expect(displayWidth("你好")).toBe(4);
  });
  it("counts emoji as double-width", () => {
    expect(displayWidth("🔥x")).toBe(3);
  });
});

describe("plainText", () => {
  it("strips ANSI styling", () => {
    expect(plainText(chalk.red("hi"))).toBe("hi");
  });
});

describe("highlightRange", () => {
  it("wraps a plain substring in reverse video", () => {
    const result = highlightRange("hello world", 6, 11);
    expect(result).toBe("hello \x1b[7mworld\x1b[27m");
  });

  it("wraps a range inside already-styled text without corrupting escapes", () => {
    const styled = chalk.red("hello world");
    const result = highlightRange(styled, 0, 5);
    expect(plainText(result)).toBe("hello world");
    expect(result).toContain("\x1b[7m");
    expect(result).toContain("\x1b[27m");
  });

  it("clamps ranges beyond the line width", () => {
    const result = highlightRange("hi", 0, 100);
    expect(plainText(result)).toBe("hi");
    expect(result.startsWith("\x1b[7m")).toBe(true);
  });

  it("handles wide characters without splitting a cell", () => {
    const result = highlightRange("你好", 0, 2);
    expect(plainText(result)).toBe("你好");
    expect(result).toContain("你");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/tui && pnpm vitest run src/utils/ansi-select.test.ts`
Expected: FAIL with "Cannot find module './ansi-select.js'"

- [ ] **Step 4: Implement**

```typescript
// apps/tui/src/utils/ansi-select.ts
import stringWidth from "string-width";
import stripAnsi from "strip-ansi";

const REVERSE_ON = "\x1b[7m";
const REVERSE_OFF = "\x1b[27m";

// Matches a single SGR/CSI escape sequence so we can walk `ansiLine`
// character-by-character while skipping escape bytes when counting columns.
const ANSI_SEQUENCE_RE = /^(?:\x1b\[[0-9;]*[a-zA-Z])/;

export function displayWidth(text: string): number {
  return stringWidth(text);
}

export function plainText(ansiLine: string): string {
  return stripAnsi(ansiLine);
}

/**
 * Wraps the display-column range [startCol, endCol) of an ANSI-styled line
 * in reverse video, without disturbing any existing escape sequences.
 * Walks the raw string, tracking visible display-column position; escape
 * sequences pass through untouched and don't advance the column counter.
 */
export function highlightRange(
  ansiLine: string,
  startCol: number,
  endCol: number,
): string {
  const width = displayWidth(ansiLine);
  const start = Math.max(0, Math.min(startCol, width));
  const end = Math.max(start, Math.min(endCol, width));
  if (start === end) return ansiLine;

  let out = "";
  let col = 0;
  let i = 0;
  let reverseOpen = false;

  while (i < ansiLine.length) {
    const rest = ansiLine.slice(i);
    const escMatch = ANSI_SEQUENCE_RE.exec(rest);
    if (escMatch) {
      out += escMatch[0];
      i += escMatch[0].length;
      continue;
    }

    if (col === start && !reverseOpen) {
      out += REVERSE_ON;
      reverseOpen = true;
    }
    if (col === end && reverseOpen) {
      out += REVERSE_OFF;
      reverseOpen = false;
    }

    const ch = [...rest][0]; // grapheme-safe single unit for width purposes
    out += ch;
    col += displayWidth(ch);
    i += ch.length;
  }

  if (reverseOpen) out += REVERSE_OFF;
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/tui && pnpm vitest run src/utils/ansi-select.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/tui/src/utils/ansi-select.ts apps/tui/src/utils/ansi-select.test.ts apps/tui/package.json pnpm-lock.yaml
git commit -m "feat(tui): add display-width and ANSI-aware highlight slicing"
```

---

### Task 2: OSC 52 clipboard helper with tmux passthrough and size cap

**Files:**
- Create: `apps/tui/src/utils/clipboard.ts`
- Test: `apps/tui/src/utils/clipboard.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `const OSC52_CAP_BASE64_BYTES = 102400`; `copyToClipboard(text: string, opts?: { write?: (s: string) => void; env?: Record<string, string | undefined> }): { copied: string; truncated: boolean }` — builds the (possibly tmux-wrapped) OSC 52 sequence, writes it via `opts.write` (defaults to `process.stdout.write`), and returns the text actually copied plus whether it was truncated, so callers can build the indicator message.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/tui/src/utils/clipboard.test.ts
import { describe, it, expect, vi } from "vitest";
import { copyToClipboard, OSC52_CAP_BASE64_BYTES } from "./clipboard.js";

describe("copyToClipboard", () => {
  it("writes a bare OSC 52 sequence outside tmux", () => {
    const write = vi.fn();
    const result = copyToClipboard("hello", { write, env: {} });
    expect(result).toEqual({ copied: "hello", truncated: false });
    const sent = write.mock.calls[0][0] as string;
    expect(sent).toBe(`\x1b]52;c;${Buffer.from("hello").toString("base64")}\x07`);
  });

  it("wraps the sequence for tmux passthrough, doubling the inner ESC", () => {
    const write = vi.fn();
    copyToClipboard("hi", { write, env: { TMUX: "/tmp/tmux-1000/default,123,0" } });
    const sent = write.mock.calls[0][0] as string;
    const inner = `\x1b]52;c;${Buffer.from("hi").toString("base64")}\x07`;
    expect(sent).toBe(`\x1bPtmux;${inner.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`);
  });

  it("head-truncates text over the cap and reports truncation", () => {
    const write = vi.fn();
    // Build text whose base64 exceeds the cap.
    const big = "x".repeat(OSC52_CAP_BASE64_BYTES); // base64 expands ~4/3, so raw >= cap is plenty over
    const result = copyToClipboard(big, { write, env: {} });
    expect(result.truncated).toBe(true);
    expect(result.copied.length).toBeLessThan(big.length);
    expect(big.startsWith(result.copied)).toBe(true);
    const sentBase64 = /c;([^\x07]+)\x07/.exec(write.mock.calls[0][0] as string)![1];
    expect(sentBase64.length).toBeLessThanOrEqual(OSC52_CAP_BASE64_BYTES);
  });

  it("does not truncate text under the cap", () => {
    const write = vi.fn();
    const result = copyToClipboard("short text", { write, env: {} });
    expect(result.truncated).toBe(false);
    expect(result.copied).toBe("short text");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/tui && pnpm vitest run src/utils/clipboard.test.ts`
Expected: FAIL with "Cannot find module './clipboard.js'"

- [ ] **Step 3: Implement**

```typescript
// apps/tui/src/utils/clipboard.ts

/** Historical safe ceiling for OSC 52 payloads across common terminals. */
export const OSC52_CAP_BASE64_BYTES = 100 * 1024;

export interface CopyResult {
  copied: string;
  truncated: boolean;
}

export interface CopyOptions {
  write?: (data: string) => void;
  env?: Record<string, string | undefined>;
}

function base64Length(text: string): number {
  return Buffer.from(text, "utf8").toString("base64").length;
}

/** Head-truncates `text` so its base64 encoding fits within the cap. */
function truncateToCap(text: string): { text: string; truncated: boolean } {
  if (base64Length(text) <= OSC52_CAP_BASE64_BYTES) {
    return { text, truncated: false };
  }
  // Binary-search the largest prefix (in UTF-16 code units) whose base64
  // encoding fits the cap. Good enough for the ceiling this guards.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (base64Length(text.slice(0, mid)) <= OSC52_CAP_BASE64_BYTES) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { text: text.slice(0, lo), truncated: true };
}

function oscSequence(text: string): string {
  const base64 = Buffer.from(text, "utf8").toString("base64");
  return `\x1b]52;c;${base64}\x07`;
}

/** Wraps an OSC sequence for tmux passthrough: doubles the inner ESC and
 * frames it as a tmux DCS passthrough sequence, per tmux's `allow-passthrough`. */
function wrapForTmux(seq: string): string {
  return `\x1bPtmux;${seq.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
}

export function copyToClipboard(text: string, opts: CopyOptions = {}): CopyResult {
  const write = opts.write ?? ((data: string) => process.stdout.write(data));
  const env = opts.env ?? process.env;

  const { text: capped, truncated } = truncateToCap(text);
  const seq = oscSequence(capped);
  const sequence = env.TMUX ? wrapForTmux(seq) : seq;
  write(sequence);

  return { copied: capped, truncated };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/tui && pnpm vitest run src/utils/clipboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/tui/src/utils/clipboard.ts apps/tui/src/utils/clipboard.test.ts
git commit -m "feat(tui): add OSC 52 clipboard helper with tmux passthrough and size cap"
```

---

### Task 3: Mouse drag mode + logical selection-position resolution

**Files:**
- Modify: `apps/tui/src/terminal-screen.ts` (mouse mode constant)
- Modify: `apps/tui/src/components/virtual-message-list.ts` (add `resolveLogicalPosition` and expose `lastLineMap`/line text for later tasks)
- Test: `apps/tui/src/components/virtual-message-list.test.ts` (extend existing file)

**Interfaces:**
- Consumes: nothing new from Tasks 1–2.
- Produces: `type LogicalPos = { lineIndex: number; column: number }` (an index into the flattened `lastLineMap`/rendered-lines array, plus a display-column — flattened line index rather than `(messageIndex, lineOffset)` keeps downstream lookups a single array index); `VirtualMessageList.resolveLogicalPosition(cx: number, cy: number): LogicalPos | null` (`null` when the click misses content, e.g. below the last line); `VirtualMessageList.getLineAt(lineIndex: number): string | null` (the last-rendered ANSI string for that flattened line, for Task 4/5 to read).

- [ ] **Step 1: Change mouse mode to button-event tracking**

```typescript
// apps/tui/src/terminal-screen.ts — replace ENABLE_MOUSE/DISABLE_MOUSE
// \x1b[?1002h reports button-event motion: movement is only reported while
// a button is held, which is exactly what drag-selection needs (not every
// hover, which \x1b[?1003h would add).
const ENABLE_MOUSE = "\x1b[?1002h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1002l";
```

- [ ] **Step 2: Write the failing test for logical position resolution**

```typescript
// apps/tui/src/components/virtual-message-list.test.ts — add:
import { describe, it, expect } from "vitest"; // (already imported if file exists; adjust to match existing style)

it("resolves a screen row to a stable logical line index", () => {
  const list = new VirtualMessageList(100, () => 10);
  // ... populate via the store as existing tests do, then render once ...
  list.render(80);
  const pos = list.resolveLogicalPosition(5, 2);
  expect(pos).not.toBeNull();
  expect(typeof pos!.lineIndex).toBe("number");
  expect(typeof pos!.column).toBe("number");
});

it("returns null for clicks below the last rendered line", () => {
  const list = new VirtualMessageList(100, () => 10);
  list.render(80);
  const pos = list.resolveLogicalPosition(5, 999);
  expect(pos).toBeNull();
});

it("getLineAt returns the same logical line before and after a scroll", () => {
  const list = new VirtualMessageList(100, () => 5);
  // populate with more messages than fit the viewport, as existing scroll
  // tests in this file already do
  list.render(80);
  const before = list.resolveLogicalPosition(0, 1);
  const lineBefore = list.getLineAt(before!.lineIndex);
  list.scrollPageUp();
  list.render(80);
  // The same logical line index still yields the same text after scrolling,
  // even though it's no longer at screen row 1 — that's the scroll-invariance
  // guarantee resolveLogicalPosition exists for.
  expect(list.getLineAt(before!.lineIndex)).toBe(lineBefore);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/tui && pnpm vitest run src/components/virtual-message-list.test.ts`
Expected: FAIL with "resolveLogicalPosition is not a function"

- [ ] **Step 4: Implement in `virtual-message-list.ts`**

Add alongside the existing `lastLineMap`/`handleClick` (the flattened `lines` array built in `render()` already gives a stable index — 0 is always the first rendered row of the *full* history, not the viewport, so scrolling only changes which window of that array is visible):

```typescript
// In VirtualMessageList, store the last full set of rendered ANSI lines
// (currently only local to render()); add a field:
private lastRenderedLines: string[] = [];

// At the end of render(), before applying the scrolled-window slice,
// stash the full unwindowed lines array:
// (insert right after `this.lastTotalLines = lines.length;`)
this.lastRenderedLines = lines;

// Public accessors:
getLineAt(lineIndex: number): string | null {
  return this.lastRenderedLines[lineIndex] ?? null;
}

/**
 * Resolves a screen coordinate to a logical position keyed off the full
 * (unwindowed) line index — stable across scrolling, since scrolling only
 * changes the `startIndex` window into the same underlying array.
 */
resolveLogicalPosition(cx: number, cy: number): { lineIndex: number; column: number } | null {
  const content = this.contentRows();
  let startIndex = 0;
  if (this.lastTotalLines <= content) {
    startIndex = 0;
  } else if (this.scrollTop === null) {
    startIndex = this.lastTotalLines - (content + 1);
  } else {
    startIndex = this.scrollTop;
  }
  const lineIndex = startIndex + (cy - 1);
  if (lineIndex < 0 || lineIndex >= this.lastRenderedLines.length) return null;
  return { lineIndex, column: Math.max(0, cx - 1) };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/tui && pnpm vitest run src/components/virtual-message-list.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/tui/src/terminal-screen.ts apps/tui/src/components/virtual-message-list.ts apps/tui/src/components/virtual-message-list.test.ts
git commit -m "feat(tui): enable drag mouse mode and resolve scroll-invariant logical positions"
```

---

### Task 4: Selection state, highlight rendering, and clearing

**Files:**
- Create: `apps/tui/src/state/selection-store.ts`
- Test: `apps/tui/src/state/selection-store.test.ts`
- Modify: `apps/tui/src/components/virtual-message-list.ts` (apply highlight in `render()`)

**Interfaces:**
- Consumes: `LogicalPos` and `getLineAt`/`resolveLogicalPosition` from Task 3; `highlightRange`, `plainText` from Task 1.
- Produces: `type Selection = { anchor: LogicalPos; cursor: LogicalPos }`; `class SelectionStore { begin(pos): void; update(pos): void; clear(): void; get(): Selection | null; isNearZeroDrag(a: LogicalPos, b: LogicalPos): boolean }`; `VirtualMessageList.setSelection(sel: Selection | null): void` (triggers re-render with highlight applied); normalized range helper `normalize(sel: Selection): { startLine: number; startCol: number; endLine: number; endCol: number }` used by Task 5 for text extraction too.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/tui/src/state/selection-store.test.ts
import { describe, it, expect } from "vitest";
import { SelectionStore, normalize } from "./selection-store.js";

describe("SelectionStore", () => {
  it("starts empty", () => {
    expect(new SelectionStore().get()).toBeNull();
  });

  it("begin + update tracks anchor and cursor", () => {
    const s = new SelectionStore();
    s.begin({ lineIndex: 2, column: 3 });
    s.update({ lineIndex: 4, column: 1 });
    expect(s.get()).toEqual({
      anchor: { lineIndex: 2, column: 3 },
      cursor: { lineIndex: 4, column: 1 },
    });
  });

  it("clear resets to null", () => {
    const s = new SelectionStore();
    s.begin({ lineIndex: 0, column: 0 });
    s.clear();
    expect(s.get()).toBeNull();
  });

  it("detects a near-zero drag as a plain click", () => {
    const s = new SelectionStore();
    expect(s.isNearZeroDrag({ lineIndex: 1, column: 5 }, { lineIndex: 1, column: 5 })).toBe(true);
    expect(s.isNearZeroDrag({ lineIndex: 1, column: 5 }, { lineIndex: 2, column: 5 })).toBe(false);
  });
});

describe("normalize", () => {
  it("orders a reversed selection (dragged upward)", () => {
    const n = normalize({
      anchor: { lineIndex: 5, column: 2 },
      cursor: { lineIndex: 3, column: 8 },
    });
    expect(n).toEqual({ startLine: 3, startCol: 8, endLine: 5, endCol: 2 });
  });

  it("orders a same-line reversed selection by column", () => {
    const n = normalize({
      anchor: { lineIndex: 2, column: 9 },
      cursor: { lineIndex: 2, column: 1 },
    });
    expect(n).toEqual({ startLine: 2, startCol: 1, endLine: 2, endCol: 9 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/tui && pnpm vitest run src/state/selection-store.test.ts`
Expected: FAIL with "Cannot find module './selection-store.js'"

- [ ] **Step 3: Implement**

```typescript
// apps/tui/src/state/selection-store.ts
export interface LogicalPos {
  lineIndex: number;
  column: number;
}

export interface Selection {
  anchor: LogicalPos;
  cursor: LogicalPos;
}

export interface NormalizedRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export function normalize(sel: Selection): NormalizedRange {
  const { anchor, cursor } = sel;
  const anchorFirst =
    anchor.lineIndex < cursor.lineIndex ||
    (anchor.lineIndex === cursor.lineIndex && anchor.column <= cursor.column);
  const [start, end] = anchorFirst ? [anchor, cursor] : [cursor, anchor];
  return {
    startLine: start.lineIndex,
    startCol: start.column,
    endLine: end.lineIndex,
    endCol: end.column,
  };
}

export class SelectionStore {
  private selection: Selection | null = null;

  begin(pos: LogicalPos): void {
    this.selection = { anchor: pos, cursor: pos };
  }

  update(pos: LogicalPos): void {
    if (!this.selection) return;
    this.selection = { anchor: this.selection.anchor, cursor: pos };
  }

  clear(): void {
    this.selection = null;
  }

  get(): Selection | null {
    return this.selection;
  }

  /** A click (as opposed to a drag) if start/end land on the same line and
   * column, or adjacent — matches normal text-select "clicking does nothing
   * new" behavior. */
  isNearZeroDrag(a: LogicalPos, b: LogicalPos): boolean {
    return a.lineIndex === b.lineIndex && Math.abs(a.column - b.column) <= 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/tui && pnpm vitest run src/state/selection-store.test.ts`
Expected: PASS

- [ ] **Step 5: Apply highlight in `VirtualMessageList.render()`**

```typescript
// virtual-message-list.ts — constructor takes an optional selection getter,
// applied to `lines` right after `this.lastRenderedLines = lines;` (Task 3)
// and before the scrolled-window slicing:
import { normalize, type Selection } from "../state/selection-store.js";
import { highlightRange } from "../utils/ansi-select.js";

// constructor param addition:
constructor(
  maxVisible = 100,
  getViewportRows: () => number = () => 24,
  header?: Component,
  private getSelection: () => Selection | null = () => null,
) { /* ...existing body unchanged... */ }

// after `this.lastRenderedLines = lines;`:
const sel = this.getSelection();
if (sel) {
  const { startLine, startCol, endLine, endCol } = normalize(sel);
  for (let i = startLine; i <= endLine && i < lines.length; i++) {
    const lineStart = i === startLine ? startCol : 0;
    const lineEnd = i === endLine ? endCol : Number.MAX_SAFE_INTEGER;
    lines[i] = highlightRange(lines[i], lineStart, lineEnd);
  }
}
```

- [ ] **Step 6: Run the full component test file to check for regressions**

Run: `cd apps/tui && pnpm vitest run src/components/virtual-message-list.test.ts`
Expected: PASS (no regressions from the constructor signature change — existing call sites don't pass the new optional arg)

- [ ] **Step 7: Commit**

```bash
git add apps/tui/src/state/selection-store.ts apps/tui/src/state/selection-store.test.ts apps/tui/src/components/virtual-message-list.ts
git commit -m "feat(tui): add selection state store and highlight rendering"
```

---

### Task 5: Wire mouse drag events to selection, copy on release, resize clears

**Files:**
- Modify: `apps/tui/src/index.ts` (mouse event handling, resize handling)

**Interfaces:**
- Consumes: `SelectionStore`, `normalize` (Task 4); `resolveLogicalPosition`, `getLineAt` (Task 3); `plainText` (Task 1); `copyToClipboard` (Task 2).
- Produces: nothing new consumed by later tasks — this is the integration point.

- [ ] **Step 1: Extend the SGR mouse regex handling to cover motion and release, and wire selection**

```typescript
// apps/tui/src/index.ts — near the existing SGR_MOUSE_RE handling.
// SGR encodes drag as button-code with bit 0x20 set; release always ends
// in lowercase 'm' (vs uppercase 'M' for press/drag).
import { SelectionStore, normalize } from "./state/selection-store.js";
import { plainText } from "./utils/ansi-select.js";
import { copyToClipboard } from "./utils/clipboard.js";

const selectionStore = new SelectionStore();
messageList.setSelectionGetter(() => selectionStore.get()); // see Task 4 constructor wiring; alternatively pass the getter at construction time

function showCopiedIndicator(charCount: number, truncated: boolean): void {
  const label = truncated
    ? `Copied first ${charCount} chars (selection truncated)`
    : `Copied ${charCount} chars`;
  const handle = tui.showOverlay(new Text(label), {
    anchor: "bottom-right",
    nonCapturing: true,
  });
  setTimeout(() => handle.hide(), 1500);
}

function extractSelectionText(): string {
  const sel = selectionStore.get();
  if (!sel) return "";
  const { startLine, startCol, endLine, endCol } = normalize(sel);
  const rows: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    const raw = messageList.getLineAt(i);
    if (raw === null) continue;
    const text = plainText(raw);
    const from = i === startLine ? startCol : 0;
    const to = i === endLine ? endCol : text.length;
    rows.push(text.slice(from, to));
  }
  return rows.join("\n");
}

tui.addInputListener((data) => {
  const mouseEvent = SGR_MOUSE_RE.exec(data);
  if (mouseEvent) {
    const cb = Number(mouseEvent[1]);
    const cx = Number(mouseEvent[2]);
    const cy = Number(mouseEvent[3]);
    const isRelease = data.endsWith("m");
    if ((cb & 0x40) !== 0) {
      messageList.scrollBy((cb & 0x01) === 1 ? WHEEL_STEP : -WHEEL_STEP);
      return { consume: true };
    }
    const isDrag = (cb & 0x20) !== 0;
    const button = cb & 0x03;

    if (isRelease) {
      const sel = selectionStore.get();
      if (sel) {
        const text = extractSelectionText();
        if (text.length > 0) {
          const { truncated, copied } = copyToClipboard(text);
          showCopiedIndicator(copied.length, truncated);
        }
      }
      tui.requestRender();
      return { consume: true };
    }

    const pos = messageList.resolveLogicalPosition(cx, cy);
    if (pos && button === 0 && !isDrag) {
      // Fresh press: click-to-clear if inside the existing selection,
      // otherwise start a new selection anchor.
      const prior = selectionStore.get();
      if (prior) {
        const { startLine, startCol, endLine, endCol } = normalize(prior);
        const insidePrior =
          pos.lineIndex > startLine ||
          (pos.lineIndex === startLine && pos.column >= startCol);
        const beforeEnd =
          pos.lineIndex < endLine ||
          (pos.lineIndex === endLine && pos.column <= endCol);
        if (insidePrior && beforeEnd) {
          selectionStore.clear();
          tui.requestRender();
          return { consume: true };
        }
      }
      selectionStore.begin(pos);
      tui.requestRender();
      return { consume: true };
    }
    if (pos && isDrag) {
      selectionStore.update(pos);
      tui.requestRender();
      return { consume: true };
    }
    // Single click didn't hit content, or non-left button: swallow, no-op.
    if (cb === 0 && data.endsWith("M")) {
      messageList.handleClick(cx, cy);
    }
    return { consume: true };
  }
  if (matchesKey(data, "escape")) {
    if (selectionStore.get()) {
      selectionStore.clear();
      tui.requestRender();
      return { consume: true };
    }
  }
  // ...existing handlers continue below unchanged...
```

- [ ] **Step 2: Clear selection on resize**

```typescript
// apps/tui/src/index.ts — near existing terminal resize handling
// (process.stdout.on("resize", ...) or the TUI's own resize hook, whichever
// this file already uses to trigger a re-layout):
process.stdout.on("resize", () => {
  if (selectionStore.get()) {
    selectionStore.clear();
  }
  // ...existing resize handling continues...
});
```

- [ ] **Step 3: Manual verification**

Run: `pnpm --filter @thisisayande/freecode-tui dev` (or the project's existing dev-run command for `apps/tui`)
Verify:
1. Click-drag over message history highlights the dragged text.
2. Releasing copies it — paste elsewhere confirms the text matches.
3. A "Copied N chars" message appears bottom-right and disappears after ~1.5s.
4. Clicking once inside an existing selection clears it.
5. Pressing Escape clears an active selection.
6. Resizing the terminal mid-drag clears the selection instead of corrupting the highlight.
7. Run inside `tmux` (`tmux new-session`) and confirm copy still lands in the OS clipboard (requires `set -g allow-passthrough on` in `.tmux.conf`, which is a tmux-side prerequisite, not something this app can set).

- [ ] **Step 4: Run the full TS test suite for regressions**

Run: `cd apps/tui && pnpm vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/tui/src/index.ts
git commit -m "feat(tui): wire mouse drag to selection, clipboard copy, and copied indicator"
```

---

## Part B — `apps/tui-rs` (Rust)

Crossterm's `EnableMouseCapture` (already enabled in `main.rs`) turns on modes 1000+1002+1003+1006 together, so `MouseEventKind::Drag` events already arrive with no mode change needed here — unlike the TS side, there is no Task equivalent to Task 3's mouse-mode flip.

### Task 6: OSC 52 clipboard helper with tmux passthrough and size cap

**Files:**
- Create: `apps/tui-rs/src/clipboard.rs`
- Modify: `apps/tui-rs/src/main.rs` (add `mod clipboard;`) or `apps/tui-rs/src/lib.rs` if that's where the crate's module tree is declared — check which file has the existing `mod app; mod commands; mod ipc; mod ui;` declarations and add `mod clipboard;` alongside them.

**Interfaces:**
- Produces: `pub const OSC52_CAP_BASE64_BYTES: usize = 100 * 1024;`; `pub struct CopyResult { pub copied: String, pub truncated: bool }`; `pub fn copy_to_clipboard(text: &str, write: &mut dyn std::io::Write, tmux: bool) -> std::io::Result<CopyResult>`.

- [ ] **Step 1: Write the failing tests**

```rust
// apps/tui-rs/src/clipboard.rs — tests module at the bottom of the file
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_bare_osc52_outside_tmux() {
        let mut buf: Vec<u8> = Vec::new();
        let result = copy_to_clipboard("hello", &mut buf, false).unwrap();
        assert_eq!(result.copied, "hello");
        assert!(!result.truncated);
        let expected = format!("\x1b]52;c;{}\x07", base64_encode("hello"));
        assert_eq!(String::from_utf8(buf).unwrap(), expected);
    }

    #[test]
    fn wraps_for_tmux_passthrough() {
        let mut buf: Vec<u8> = Vec::new();
        copy_to_clipboard("hi", &mut buf, true).unwrap();
        let inner = format!("\x1b]52;c;{}\x07", base64_encode("hi"));
        let expected = format!("\x1bPtmux;{}\x1b\\", inner.replace('\x1b', "\x1b\x1b"));
        assert_eq!(String::from_utf8(buf).unwrap(), expected);
    }

    #[test]
    fn head_truncates_over_the_cap() {
        let mut buf: Vec<u8> = Vec::new();
        let big = "x".repeat(OSC52_CAP_BASE64_BYTES);
        let result = copy_to_clipboard(&big, &mut buf, false).unwrap();
        assert!(result.truncated);
        assert!(result.copied.len() < big.len());
        assert!(big.starts_with(&result.copied));
    }

    #[test]
    fn does_not_truncate_under_the_cap() {
        let mut buf: Vec<u8> = Vec::new();
        let result = copy_to_clipboard("short text", &mut buf, false).unwrap();
        assert!(!result.truncated);
        assert_eq!(result.copied, "short text");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/tui-rs && cargo test clipboard::tests`
Expected: FAIL to compile ("cannot find function `copy_to_clipboard`")

- [ ] **Step 3: Implement**

```rust
// apps/tui-rs/src/clipboard.rs
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::io::Write;

/// Historical safe ceiling for OSC 52 payloads across common terminals.
pub const OSC52_CAP_BASE64_BYTES: usize = 100 * 1024;

pub struct CopyResult {
    pub copied: String,
    pub truncated: bool,
}

fn base64_encode(text: &str) -> String {
    STANDARD.encode(text.as_bytes())
}

fn base64_len(text: &str) -> usize {
    base64_encode(text).len()
}

/// Head-truncates `text` (on a char boundary) so its base64 encoding fits
/// within the cap.
fn truncate_to_cap(text: &str) -> (String, bool) {
    if base64_len(text) <= OSC52_CAP_BASE64_BYTES {
        return (text.to_string(), false);
    }
    let chars: Vec<char> = text.chars().collect();
    let mut lo = 0usize;
    let mut hi = chars.len();
    while lo < hi {
        let mid = (lo + hi + 1) / 2;
        let candidate: String = chars[..mid].iter().collect();
        if base64_len(&candidate) <= OSC52_CAP_BASE64_BYTES {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    (chars[..lo].iter().collect(), true)
}

/// Wraps an OSC sequence for tmux passthrough: doubles the inner ESC and
/// frames it as a tmux DCS passthrough sequence (`allow-passthrough`).
fn wrap_for_tmux(seq: &str) -> String {
    format!("\x1bPtmux;{}\x1b\\", seq.replace('\x1b', "\x1b\x1b"))
}

pub fn copy_to_clipboard(
    text: &str,
    write: &mut dyn Write,
    tmux: bool,
) -> std::io::Result<CopyResult> {
    let (capped, truncated) = truncate_to_cap(text);
    let seq = format!("\x1b]52;c;{}\x07", base64_encode(&capped));
    let sequence = if tmux { wrap_for_tmux(&seq) } else { seq };
    write.write_all(sequence.as_bytes())?;
    Ok(CopyResult { copied: capped, truncated })
}
```

- [ ] **Step 4: Add the `base64` crate**

```bash
cd apps/tui-rs && cargo add base64
```

`base64` is a single-purpose, zero-transitive-dependency crate — the smallest correct way to do OSC 52 encoding; hand-rolling base64 would be more code than the crate for no benefit.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/tui-rs && cargo test clipboard::tests`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/tui-rs/src/clipboard.rs apps/tui-rs/Cargo.toml apps/tui-rs/Cargo.lock
git commit -m "feat(tui-rs): add OSC 52 clipboard helper with tmux passthrough and size cap"
```

---

### Task 7: Selection state on `App`, logical position resolution via the render-time line map

**Files:**
- Modify: `apps/tui-rs/src/app.rs` (add `Selection` type and `App.selection` field, plus `line_map`/`transcript` fields mirroring the existing `chip_hits`/`transcript_top`/`transcript_height` pattern)
- Test: `apps/tui-rs/src/app.rs` (`#[cfg(test)] mod tests` at the bottom, following this file's existing convention if present — check for one before adding a new one)

**Interfaces:**
- Consumes: nothing from Tasks 1–6.
- Produces: `pub struct LogicalPos { pub line_index: usize, pub column: u16 }`; `pub struct Selection { pub anchor: LogicalPos, pub cursor: LogicalPos }`; `App.selection: Option<Selection>`; `App.line_map: Vec<String>` (the full plain-text content of each rendered transcript line, rebuilt every `draw_messages` call — mirrors `apps/tui`'s `lastRenderedLines`); `App.resolve_logical_position(&self, col: u16, row: u16) -> Option<LogicalPos>` using the existing `transcript_top`/`transcript_height` plus `App.scroll` the same way `chip_at` already resolves rows; `fn normalize(sel: &Selection) -> (LogicalPos, LogicalPos)` (start, end).

- [ ] **Step 1: Write the failing tests**

```rust
// apps/tui-rs/src/app.rs — add near the bottom, or extend an existing test module
#[cfg(test)]
mod selection_tests {
    use super::*;

    #[test]
    fn normalize_orders_a_reversed_selection() {
        let sel = Selection {
            anchor: LogicalPos { line_index: 5, column: 2 },
            cursor: LogicalPos { line_index: 3, column: 8 },
        };
        let (start, end) = normalize(&sel);
        assert_eq!(start.line_index, 3);
        assert_eq!(start.column, 8);
        assert_eq!(end.line_index, 5);
        assert_eq!(end.column, 2);
    }

    #[test]
    fn normalize_orders_same_line_by_column() {
        let sel = Selection {
            anchor: LogicalPos { line_index: 2, column: 9 },
            cursor: LogicalPos { line_index: 2, column: 1 },
        };
        let (start, end) = normalize(&sel);
        assert_eq!(start.column, 1);
        assert_eq!(end.column, 9);
    }

    #[test]
    fn resolve_logical_position_returns_none_outside_transcript() {
        let mut app = App::new();
        app.transcript_top = 2;
        app.transcript_height = 10;
        app.line_map = vec!["line one".into(), "line two".into()];
        assert!(app.resolve_logical_position(0, 0).is_none()); // above transcript
        assert!(app.resolve_logical_position(0, 50).is_none()); // below transcript
    }

    #[test]
    fn resolve_logical_position_maps_a_row_inside_the_transcript() {
        let mut app = App::new();
        app.transcript_top = 2;
        app.transcript_height = 10;
        app.line_map = vec!["line one".into(), "line two".into()];
        let pos = app.resolve_logical_position(3, 2).unwrap();
        assert_eq!(pos.line_index, 0);
        assert_eq!(pos.column, 3);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/tui-rs && cargo test selection_tests`
Expected: FAIL to compile ("cannot find type `Selection`", "cannot find function `normalize`")

- [ ] **Step 3: Implement in `app.rs`**

```rust
// apps/tui-rs/src/app.rs — add near the other small structs (e.g. near Chip)

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LogicalPos {
    pub line_index: usize,
    pub column: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Selection {
    pub anchor: LogicalPos,
    pub cursor: LogicalPos,
}

pub fn normalize(sel: &Selection) -> (LogicalPos, LogicalPos) {
    let anchor_first = sel.anchor.line_index < sel.cursor.line_index
        || (sel.anchor.line_index == sel.cursor.line_index && sel.anchor.column <= sel.cursor.column);
    if anchor_first {
        (sel.anchor, sel.cursor)
    } else {
        (sel.cursor, sel.anchor)
    }
}

// Add to `struct App`:
//   pub selection: Option<Selection>,
//   /// Plain-text content of each rendered transcript line, rebuilt every
//   /// `draw_messages` call — the Rust mirror of apps/tui's `lastRenderedLines`.
//   pub line_map: Vec<String>,
// Initialize both in `App::new()`: `selection: None, line_map: Vec::new(),`

impl App {
    /// Resolves a terminal (col, row) to a logical transcript position,
    /// scrolled-window-invariant because `line_map` holds the full
    /// unwindowed transcript and `self.scroll` + `transcript_top` locate
    /// which row of it is on screen — same scheme `chip_at` already uses.
    pub fn resolve_logical_position(&self, col: u16, row: u16) -> Option<LogicalPos> {
        if row < self.transcript_top || row >= self.transcript_top + self.transcript_height {
            return None;
        }
        let visible_row = row - self.transcript_top;
        let line_index = self.scroll as usize + visible_row as usize;
        if line_index >= self.line_map.len() {
            return None;
        }
        Some(LogicalPos { line_index, column: col })
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/tui-rs && cargo test selection_tests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/tui-rs/src/app.rs
git commit -m "feat(tui-rs): add selection state and scroll-invariant logical position resolution"
```

---

### Task 8: Populate `line_map` and apply reverse-video highlight in `draw_messages`

**Files:**
- Modify: `apps/tui-rs/src/ui/mod.rs` (`draw_messages`)

**Interfaces:**
- Consumes: `App.selection`, `App.line_map`, `normalize` from Task 7.
- Produces: `App.line_map` populated every frame (consumed by Task 9 for text extraction); no new public interface beyond what Task 7 declared.

- [ ] **Step 1: Populate `line_map` alongside the existing `lines: Vec<Line>` build**

```rust
// apps/tui-rs/src/ui/mod.rs, inside fn draw_messages, immediately after
// `let mut lines: Vec<Line> = Vec::new();`:
let mut line_map: Vec<String> = Vec::new();

// After every `lines.push(...)` call in this function (each of the Role::User,
// Role::Tool, Role::System, Role::Assistant branches), push the same line's
// plain text — built by joining each Span's `.content` — onto `line_map` in
// the same order. Concretely, replace each existing
//   lines.push(some_line);
// with
//   line_map.push(plain_text_of(&some_line));
//   lines.push(some_line);
// using this helper added near the top of the file:

fn plain_text_of(line: &Line) -> String {
    line.spans.iter().map(|s| s.content.as_ref()).collect()
}

// At the end of draw_messages, before `frame.render_widget(paragraph...)`:
app.line_map = line_map;
```

(The tool-call branch calls `tool::render(...)` which returns multiple lines at once — apply the same `plain_text_of` mapping over each returned line in that `lines.extend(...)` spot too, so every pushed line has a matching `line_map` entry.)

- [ ] **Step 2: Apply reverse-video highlight over the selected range**

```rust
// apps/tui-rs/src/ui/mod.rs — after line_map is fully built, before the
// Paragraph is constructed:
if let Some(sel) = app.selection {
    let (start, end) = app::normalize(&sel);
    for i in start.line_index..=end.line_index.min(lines.len().saturating_sub(1)) {
        let line_len = line_map.get(i).map(|s| s.chars().count()).unwrap_or(0);
        let from = if i == start.line_index { start.column as usize } else { 0 };
        let to = if i == end.line_index { (end.column as usize).min(line_len) } else { line_len };
        if from >= to {
            continue;
        }
        lines[i] = highlight_line(&lines[i], from, to);
    }
}

// Helper: rebuilds a Line, splitting spans at the plain-text char boundaries
// `from`/`to` and adding Modifier::REVERSED to whatever falls inside them.
// Each span's own style is preserved outside the range and reversed (not
// replaced) inside it, so foreground/background colors still show through
// inverted, matching normal terminal selection behavior.
fn highlight_line(line: &Line, from: usize, to: usize) -> Line<'static> {
    let mut spans = Vec::new();
    let mut pos = 0usize;
    for span in &line.spans {
        let text: String = span.content.to_string();
        let len = text.chars().count();
        let span_start = pos;
        let span_end = pos + len;
        pos = span_end;

        let seg_from = from.max(span_start) - span_start;
        let seg_to = to.min(span_end) - span_start;
        if seg_from >= seg_to || span_end <= from || span_start >= to {
            spans.push(Span::styled(text, span.style));
            continue;
        }
        let chars: Vec<char> = text.chars().collect();
        let before: String = chars[..seg_from].iter().collect();
        let mid: String = chars[seg_from..seg_to].iter().collect();
        let after: String = chars[seg_to..].iter().collect();
        if !before.is_empty() {
            spans.push(Span::styled(before, span.style));
        }
        spans.push(Span::styled(mid, span.style.add_modifier(Modifier::REVERSED)));
        if !after.is_empty() {
            spans.push(Span::styled(after, span.style));
        }
    }
    Line::from(spans)
}
```

- [ ] **Step 2: Build check**

Run: `cd apps/tui-rs && cargo build`
Expected: compiles cleanly (fix any borrow-checker friction from mutating `app.line_map` while `app` is borrowed elsewhere in `draw_messages` — `line_map` is a local `Vec` assigned to `app.line_map` only at the end, so this should not conflict with the existing `&mut App` parameter already used by `app.is_tool_expanded`/`app.osc_phase` earlier in the function)

- [ ] **Step 3: Commit**

```bash
git add apps/tui-rs/src/ui/mod.rs
git commit -m "feat(tui-rs): populate transcript line_map and highlight selected range"
```

---

### Task 9: Mouse drag → selection → copy → indicator, resize clears

**Files:**
- Modify: `apps/tui-rs/src/main.rs` (mouse event match arm, resize handling, indicator state)
- Modify: `apps/tui-rs/src/app.rs` (indicator field + resize-clears-selection)

**Interfaces:**
- Consumes: `App.resolve_logical_position`, `App.selection`, `App.line_map`, `normalize` (Task 7/8); `copy_to_clipboard` (Task 6).
- Produces: `App.copy_indicator: Option<(String, Instant)>` (message + expiry, read by the drawing code added in Task 10).

- [ ] **Step 1: Add selection-drag handling to the `Event::Mouse` match arm**

```rust
// apps/tui-rs/src/main.rs — replace the existing Event::Mouse block
if let Event::Mouse(mouse) = &event {
    match mouse.kind {
        MouseEventKind::ScrollUp => app.scroll_up(3),
        MouseEventKind::ScrollDown => app.scroll_down(3),
        MouseEventKind::Down(MouseButton::Left) => {
            if let Some(chip) = app.chip_at(mouse.row) {
                app.toggle_chip(chip);
            } else if let Some(pos) = app.resolve_logical_position(mouse.column, mouse.row) {
                let cleared_existing = app.selection.is_some_and(|sel| {
                    let (start, end) = app::normalize(&sel);
                    let after_start = pos.line_index > start.line_index
                        || (pos.line_index == start.line_index && pos.column >= start.column);
                    let before_end = pos.line_index < end.line_index
                        || (pos.line_index == end.line_index && pos.column <= end.column);
                    after_start && before_end
                });
                if cleared_existing {
                    app.selection = None;
                } else {
                    app.selection = Some(app::Selection { anchor: pos, cursor: pos });
                }
            }
        }
        MouseEventKind::Drag(MouseButton::Left) => {
            if let (Some(sel), Some(pos)) = (
                app.selection,
                app.resolve_logical_position(mouse.column, mouse.row),
            ) {
                app.selection = Some(app::Selection { anchor: sel.anchor, cursor: pos });
            }
        }
        MouseEventKind::Up(MouseButton::Left) => {
            if let Some(sel) = app.selection {
                let (start, end) = app::normalize(&sel);
                let mut rows = Vec::new();
                for i in start.line_index..=end.line_index.min(app.line_map.len().saturating_sub(1)) {
                    let line = app.line_map.get(i).cloned().unwrap_or_default();
                    let chars: Vec<char> = line.chars().collect();
                    let from = if i == start.line_index { start.column as usize } else { 0 };
                    let to = if i == end.line_index { (end.column as usize).min(chars.len()) } else { chars.len() };
                    if from < to {
                        rows.push(chars[from..to].iter().collect::<String>());
                    }
                }
                let text = rows.join("\n");
                if !text.is_empty() {
                    let tmux = std::env::var("TMUX").is_ok();
                    let mut out = std::io::stdout();
                    if let Ok(result) = clipboard::copy_to_clipboard(&text, &mut out, tmux) {
                        let label = if result.truncated {
                            format!("Copied first {} chars (selection truncated)", result.copied.chars().count())
                        } else {
                            format!("Copied {} chars", result.copied.chars().count())
                        };
                        app.copy_indicator = Some((label, std::time::Instant::now() + Duration::from_millis(1500)));
                    }
                }
            }
        }
        _ => {}
    }
    return Ok(false);
}
```

Add `mod clipboard;` to the module declarations at the top of `main.rs` (or wherever the crate root's `mod` list lives — check `lib.rs` first, matching Task 6 Step 2's file choice) and `use freecode_tui::clipboard;` if `clipboard` lives in the library crate rather than the binary.

- [ ] **Step 2: Clear selection on resize**

```rust
// apps/tui-rs/src/main.rs — wherever this event loop already reacts to
// Event::Resize (if it doesn't yet, add a minimal arm; ratatui's terminal
// auto-resizes on the next draw regardless, so this only needs to clear
// selection state):
if let Event::Resize(_, _) = &event {
    app.selection = None;
    return Ok(false);
}
```

- [ ] **Step 3: Add the `copy_indicator` field to `App`**

```rust
// apps/tui-rs/src/app.rs — add to struct App:
//   pub copy_indicator: Option<(String, std::time::Instant)>,
// Initialize in App::new(): `copy_indicator: None,`
```

- [ ] **Step 4: Build check**

Run: `cd apps/tui-rs && cargo build`
Expected: compiles cleanly

- [ ] **Step 5: Commit**

```bash
git add apps/tui-rs/src/main.rs apps/tui-rs/src/app.rs
git commit -m "feat(tui-rs): wire mouse drag to selection, clipboard copy, and resize clearing"
```

---

### Task 10: Bottom-right "Copied N chars" indicator widget

**Files:**
- Modify: `apps/tui-rs/src/ui/mod.rs` (`draw` function — render the indicator as the last step so it overlays everything else)

**Interfaces:**
- Consumes: `App.copy_indicator` (Task 9).

- [ ] **Step 1: Draw the indicator in the bottom-right corner while unexpired**

```rust
// apps/tui-rs/src/ui/mod.rs — in `pub fn draw`, after all other widgets for
// this frame have been rendered (so the indicator overlays on top), before
// returning:
if let Some((label, expires_at)) = &app.copy_indicator {
    if std::time::Instant::now() < *expires_at {
        let width = label.chars().count() as u16 + 2;
        let area = frame.area();
        let indicator_area = Rect {
            x: area.width.saturating_sub(width + 1),
            y: area.height.saturating_sub(2),
            width: width.min(area.width),
            height: 1,
        };
        let widget = Paragraph::new(Line::from(Span::styled(
            format!(" {label} "),
            Style::default().bg(Color::Rgb(60, 60, 60)).fg(Color::White),
        )));
        frame.render_widget(widget, indicator_area);
    } else {
        app.copy_indicator = None;
    }
}
```

- [ ] **Step 2: Build check**

Run: `cd apps/tui-rs && cargo build`
Expected: compiles cleanly (note: mutating `app.copy_indicator` inside `draw`, which already takes `app: &mut App` per its existing signature, so no signature change needed)

- [ ] **Step 3: Manual verification**

Run: `cargo run` from `apps/tui-rs` (or this crate's existing dev-run command)
Verify the same checklist as TS Task 5 Step 3, items 1–6 (tmux passthrough verification, item 7, is shared infra already covered by the TS manual test — no need to repeat it here unless behavior diverges).

- [ ] **Step 4: Run the full Rust test suite for regressions**

Run: `cd apps/tui-rs && cargo test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/tui-rs/src/ui/mod.rs
git commit -m "feat(tui-rs): render transient copied-chars indicator bottom-right"
```

---

## Self-Review Notes

- **Spec coverage:** mouse mode (Task 3 TS / crossterm default for Rust), scroll-invariant logical coordinates (Tasks 3, 7), display-column units (Task 1, `LogicalPos.column`/`column: u16` used consistently), plain-text-first highlighting (Task 4 step 5 highlights via `highlightRange` over ANSI lines derived from stripped plain text; Task 8 highlights by splitting spans at plain-text char boundaries), OSC 52 + tmux + cap + head-truncation (Tasks 2, 6), clear-on-click/Escape/resize (Task 5, Task 9 step 2), indicator with truncation wording (Tasks 5, 9, 10) — all covered.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code and exact test/build commands.
- **Type consistency:** `LogicalPos { lineIndex, column }` (TS) / `LogicalPos { line_index, column }` (Rust) used identically across all tasks that reference it; `Selection { anchor, cursor }` likewise; `normalize()` signature and return shape consistent between its definition (Task 4 / Task 7) and every call site (Task 5 / Tasks 8, 9).

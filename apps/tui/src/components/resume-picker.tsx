// =============================================================================
// Resume Picker — two-pane modal with tabbed session sources.
//
// Left pane: list of sessions (most-recent first). Right pane: markdown
// transcript preview of the highlighted session. The list+preview is one
// tab; the user can flip between Freecode sessions and Claude Code sessions
// with ← / →.
//
// v1 (Freecode-only) behavior is preserved exactly — the Freecode tab uses
// the same keybindings, scroll model, and preview-cache strategy. Tab
// navigation is orthogonal to the existing Tab = list/preview focus split;
// see `handleInput` for the dispatch.
//
// Spec: `docs/superpowers/specs/2026-08-02-resume-modal.md` (v1) +
//       `docs/superpowers/specs/2026-08-02-resume-modal-claude-code-tab.md` (v2).
// =============================================================================

import {
  Key,
  Markdown,
  matchesKey,
  type Component,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type {
  ClaudeSessionMeta,
  SerializedMessage,
  SessionMeta,
} from "@thisisayande/freecode-shared";

// -----------------------------------------------------------------------------
// Theme — every TUI modal keeps its own tiny theme; no shared theme module.
// -----------------------------------------------------------------------------

// Raw SGR codes, for lines that must open a colour, pad, then reset exactly
// once. Nesting the wrapper helpers below emits a reset mid-line, which drops
// the background across everything that follows it.
const ACCENT_CODE = "\u001b[36m"; // cyan
const BG_CARD_CODE = "\u001b[48;5;236m"; // dark gray
const BG_SEL_CODE = "\u001b[48;5;60m"; // blue-gray
const FG_PINK_CODE = "\u001b[38;5;205m"; // pink

const ACCENT = (text: string): string => `${ACCENT_CODE}${text}\u001b[0m`; // cyan
const DIM = (text: string): string => `\u001b[2m${text}\u001b[0m`; // dim
const BG_CARD = (text: string): string => `${BG_CARD_CODE}${text}\u001b[0m`; // dark gray
const TITLE_BG = (text: string): string =>
  `\u001b[30;46m${text}\u001b[0m`; // black on cyan
const RESET = "\u001b[0m";

const markdownTheme = {
  heading: (text: string) => ACCENT(text),
  link: (text: string) => ACCENT(text),
  linkUrl: (text: string) => DIM(text),
  code: (text: string) => text,
  codeBlock: (text: string) => text,
  codeBlockBorder: (text: string) => DIM(text),
  quote: (text: string) => DIM(text),
  quoteBorder: (text: string) => DIM(text),
  hr: (text: string) => DIM(text),
  listBullet: (text: string) => ACCENT(text),
  bold: (text: string) => text,
  italic: (text: string) => text,
  strikethrough: (text: string) => text,
  underline: (text: string) => text,
};

// -----------------------------------------------------------------------------
// Layout constants
// -----------------------------------------------------------------------------

const CARD_MARGIN_Y = 2;
const LIST_COL_FRAC = 0.38;
/** Rows per session in the list column (title, project, closed, created, gap). */
const ROWS_PER_SESSION = 5;
/** Width of the vertical scrollbar track on the list when it overflows. */
const SCROLLBAR_WIDTH = 1;
/** Page scroll step — sessions on the list, lines on the preview. */
const PAGE_STEP_LIST = 5;
const PAGE_STEP_PREVIEW = 5;
/** Preview lines scrolled per mouse-wheel notch (the list moves 1 session). */
const WHEEL_STEP_PREVIEW = 3;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Convert a serialized transcript to a markdown string for the preview pane. */
function transcriptToMarkdown(messages: SerializedMessage[]): string {
  if (messages.length === 0) return "*Empty session.*";
  const out: string[] = [];
  for (const msg of messages) {
    const who = msg.role === "user" ? "### 🧑 You" : "### 🤖 Assistant";
    out.push(who);
    for (const part of msg.parts) {
      if (part.type === "code") {
        const lang = part.language ?? "";
        const body = part.content ?? "";
        out.push("```" + lang + "\n" + body + "\n```");
      } else if (part.type === "tool") {
        const name = part.tool?.name ?? "tool";
        out.push("> 🔧 `" + name + "`");
      } else if (part.type === "text" && part.content) {
        out.push(part.content);
      }
      // image / unknown / empty → skip
    }
    out.push("");
  }
  return out.join("\n");
}

function padRight(s: string, width: number): string {
  const len = visibleWidth(s);
  if (len >= width) return s;
  return s + " ".repeat(width - len);
}

/**
 * Build a full-width card row: `styled` content (which carries its own SGR
 * codes and closing reset) followed by card-background padding out to exactly
 * `width` visible chars. The background is re-opened after the content so the
 * padding stays on the card instead of falling back to the terminal default —
 * `styled`'s own trailing reset would otherwise clear it.
 */
function cardRow(styled: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(styled));
  return BG_CARD_CODE + styled + BG_CARD_CODE + " ".repeat(pad) + RESET;
}

/**
 * Pad a line that already has visible width <= `width` out to exactly `width`
 * visible chars, *without* inspecting the line's raw char count. Lines from
 * `Markdown.render` arrive already width-padded but with embedded ANSI codes
 * mixed in (which makes their raw length > width); re-padding by raw length
 * corrupts them, so we pad by visible width instead.
 */
function padToVisible(s: string, width: number): string {
  const v = visibleWidth(s);
  if (v >= width) return s;
  return s + " ".repeat(width - v);
}

/**
 * Ellipsize a single-line string to at most `max` visible chars, appending `…`
 * if truncation happened. For *user-supplied* strings (titles, project paths)
 * where the line is short and has no embedded ANSI; using this on a line that
 * already contains SGR escapes is unsafe because `s.slice` operates on raw
 * characters, not visible width.
 */
function ellipsize(s: string, max: number): string {
  if (max <= 0) return "";
  if (visibleWidth(s) <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function relativeTime(ts: number): string {
  const now = Date.now();
  if (!ts || ts > now) return "just now";
  const seconds = Math.floor((now - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Render a vertical scrollbar track of `height` rows into the right edge of a
 * column. `offset` is the current scroll offset and `total` is the total
 * scrollable height. Returns an array of `height` strings (one per row) of
 * either █ (thumb) or │ (track).
 */
function renderScrollbar(
  height: number,
  total: number,
  visible: number,
  offset: number,
  active: boolean,
): string[] {
  if (height <= 0) return [];
  if (total <= visible) {
    // No overflow — no scrollbar.
    return Array.from({ length: height }, () => " ");
  }
  const max = Math.max(0, total - visible);
  const clamped = Math.min(Math.max(0, offset), max);
  // Thumb size proportional to the visible/total ratio, minimum 1 row.
  const thumbSize = Math.max(
    1,
    Math.round((visible / Math.max(1, total)) * height),
  );
  const trackSpace = height - thumbSize;
  const thumbStart = max === 0 ? 0 : Math.round((clamped / max) * trackSpace);
  const tracksBefore = thumbStart;
  const tracksAfter = trackSpace - tracksBefore;
  const fg = active ? ACCENT : DIM;
  const out: string[] = [];
  for (let i = 0; i < tracksBefore; i++) out.push(DIM("│"));
  for (let i = 0; i < thumbSize; i++) out.push(fg("█"));
  for (let i = 0; i < tracksAfter; i++) out.push(DIM("│"));
  return out;
}

// -----------------------------------------------------------------------------
// ResumePicker
// -----------------------------------------------------------------------------

/** A tab identifies which session source the list + preview are showing. */
export type ResumeTab = "freecode" | "claude-code";

export interface ResumePickerCallbacks {
  /**
   * Fires when the cursor moves to a different session. The wiring layer is
   * responsible for firing the lazy `session.resume` (Freecode tab) or
   * `session.claudeTranscript` (Claude Code tab) if the id is not yet cached
   * and pushing the result back via `setPreview`.
   */
  onSelectionChange?: (sessionId: string, tab: ResumeTab) => void;
  /**
   * Fires on Enter. The wiring layer dispatches by tab:
   *   - Freecode: resume + close.
   *   - Claude Code: show a "coming soon" message; the modal stays open.
   */
  onSelect: (sessionId: string, tab: ResumeTab) => void;
  /** Fires on Esc / Ctrl+C — wiring layer should close and refocus editor. */
  onCancel: () => void;
}

/**
 * The /resume modal: a tabbed session picker. Each tab is a two-pane view
 * (list left, preview right). Owns its own keyboard routing so:
 *  - Tab / BackTab swap focus between list and preview (within the active tab).
 *  - ↑ / ↓ move the cursor or scroll the preview (whichever has focus).
 *  - ← / → swap tabs (no wrap-around; the right tab's → is a no-op).
 *
 * Cursor, list scroll, preview cache, and pending preview are all kept
 * *per tab*, so swapping tabs preserves each view's state.
 */
export class ResumePicker implements Component {
  /** Per-tab state — kept separate so tab swaps don't reset the cursor. */
  private readonly tabState: Record<
    ResumeTab,
    {
      sessions: SessionMeta[] | ClaudeSessionMeta[];
      cursor: number;
      listScroll: number;
      previews: Map<string, SerializedMessage[]>;
      pendingPreview: string | null;
    }
  >;
  /** Which tab is currently active. Defaults to Freecode. */
  private activeTab: ResumeTab = "freecode";
  /** True when the preview pane has focus (Tab toggles). */
  private previewFocus = false;
  /** Markdown renderer for the preview pane (shared, reset on tab swap). */
  private readonly markdown: Markdown;
  /** Cached rendered preview lines (recomputed when text or width changes). */
  private cachedPreviewText = "";
  private cachedPreviewLines: string[] = [];
  private cachedPreviewWidth = 0;

  constructor(
    freecodeSessions: SessionMeta[],
    claudeSessions: ClaudeSessionMeta[],
    private readonly callbacks: ResumePickerCallbacks,
  ) {
    this.tabState = {
      freecode: {
        sessions: freecodeSessions,
        cursor: 0,
        listScroll: 0,
        previews: new Map(),
        pendingPreview: null,
      },
      "claude-code": {
        sessions: claudeSessions,
        cursor: 0,
        listScroll: 0,
        previews: new Map(),
        pendingPreview: null,
      },
    };
    this.markdown = new Markdown("", 0, 0, markdownTheme);
  }

  // ---------------------------------------------------------------------------
  // Per-tab accessors — every state read goes through these so adding more
  // tabs is a one-line change here and nowhere else.
  // ---------------------------------------------------------------------------

  private get state() {
    return this.tabState[this.activeTab];
  }

  /**
   * Replace the Claude Code session list (called after the lazy
   * `session.claudeList` resolves). Resets the cursor to 0 so the user lands
   * on the most-recent row.
   */
  setClaudeSessions(sessions: ClaudeSessionMeta[]): void {
    const tab = this.tabState["claude-code"];
    tab.sessions = sessions;
    tab.cursor = 0;
    tab.listScroll = 0;
    tab.pendingPreview = sessions[0]?.id ?? null;
    this.invalidate();
  }

  /**
   * Push a fetched transcript into the active tab's preview cache and
   * re-render. Called by the wiring layer after a lazy IPC resolves.
   */
  setPreview(sessionId: string, messages: SerializedMessage[]): void {
    const tab = this.state;
    tab.previews.set(sessionId, messages);
    tab.pendingPreview = null;
    this.invalidate();
  }

  /** The active tab. */
  activeTabName(): ResumeTab {
    return this.activeTab;
  }

  /** Highlighted session id in the active tab, or null when the list is empty. */
  selectedId(): string | null {
    const tab = this.state;
    return tab.sessions[tab.cursor]?.id ?? null;
  }

  /** True when the preview pane is currently focused (Tab has been pressed). */
  isPreviewFocused(): boolean {
    return this.previewFocus;
  }

  /** Total number of cached previews across both tabs (useful for tests). */
  cacheSize(): number {
    return (
      this.tabState.freecode.previews.size +
      this.tabState["claude-code"].previews.size
    );
  }

  invalidate(): void {
    this.cachedPreviewLines = [];
    this.cachedPreviewWidth = 0;
    this.markdown.invalidate();
  }

  // ---------------------------------------------------------------------------
  // Cursor / scroll (all per-tab)
  // ---------------------------------------------------------------------------

  /** Advance the cursor by `delta` sessions, wrapping within the active tab. */
  private moveCursor(delta: number): void {
    const tab = this.state;
    if (tab.sessions.length === 0) return;
    const n = tab.sessions.length;
    tab.cursor = (tab.cursor + delta + n) % n;
    this.previewScroll = 0;
    tab.pendingPreview = tab.sessions[tab.cursor]?.id ?? null;
    this.callbacks.onSelectionChange?.(tab.sessions[tab.cursor].id, this.activeTab);
  }

  /**
   * Move the cursor by `delta` sessions, clamped at both ends. Used by the
   * mouse wheel, where wrapping from the last row back to the first would be
   * surprising (unlike `↑`/`↓`, which wrap by design).
   */
  private stepCursor(delta: number): void {
    const tab = this.state;
    if (tab.sessions.length === 0) return;
    const next = Math.min(
      Math.max(0, tab.cursor + delta),
      tab.sessions.length - 1,
    );
    if (next === tab.cursor) return;
    tab.cursor = next;
    this.previewScroll = 0;
    tab.pendingPreview = tab.sessions[tab.cursor].id;
    this.callbacks.onSelectionChange?.(tab.sessions[tab.cursor].id, this.activeTab);
  }

  /** Scroll the list by `deltaSessions` (clamped); does not move the cursor. */
  private scrollList(deltaSessions: number): void {
    const tab = this.state;
    const visible = this.visibleSessions(this.cachedListHeight);
    const max = Math.max(0, tab.sessions.length - visible);
    tab.listScroll = Math.min(
      Math.max(0, tab.listScroll + deltaSessions),
      max,
    );
  }

  /** Scroll the preview by `deltaLines` (clamped). */
  private scrollPreview(deltaLines: number): void {
    if (this.cachedPreviewLines.length === 0) return;
    const max = Math.max(0, this.cachedPreviewLines.length - this.cachedPreviewHeight);
    this.previewScroll = Math.min(
      Math.max(0, this.previewScroll + deltaLines),
      max,
    );
  }

  /** Number of sessions visible in the list column (cached per render). */
  private cachedListHeight = 0;
  private cachedPreviewHeight = 0;
  /** List column width captured per render, for mouse hit-testing. */
  private cachedListWidth = 0;
  /** Vertical scroll offset into the rendered preview. (Per-pane, not per-tab.) */
  private previewScroll = 0;

  /** Compute how many sessions fit in `height` rows (each session is 5 rows). */
  private visibleSessions(height: number): number {
    return Math.max(1, Math.floor(height / ROWS_PER_SESSION));
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  /**
   * Keyboard router. The framework only sends keys to the focused component,
   * so this must live on the picker itself.
   *
   * Routing rules:
   *  - `←` / `h` → swap to previous tab (no-op on Freecode; the left tab).
   *  - `→` / `l` → swap to next tab (no-op on Claude Code; the right tab).
   *  - `Tab` / `BackTab` → swap focus between list and preview (within tab).
   *  - `↑` / `k`:
   *      - list focus  → cursor -1 (wraps)
   *      - preview focus → scroll preview up by 1 line
   *  - `↓` / `j`:
   *      - list focus  → cursor +1 (wraps)
   *      - preview focus → scroll preview down by 1 line
   *  - `PageUp` / `PageDown` → scroll the *focused* pane (list = 5 sessions,
   *                           preview = 5 lines)
   *  - `Home` → list focus: jump cursor to first session; preview focus: scroll
   *           preview to top
   *  - `End`  → list focus: jump cursor to last session; preview focus: scroll
   *           preview to bottom
   *  - `Enter` → emit onSelect with the highlighted id + active tab.
   *  - `Esc` / `Ctrl+C` → emit onCancel.
   */
  handleInput(data: string): void {
    if (matchesKey(data, Key.left) || data === "h") {
      this.switchTab("freecode");
      return;
    }
    if (matchesKey(data, Key.right) || data === "l") {
      this.switchTab("claude-code");
      return;
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
      this.previewFocus = !this.previewFocus;
      this.previewScroll = 0;
      return;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      if (this.previewFocus) this.scrollPreview(-1);
      else this.moveCursor(-1);
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      if (this.previewFocus) this.scrollPreview(1);
      else this.moveCursor(1);
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      if (this.previewFocus) this.scrollPreview(-PAGE_STEP_PREVIEW);
      else this.scrollList(-PAGE_STEP_LIST);
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      if (this.previewFocus) this.scrollPreview(PAGE_STEP_PREVIEW);
      else this.scrollList(PAGE_STEP_LIST);
      return;
    }
    if (matchesKey(data, Key.home)) {
      if (this.previewFocus) this.previewScroll = 0;
      else {
        const tab = this.state;
        tab.cursor = 0;
        tab.listScroll = 0;
        this.previewScroll = 0;
        tab.pendingPreview = tab.sessions[0]?.id ?? null;
        this.callbacks.onSelectionChange?.(tab.sessions[0]?.id, this.activeTab);
      }
      return;
    }
    if (matchesKey(data, Key.end)) {
      if (this.previewFocus) {
        const max = Math.max(
          0,
          this.cachedPreviewLines.length - this.cachedPreviewHeight,
        );
        this.previewScroll = max;
      } else {
        const tab = this.state;
        tab.cursor = Math.max(0, tab.sessions.length - 1);
        const visible = this.visibleSessions(this.cachedListHeight);
        tab.listScroll = Math.max(0, tab.sessions.length - visible);
        this.previewScroll = 0;
        tab.pendingPreview = tab.sessions[tab.cursor]?.id ?? null;
        this.callbacks.onSelectionChange?.(
          tab.sessions[tab.cursor]?.id,
          this.activeTab,
        );
      }
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const id = this.selectedId();
      if (id) this.callbacks.onSelect(id, this.activeTab);
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.callbacks.onCancel();
      return;
    }
  }

  /**
   * Move to the requested tab if it is not the active tab. No-op when already
   * active (so `→` from Claude Code and `←` from Freecode are silent).
   */
  private switchTab(target: ResumeTab): void {
    if (this.activeTab === target) return;
    this.activeTab = target;
    // Switching tabs resets the per-pane focus + scroll so the user lands
    // on a fresh view. The list cursor + preview cache are preserved.
    this.previewFocus = false;
    this.previewScroll = 0;
    this.invalidate();
    // Kick off a preview fetch for the new tab's highlighted row (the
    // wiring layer may have it cached, but the safest path is to fire the
    // callback again — it's idempotent).
    const tab = this.state;
    const id = tab.sessions[tab.cursor]?.id ?? null;
    if (id) this.callbacks.onSelectionChange?.(id, this.activeTab);
  }

  /**
   * Route one mouse-wheel notch to the pane under the pointer. `delta` is +1
   * for wheel-down and -1 for wheel-up; `column` is the 0-based terminal column
   * of the pointer. The card is left-aligned, so column 0 is its left border,
   * columns 1..listWidth are the list, and everything right of that is the
   * preview. Hovering a pane also focuses it, so the keyboard and the
   * scrollbar highlight follow the wheel.
   */
  handleMouseWheel(delta: number, column: number): void {
    const overList =
      this.cachedListWidth > 0 && column <= this.cachedListWidth;
    this.previewFocus = !overList;
    if (overList) this.stepCursor(delta);
    else this.scrollPreview(delta * WHEEL_STEP_PREVIEW);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  render(width: number): string[] {
    // The card spans the full width it is given. It is rendered flush at column
    // 0, so subtracting a horizontal margin here did not centre it — it just
    // left the whole margin as dead space on the right.
    const cardWidth = Math.max(40, width);
    // `rows` is undefined when stdout is not a TTY; without the fallback the
    // arithmetic goes NaN and the card renders with no content rows at all.
    const termRows = process.stdout.rows || 24;
    const cardHeight = Math.max(12, termRows - CARD_MARGIN_Y * 2);

    // Every row is `│` + innerWidth + `│`. The title and hint must be built at
    // innerWidth, *not* cardWidth — padding them to the full card width and
    // then wrapping them in borders pushed those two rows 2 columns past the
    // right edge, so their `│` no longer lined up with the card.
    const innerWidth = cardWidth - 2;

    const tabStrip = this.renderTabStrip(innerWidth);
    // The title row carries the tab strip right-aligned; the title text
    // gets the remaining budget on the left, ellipsized if too long.
    const tabStripWidth = visibleWidth(tabStrip);
    const titleBudget = Math.max(0, innerWidth - tabStripWidth);
    const titleText = ellipsize(" Resume a session ", titleBudget);
    const titleRow = cardRow(
      TITLE_BG(titleText) + (tabStripWidth > 0 ? tabStrip : ""),
      innerWidth,
    );

    const hint = this.previewFocus
      ? " ↑/↓ scroll preview · ←/→ tab · Tab list · Enter resume · Esc cancel "
      : " ↑/↓ move · ←/→ tab · Tab preview · Enter resume · Esc cancel ";
    const hintRow = cardRow(DIM(ellipsize(hint, innerWidth)), innerWidth);

    const topBorder = ACCENT("╭" + "─".repeat(innerWidth) + "╮");
    const bottomBorder = ACCENT("╰" + "─".repeat(innerWidth) + "╯");

    const innerHeight = Math.max(2, cardHeight - 4); // minus borders+title+hint
    const listWidth = Math.max(20, Math.floor(innerWidth * LIST_COL_FRAC));
    const previewWidth = innerWidth - listWidth;

    // Cache for keyboard/mouse handlers (scrollList/End/Home/wheel read these).
    this.cachedListHeight = innerHeight;
    this.cachedPreviewHeight = innerHeight;
    this.cachedListWidth = listWidth;

    const tab = this.state;

    // Auto-scroll the list so the cursor stays visible. We do this in render
    // (not in moveCursor) so a terminal resize changes the visible window.
    const visibleSessions = this.visibleSessions(innerHeight);
    if (tab.cursor < tab.listScroll) {
      tab.listScroll = tab.cursor;
    } else if (tab.cursor >= tab.listScroll + visibleSessions) {
      tab.listScroll = tab.cursor - visibleSessions + 1;
    }
    const maxListScroll = Math.max(0, tab.sessions.length - visibleSessions);
    if (tab.listScroll > maxListScroll) tab.listScroll = maxListScroll;

    const listLines = this.renderListColumn(listWidth, innerHeight);
    const previewLines = this.renderPreviewColumn(previewWidth, innerHeight);

    const rows: string[] = [];
    for (let i = 0; i < innerHeight; i++) {
      const l = listLines[i] ?? "";
      const p = previewLines[i] ?? "";
      const paddedLeft = BG_CARD(padRight(l, listWidth));
      const paddedRight = BG_CARD(padRight(p, previewWidth));
      rows.push(BG_CARD("│" + paddedLeft + paddedRight + "│"));
    }

    return [
      topBorder,
      "│" + cardRow("", innerWidth) + "│",
      "│" + titleRow + "│",
      ...rows,
      "│" + cardRow("", innerWidth) + "│",
      "│" + hintRow + "│",
      bottomBorder,
    ];
  }

  // ---------------------------------------------------------------------------
  // Tab strip + per-column renderers
  // ---------------------------------------------------------------------------

  /**
   * Build the right-aligned tab strip for the title row. The strip renders
   * directly on the title row's cyan background — no card background re-open
   * is needed because the title is solid-colour. We just dim the inactive
   * tab and accent the active one; the arrow markers (`◀` / `▶`) flank the
   * active label so the user always sees the tab affordance.
   */
  private renderTabStrip(width: number): string {
    if (width < 12) return "";
    const freecodeLabel = "Freecode";
    const claudeLabel = "Claude Code";
    // The strip is ` ◀ Claude Code ▶ ` at full size; smaller terminals drop
    // the markers.
    const isClaude = this.activeTab === "claude-code";
    const freecode = isClaude ? DIM(freecodeLabel) : ACCENT("▎ " + freecodeLabel);
    const claude = isClaude ? ACCENT("▎ " + claudeLabel) : DIM(claudeLabel);
    const arrow = (ch: string) => (width >= 22 ? DIM(ch) : "");
    return `${arrow("◀ ")}${freecode}${DIM(" ")}${claude}${arrow(" ▶")}`;
  }

  private renderListColumn(width: number, height: number): string[] {
    const tab = this.state;
    const visible = this.visibleSessions(height);
    const start = tab.listScroll;
    const end = Math.min(tab.sessions.length, start + visible);

    // Each session takes ROWS_PER_SESSION rows. We render exactly
    // `visible * ROWS_PER_SESSION` rows, padding if there are fewer sessions.
    const out: string[] = [];
    const showScrollbar = tab.sessions.length > visible;
    const innerContentWidth = showScrollbar
      ? Math.max(0, width - SCROLLBAR_WIDTH)
      : width;
    const scrollbar = showScrollbar
      ? renderScrollbar(
          visible * ROWS_PER_SESSION,
          tab.sessions.length,
          visible,
          start,
          !this.previewFocus,
        )
      : [];

    for (let i = 0; i < visible; i++) {
      const sessionIdx = start + i;
      const session = tab.sessions[sessionIdx];
      const isSel = sessionIdx === tab.cursor;
      for (let r = 0; r < ROWS_PER_SESSION; r++) {
        const rowOut = session
          ? this.renderSessionRow(session, isSel, r, innerContentWidth)
          : BG_CARD(" ".repeat(innerContentWidth));
        if (showScrollbar) {
          // The scrollbar cell is drawn on the card background so the gutter
          // matches the column instead of falling through to the terminal's
          // default background.
          const sb = scrollbar[i * ROWS_PER_SESSION + r] ?? " ";
          out.push(rowOut + BG_CARD(sb));
        } else {
          out.push(rowOut);
        }
      }
    }
    return out;
  }

  /**
   * Render one of the 5 rows of a session entry, always exactly `width` visible
   * chars wide *with the row background covering every one of them*.
   *
   * The row is emitted as a single SGR run — `bg + fg + padded text + reset` —
   * instead of nesting the `BG_*`/colour helpers. Each of those helpers appends
   * a full `\u001b[0m`, and a reset in the middle of a line drops the background
   * for everything after it, so the highlight band stopped at the end of the
   * text rather than spanning the column. Pad first (on the plain string, so
   * `padRight` measures real characters), colour once, reset last.
   *
   * Accepts both `SessionMeta` and `ClaudeSessionMeta` — they share every
   * field the row renderer reads.
   */
  private renderSessionRow(
    s: SessionMeta | ClaudeSessionMeta,
    isSel: boolean,
    rowIdx: number,
    width: number,
  ): string {
    const bg = isSel ? BG_SEL_CODE : BG_CARD_CODE;
    const prefix = isSel ? "\u203a " : "  ";
    // Every row carries a 2-char prefix, so the text budget is `width - 2`.
    const budget = Math.max(0, width - 2);
    const row = (fg: string, text: string): string =>
      bg + fg + padRight(prefix + ellipsize(text, budget), width) + RESET;

    if (rowIdx === 0) {
      const title = s.title.trim() === "" ? "(untitled)" : s.title;
      return row(FG_PINK_CODE, `${title} \u00b7 ${s.turnCount} turns`);
    }
    if (rowIdx === 1) return row(ACCENT_CODE, s.projectPath);
    // Bright white vs dim, so the selected row's metadata stays readable.
    const metaColor = isSel ? "\u001b[37m" : "\u001b[2m";
    if (rowIdx === 2) return row(metaColor, "Closed " + relativeTime(s.lastTurnAt));
    if (rowIdx === 3) {
      return row(metaColor, "Created " + relativeTime(s.createdAt));
    }
    return bg + " ".repeat(width) + RESET;
  }

  private renderPreviewColumn(width: number, height: number): string[] {
    if (width < 8) {
      return Array.from({ length: height }, () => " ".repeat(width));
    }

    const id = this.selectedId();
    const tab = this.state;
    let text: string;
    if (id === null) {
      text = "";
    } else if (tab.previews.has(id)) {
      text = transcriptToMarkdown(tab.previews.get(id)!);
    } else if (this.activeTab === "claude-code" && tab.sessions.length === 0) {
      text = "_No Claude Code sessions found._";
    } else {
      // Either racing with the async fetch or never fetched.
      text = "_loading preview…_";
    }

    // Render `Markdown` at the *content* width (column width minus scrollbar slot
    // when a scrollbar is needed). Each line will be padded to exactly that
    // visible width by `Markdown`, with embedded ANSI escapes around tokens
    // (which `visibleWidth` correctly strips). We never truncate the result
    // by raw char count because the embedded escapes make raw length > visible
    // width and would corrupt the padding.
    const innerWidth = Math.max(1, width - SCROLLBAR_WIDTH);
    if (
      text !== this.cachedPreviewText ||
      innerWidth !== this.cachedPreviewWidth ||
      this.cachedPreviewLines.length === 0
    ) {
      this.cachedPreviewText = text;
      this.cachedPreviewWidth = innerWidth;
      this.markdown.setText(text);
      this.cachedPreviewLines = this.markdown.render(innerWidth);
      if (this.cachedPreviewLines.length === 0) {
        this.cachedPreviewLines = wrapTextWithAnsi(text, innerWidth);
      }
    }
    const all = this.cachedPreviewLines;

    const maxScroll = Math.max(0, all.length - height);
    if (this.previewScroll > maxScroll) this.previewScroll = maxScroll;
    const start = this.previewScroll;
    const window = all.slice(start, start + height);

    const showScrollbar = all.length > height;
    const scrollbar = showScrollbar
      ? renderScrollbar(
          height,
          all.length,
          height,
          start,
          this.previewFocus,
        )
      : [];

    const out: string[] = [];
    for (let i = 0; i < height; i++) {
      const raw = window[i] ?? "";
      // `Markdown` already padded the line to exactly `innerWidth` visible
      // chars. Re-pad with `padToVisible` as a defensive no-op for empty or
      // short lines that didn't get padded, then optionally append the
      // scrollbar char to fill out the column to `width`.
      const padded = padToVisible(raw, innerWidth);
      if (showScrollbar) {
        out.push(padded + (scrollbar[i] ?? " "));
      } else {
        out.push(padded);
      }
    }
    return out;
  }
}
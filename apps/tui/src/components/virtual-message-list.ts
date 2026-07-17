import { type Component, type TUI } from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { MessageInstance } from "./message-types.js";
import { subscribeToMessages, getMessages } from "../state/message-store.js";

/**
 * VirtualMessageList — scrollable message history that implements pi-tui's Component interface.
 *
 * Subscribes to MessageStore and re-renders when messages change.
 * Only renders the last N messages to avoid memory/performance issues.
 *
 * An optional `header` component (the logo/tips info box) renders as the
 * first entry in the scrollable content, not a fixed pane above it — it
 * scrolls away with the rest of the history instead of permanently eating
 * into the viewport.
 *
 * Scrolling has two modes:
 * - Follow (default): renders the full history; the terminal's native
 *   scrollback holds older lines, and new content sticks to the bottom.
 * - Scrolled (after scrollPageUp): renders only a viewport-sized window of
 *   lines plus an indicator row, so scrolling works even in terminals whose
 *   scrollback the inline renderer can't rely on. Paging past the bottom
 *   returns to follow mode.
 */
export class VirtualMessageList implements Component {
  private messages: MessageInstance[] = [];
  private maxVisible: number;
  private unsubscribe: (() => void) | null = null;
  private invalidated = false;
  private tui: TUI | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  /** Index of the first visible line when scrolled; null = follow bottom. */
  private scrollTop: number | null = null;
  /** Total line count from the last render — scroll math between renders. */
  private lastTotalLines = 0;
  private getViewportRows: () => number;
  private header?: Component;

  constructor(
    maxVisible = 100,
    getViewportRows: () => number = () => 24,
    header?: Component,
  ) {
    this.maxVisible = maxVisible;
    this.getViewportRows = getViewportRows;
    this.header = header;
    // Subscribe to message store changes
    this.unsubscribe = subscribeToMessages((msgs) => {
      this.messages = msgs;
      this.invalidate();
      this.scheduleTick();
    });
    // Initialize with current messages
    this.messages = getMessages();
  }

  /**
   * Set the TUI instance for triggering renders
   */
  setTui(tui: TUI): void {
    this.tui = tui;
  }

  /**
   * Mark the component as needing re-render
   */
  invalidate(): void {
    this.invalidated = true;
    if (this.tui) {
      this.tui.requestRender();
    }
  }

  /**
   * Schedule a tick interval if an in-progress message exists
   */
  private scheduleTick(): void {
    const hasInProgress = this.messages.some((m) => m.type === "in_progress");
    if (!hasInProgress) return;

    if (this.tickInterval) return;

    this.tickInterval = setInterval(() => {
      if (this.tickInterval) {
        clearInterval(this.tickInterval);
        this.tickInterval = null;
      }
      this.invalidate();
      // Reschedule if in-progress message still exists
      this.scheduleTick();
    }, 1000);
  }

  /** Rows available for message content when scrolled (one row is reserved for the indicator). */
  private contentRows(): number {
    return Math.max(3, this.getViewportRows()) - 1;
  }

  /** Whether the list is scrolled away from the bottom. */
  get isScrolled(): boolean {
    return this.scrollTop !== null;
  }

  /**
   * Scroll by a signed line delta (negative = up, positive = down).
   * Negative deltas can enter scrolled mode from follow mode; positive
   * deltas are a no-op while already following the bottom, and return to
   * follow mode once they reach it — same rules as the page methods below.
   */
  scrollBy(delta: number): void {
    const content = this.contentRows();
    const maxTop = Math.max(0, this.lastTotalLines - content);
    if (maxTop === 0 || delta === 0) return;
    if (delta < 0) {
      const current = this.scrollTop ?? maxTop;
      this.scrollTop = Math.max(0, current + delta);
    } else {
      if (this.scrollTop === null) return;
      const next = this.scrollTop + delta;
      this.scrollTop = next >= maxTop ? null : next;
    }
    this.invalidate();
  }

  /** Scroll up by one page (enters scrolled mode from follow mode). */
  scrollPageUp(): void {
    this.scrollBy(-Math.max(1, this.contentRows() - 1));
  }

  /** Scroll down by one page; reaching the bottom returns to follow mode. */
  scrollPageDown(): void {
    this.scrollBy(Math.max(1, this.contentRows() - 1));
  }

  /** Return to follow mode (bottom of the history). */
  scrollToBottom(): void {
    if (this.scrollTop === null) return;
    this.scrollTop = null;
    this.invalidate();
  }

  /**
   * Render the message list.
   * In-progress message always stays at the bottom; all other messages render above it.
   * In scrolled mode, only a viewport window plus an indicator row is returned.
   */
  render(width: number): string[] {
    this.invalidated = false;

    const lines: string[] = [];

    if (this.header) {
      lines.push(...this.header.render(width), "");
    }

    // Separate in-progress message from others
    const regularMessages = this.messages.filter(
      (m) => m.type !== "in_progress",
    );
    const inProgressMessage = this.messages.find(
      (m) => m.type === "in_progress",
    );

    // Render regular messages first (older messages, then newer ones)
    const visibleMessages = regularMessages.slice(-this.maxVisible);

    for (const msg of visibleMessages) {
      const msgLines = msg.component.render(width);
      for (const line of msgLines) {
        lines.push(line);
      }
    }

    // Render in-progress message at the very bottom (if exists)
    if (inProgressMessage) {
      const inProgressLines = inProgressMessage.component.render(width);
      for (const line of inProgressLines) {
        lines.push(line);
      }
    }

    this.lastTotalLines = lines.length;

    // Content fits in the viewport outright — no windowing needed either way,
    // but pad with leading blank lines up to the full budget so the editor
    // (rendered right after this component) still bottom-anchors to the
    // last row instead of floating right under a short history.
    const content = this.contentRows();
    if (lines.length <= content) {
      this.scrollTop = null;
      const padding = content + 1 - lines.length;
      return padding > 0 ? [...Array(padding).fill(""), ...lines] : lines;
    }

    if (this.scrollTop === null) {
      // Follow mode: tail-anchored window using the full viewport budget
      // (content + the row a scrolled indicator would take). Rendered
      // height must stay identical to scrolled mode's `content + 1` below —
      // otherwise the editor, which renders right after this component,
      // jumps position the moment scrolling starts (the alt screen has no
      // native scrollback to paper over a height that swings with mode).
      return lines.slice(-(content + 1));
    }

    // Scrolled mode: return a stable window of lines plus an indicator row.
    this.scrollTop = Math.min(this.scrollTop, lines.length - content);
    const start = this.scrollTop;
    const window = lines.slice(start, start + content);
    const below = lines.length - (start + content);
    window.push(
      chalk.dim(
        `── ↑ ${start} line${start === 1 ? "" : "s"} above · ↓ ${below} below · PgUp/PgDn to scroll ──`,
      ),
    );
    return window;
  }

  /**
   * Cleanup subscription and tick interval when component is destroyed
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }
}

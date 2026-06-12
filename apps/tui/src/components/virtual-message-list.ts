import { type Component, type TUI } from "@earendil-works/pi-tui";
import type { MessageInstance } from "./message-types.js";
import { subscribeToMessages, getMessages } from "../state/message-store.js";

/**
 * VirtualMessageList — scrollable message history that implements pi-tui's Component interface.
 *
 * Subscribes to MessageStore and re-renders when messages change.
 * Only renders the last N messages to avoid memory/performance issues.
 */
export class VirtualMessageList implements Component {
  private messages: MessageInstance[] = [];
  private maxVisible: number;
  private unsubscribe: (() => void) | null = null;
  private invalidated = false;
  private tui: TUI | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor(maxVisible = 100) {
    this.maxVisible = maxVisible;
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

  /**
   * Render the message list.
   * In-progress message always stays at the bottom; all other messages render above it.
   */
  render(width: number): string[] {
    this.invalidated = false;

    const lines: string[] = [];

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

    return lines;
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

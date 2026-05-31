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

  constructor(maxVisible = 100) {
    this.maxVisible = maxVisible;
    // Subscribe to message store changes
    this.unsubscribe = subscribeToMessages((msgs) => {
      this.messages = msgs;
      this.invalidate();
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
   * Render the message list.
   * Returns only the last maxVisible messages for performance.
   */
  render(width: number): string[] {
    this.invalidated = false;

    const lines: string[] = [];

    // Only render last N messages
    const visibleMessages = this.messages.slice(-this.maxVisible);

    for (const msg of visibleMessages) {
      const msgLines = msg.component.render(width);
      for (const line of msgLines) {
        lines.push(line);
      }
    }

    return lines;
  }

  /**
   * Cleanup subscription when component is destroyed
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
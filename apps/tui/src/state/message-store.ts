import type { Component } from "@earendil-works/pi-tui";
import type {
  MessageInstance,
  MessageType,
  MessageStoreOptions,
} from "../components/message-types.js";

type Subscriber = (messages: MessageInstance[]) => void;

class MessageStoreImpl {
  private messages: MessageInstance[] = [];
  private subscribers = new Set<Subscriber>();
  private idCounter = 0;
  private maxMessages: number | undefined;
  /**
   * Which prompt's content is currently shown in the chat. Drives the
   * virtual list's filter (only messages whose `promptIndex` matches are
   * rendered) and the active tab in the prompt-tab strip at the top of
   * the chat. `undefined` means no prompt has been submitted yet — the
   * strip stays hidden and the list shows nothing. Otherwise it's the
   * 1-based index of the visible prompt's user message.
   *
   * Always points at an existing prompt — `add()` updates it to the
   * brand-new prompt index when a user message arrives, so the chat
   * auto-switches to a freshly submitted prompt (matches the "focused
   * window" mental model and matches the inline behavior the user asked
   * for). Switching tabs is done through `setActivePromptIndex`.
   */
  private activePromptIndex: number | undefined;

  constructor(options: MessageStoreOptions = {}) {
    this.maxMessages = options.maxMessages;
  }

  private generateId(): number {
    return ++this.idCounter;
  }

  /**
   * Add a new message to the store
   */
  add(
    type: MessageType,
    content: string,
    component: Component,
    queueId?: string,
  ): MessageInstance {
    // Prompt-index tagging: every user prompt starts a new "page". All
    // messages that follow (assistant text, tool rows, thinking, the
    // in-progress line) inherit the same index until the next user prompt.
    // The tab strip uses this to render one prompt's slice per tab.
    // System messages and anything before the first user prompt stay
    // unindexed.
    let promptIndex: number | undefined;
    if (type === "user" || type === "queued_user") {
      promptIndex = this.nextPromptIndex();
    } else {
      // Inherit from the most recent *running* prompt rather than from
      // whatever row happens to be last. Anchoring on the last row broke
      // in two ways: a system notice or a tool row that had lost its own
      // index propagated that gap, and — the loud one — a prompt typed
      // while a turn is running parks a `queued_user` at the end of the
      // transcript without starting a turn, so the running turn's
      // remaining output got filed under the queued prompt's page (the
      // answer showed on the next page, and its own page looked
      // unanswered).
      //
      // `queued_user` is therefore not a valid anchor: it becomes one the
      // moment core reports its turn started (`message_started` →
      // `promoteQueued`, which flips the row's type to `user`).
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i]!;
        if (m.type !== "user") continue;
        promptIndex = m.promptIndex;
        break;
      }
    }

    const message: MessageInstance = {
      id: this.generateId(),
      type,
      content,
      component,
      timestamp: Date.now(),
      queueId,
      promptIndex,
    };

    // Auto-switch: a freshly submitted prompt becomes the active one
    // immediately, so submitting a new message lands you in its tab
    // without a click. (Pre-prompt messages stay unindexed; this only
    // fires once a user message has been seen.)
    if (type === "user") {
      this.activePromptIndex = promptIndex;
    }

    this.messages.push(message);

    // Cap memory usage if limit set
    if (this.maxMessages && this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }

    this.notify();
    return message;
  }

  /**
   * 1-based index of the next user prompt. Counts existing user and
   * queued_user messages so a queued follow-up that gets drained into
   * a real user message keeps numbering contiguous (no gaps).
   */
  private nextPromptIndex(): number {
    let n = 0;
    for (const m of this.messages) {
      if (m.type === "user" || m.type === "queued_user") n++;
    }
    return n + 1;
  }

  /**
   * Highest 1-based prompt index currently represented in the store.
   * Used by `getPromptCount` so the tab strip always shows every tab
   * the user has submitted, even when the optimistic-local-echo +
   * queued-merge flow in submitPrompt() leaves a hole in the user-row
   * indices. Without this fallback the strip would under-count tabs
   * the moment a prompt gets parked in the queue, and tab-numbers in
   * the strip would silently desync from the promptIndex values
   * attached to assistant rows.
   */
  private maxPromptIndex(): number {
    let max = 0;
    for (const m of this.messages) {
      if (m.promptIndex !== undefined && m.promptIndex > max) {
        max = m.promptIndex;
      }
    }
    return max;
  }

  /**
   * Read which prompt is currently in focus. `undefined` means no prompt
   * exists yet. The tab strip and the virtual list both read this to
   * know what to draw — a single source of truth for "which page is on
   * top" rather than three places that need to stay in sync.
   */
  getActivePromptIndex(): number | undefined {
    return this.activePromptIndex;
  }

  /**
   * Switch the visible tab to the given 1-based prompt index. No-op when
   * the index doesn't match any existing prompt — out-of-range input from
   * a hotkey (or a stale queued message dequeue) can't yank the user off
   * into empty space. Notifies subscribers so the list and tab strip
   * rerender in lockstep.
   */
  setActivePromptIndex(promptIndex: number): void {
    if (this.activePromptIndex === promptIndex) return;
    if (!this.hasPromptIndex(promptIndex)) return;
    this.activePromptIndex = promptIndex;
    this.notify();
  }

  /**
   * True if any message with this prompt index exists. We accept
   * assistant/tool/system rows too, because the optimistic-local-echo +
   * queued-merge flow in submitPrompt() can leave the user marker
   * missing for a given index while the assistant text for that turn
   * is still tagged with it. Without this fallback, the tab strip
   * would silently refuse to switch to a prompt that has visible
   * content but no user/queued_user row.
   */
  private hasPromptIndex(promptIndex: number): boolean {
    for (const m of this.messages) {
      if (m.promptIndex === promptIndex) return true;
    }
    return false;
  }

  /**
   * Flip a queued_user row to a live user row in place, keeping its id,
   * queueId and promptIndex. Called when core reports that the queued
   * prompt's turn has started (`message_started`): from here on the row
   * is a normal prompt, so `add()` files the turn's output under its
   * page, and the view follows the running turn the way it does for a
   * prompt sent directly.
   */
  promoteQueued(id: number, component: Component): MessageInstance | undefined {
    const message = this.messages.find((m) => m.id === id);
    if (!message || message.type !== "queued_user") return undefined;
    message.type = "user";
    message.component = component;
    this.activePromptIndex = message.promptIndex;
    this.notify();
    return message;
  }

  /**
   * Remove a message by its ID
   */
  remove(id: number): MessageInstance | undefined {
    const index = this.messages.findIndex((m) => m.id === id);
    if (index === -1) return undefined;

    const removed = this.messages.splice(index, 1)[0];
    this.notify();
    return removed;
  }

  /**
   * Update a message's content and component by ID
   */
  update(
    id: number,
    content: string,
    component: Component,
  ): MessageInstance | undefined {
    const message = this.messages.find((m) => m.id === id);
    if (!message) return undefined;

    message.content = content;
    message.component = component;
    this.notify();
    return message;
  }

  /**
   * Rewrite a message's promptIndex. Used by the queued-prompt collapse
   * in submitPrompt() to take the slot freed when the optimistic local
   * echo is removed: the queued_user the server emitted inherits the
   * freed slot so tab numbers stay contiguous and `hasPromptIndex`
   * doesn't see a hole. Returns the updated message (or undefined
   * when no row matches the id).
   */
  setPromptIndex(id: number, promptIndex: number): MessageInstance | undefined {
    const message = this.messages.find((m) => m.id === id);
    if (!message) return undefined;
    message.promptIndex = promptIndex;
    this.notify();
    return message;
  }

  /**
   * Get all messages
   */
  getMessages(): MessageInstance[] {
    return [...this.messages];
  }

  /**
   * Get messages filtered by type
   */
  getByType(type: MessageType): MessageInstance[] {
    return this.messages.filter((m) => m.type === type);
  }

  /**
   * Get the most recent in-progress message, if any
   */
  getInProgress(): MessageInstance | undefined {
    return this.messages.find((m) => m.type === "in_progress");
  }

  /**
   * Remove all messages of a specific type
   */
  removeByType(type: MessageType): MessageInstance[] {
    const removed = this.messages.filter((m) => m.type === type);
    this.messages = this.messages.filter((m) => m.type !== type);
    if (removed.length > 0) {
      this.notify();
    }
    return removed;
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
    this.activePromptIndex = undefined;
    this.notify();
  }

  /**
   * Subscribe to message store changes
   * Returns an unsubscribe function
   */
  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Internal notification to all subscribers
   */
  private notify(): void {
    const snapshot = this.getMessages();
    for (const callback of this.subscribers) {
      callback(snapshot);
    }
  }
}

// Singleton instance.
//
// maxMessages caps the history so long sessions don't grow unbounded — the
// store keeps full tool-result strings in each message's Component, so
// letting the array grow for the process lifetime is what made hour-long
// sessions degrade. Default keeps ~2000 messages, roughly the last few
// hundred turns; the virtual list only renders the visible window anyway.
const DEFAULT_MAX_MESSAGES = 2000;
export const messageStore = new MessageStoreImpl({
  maxMessages: DEFAULT_MAX_MESSAGES,
});

// Helper functions that delegate to the store
export function addMessage(
  type: MessageType,
  content: string,
  component: Component,
  queueId?: string,
): MessageInstance {
  return messageStore.add(type, content, component, queueId);
}

export function removeMessage(id: number): MessageInstance | undefined {
  return messageStore.remove(id);
}

export function getMessages(): MessageInstance[] {
  return messageStore.getMessages();
}

export function getInProgress(): MessageInstance | undefined {
  return messageStore.getInProgress();
}

export function updateMessage(
  id: number,
  content: string,
  component: Component,
): MessageInstance | undefined {
  return messageStore.update(id, content, component);
}

/**
 * Rewrite a message's promptIndex. Used by submitPrompt() to take the
 * slot freed when the optimistic local echo is dropped after the
 * server parks the prompt in the queue — see `setPromptIndex` on the
 * store for the rationale.
 */
export function setMessagePromptIndex(
  id: number,
  promptIndex: number,
): MessageInstance | undefined {
  return messageStore.setPromptIndex(id, promptIndex);
}

/**
 * Flip a queued_user row to a live user row in place — see `promoteQueued`
 * on the store. Used by the `message_started` stream handler.
 */
export function promoteQueuedMessage(
  id: number,
  component: Component,
): MessageInstance | undefined {
  return messageStore.promoteQueued(id, component);
}

export function clearMessages(): void {
  messageStore.clear();
}

export function subscribeToMessages(callback: Subscriber): () => void {
  return messageStore.subscribe(callback);
}

let messageIdCounter = 0;
export function createMessageId(): number {
  return ++messageIdCounter;
}

export function getMessage(id: number): MessageInstance | undefined {
  return messageStore.getMessages().find((m) => m.id === id);
}

export function getMessagesByType(type: MessageType): MessageInstance[] {
  return messageStore.getByType(type);
}

/**
 * Look up a queued message by its server-assigned id (spec 2026-08-05).
 * Used by the message_dequeued handler to drop the right transcript row,
 * and by Ctrl+Backspace to find the target before calling session.dequeue.
 */
export function getMessageByQueueId(
  queueId: string,
): MessageInstance | undefined {
  return messageStore.getMessages().find((m) => m.queueId === queueId);
}

/**
 * Number of tabs the strip should show: the highest 1-based prompt
 * index currently represented in the store. We deliberately don't
 * count `user` + `queued_user` rows directly, because the optimistic
 * local echo + queued-prompt collapse in submitPrompt() can leave
 * fewer rows than submitted prompts while the highest index still
 * matches the count of user submissions. Using `maxPromptIndex` keeps
 * the strip in sync with whatever's actually been sent, including
 * across gaps left by the collapse path.
 */
export function getPromptCount(): number {
  let max = 0;
  for (const m of messageStore.getMessages()) {
    if (m.promptIndex !== undefined && m.promptIndex > max) {
      max = m.promptIndex;
    }
  }
  return max;
}

/**
 * Resolve a 1-based prompt index to the first matching message. Returns
 * the user message itself; mid-turn rows that share the same index come
 * after it in the message list. Returns undefined when no prompt with
 * that index exists.
 */
export function findPromptMessageIndex(
  promptIndex: number,
): number | undefined {
  const list = messageStore.getMessages();
  for (let i = 0; i < list.length; i++) {
    const m = list[i]!;
    if (
      (m.type === "user" || m.type === "queued_user") &&
      m.promptIndex === promptIndex
    ) {
      return i;
    }
  }
  return undefined;
}

/**
 * Which prompt is currently in focus. The tab strip and the virtual list
 * both read this; the index.ts Left/Right key handlers and click handlers
 * write to it via `setActivePromptIndex`.
 */
export function getActivePromptIndex(): number | undefined {
  return messageStore.getActivePromptIndex();
}

/**
 * Switch the active tab. Pass a 1-based prompt index; out-of-range values
 * are silently ignored (keeps stale input from yanking the user into an
 * empty pane).
 */
export function setActivePromptIndex(promptIndex: number): void {
  messageStore.setActivePromptIndex(promptIndex);
}

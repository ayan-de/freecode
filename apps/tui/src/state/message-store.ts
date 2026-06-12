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
  ): MessageInstance {
    const message: MessageInstance = {
      id: this.generateId(),
      type,
      content,
      component,
      timestamp: Date.now(),
    };

    this.messages.push(message);

    // Cap memory usage if limit set
    if (this.maxMessages && this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }

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

// Singleton instance
export const messageStore = new MessageStoreImpl();

// Helper functions that delegate to the store
export function addMessage(
  type: MessageType,
  content: string,
  component: Component,
): MessageInstance {
  return messageStore.add(type, content, component);
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

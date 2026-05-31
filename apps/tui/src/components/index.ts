import type { Component } from "@earendil-works/pi-tui";
import {
  addMessage,
  removeMessage,
  getInProgress,
  subscribeToMessages,
  clearMessages,
  updateMessage,
} from "../state/message-store.js";
import { createMessageComponent } from "./message-row.js";
import type { MessageType, MessageInstance } from "./message-types.js";

/**
 * Add a user message to the store and return the message instance
 */
export function createUserMessage(content: string): MessageInstance {
  const component = createMessageComponent("user", content);
  return addMessage("user", content, component);
}

/**
 * Add an assistant message to the store and return the message instance
 */
export function createAssistantMessage(content: string): MessageInstance {
  const component = createMessageComponent("assistant", content);
  return addMessage("assistant", content, component);
}

/**
 * Add a system message to the store and return the message instance
 */
export function createSystemMessage(content: string): MessageInstance {
  const component = createMessageComponent("system", content);
  return addMessage("system", content, component);
}

/**
 * Add an in-progress message to the store and return the message instance
 */
export function createInProgressMessage(
  phrase: string,
  inputTokens = 0,
  outputTokens = 0,
  contextLimit = 0,
  turns = 1
): MessageInstance {
  const startTime = Date.now();
  const component = createMessageComponent("in_progress", phrase, startTime, inputTokens, outputTokens, contextLimit, turns);
  return addMessage("in_progress", phrase, component);
}

/**
 * Remove a message by ID from the store
 */
export function removeMessageById(id: number): MessageInstance | undefined {
  return removeMessage(id);
}

/**
 * Update an in-progress message with new token counts
 */
export function updateInProgressMessage(
  id: number,
  phrase: string,
  inputTokens: number,
  outputTokens: number,
  contextLimit: number,
  startTime: number,
  turns: number
): MessageInstance | undefined {
  const component = createMessageComponent("in_progress", phrase, startTime, inputTokens, outputTokens, contextLimit, turns);
  return updateMessage(id, phrase, component);
}

/**
 * Get the current in-progress message, if any
 */
export function getPendingInProgress(): MessageInstance | undefined {
  return getInProgress();
}

/**
 * Subscribe to message store changes
 */
export function onMessagesChange(callback: (messages: MessageInstance[]) => void): () => void {
  return subscribeToMessages(callback);
}

export { subscribeToMessages };

/**
 * Clear all messages from the store
 */
export function clearAllMessages(): void {
  clearMessages();
}

// Re-export types for convenience
export type { MessageInstance, MessageType } from "./message-types.js";
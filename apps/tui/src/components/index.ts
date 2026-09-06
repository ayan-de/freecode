import type { Component } from "@earendil-works/pi-tui";
import type { SerializedMessage } from "@thisisayande/freecode-shared";
import {
  addMessage,
  removeMessage,
  getInProgress,
  subscribeToMessages,
  clearMessages,
  updateMessage,
  getMessages,
  getMessageByQueueId,
} from "../state/message-store.js";
import {
  createMessageComponent,
  ThinkingMessage,
  StreamingAssistantMessage,
} from "./message-row.js";
import type { MessageType, MessageInstance } from "./message-types.js";
import { ToolProgressMessage } from "./tool-progress-message.js";
import { ToolResultMessage } from "./tool-result-message.js";
import { ToolGroupMessage } from "./tool-group-message.js";

/**
 * Add a user message to the store and return the message instance
 */
export function createUserMessage(content: string): MessageInstance {
  sealToolGroups();
  const component = createMessageComponent("user", content);
  return addMessage("user", content, component);
}

/**
 * Add a queued user message to the store (spec 2026-08-05). `queueId` is the
 * server-assigned id from the `message_queued` stream event; the TUI keeps it
 * on the message so `session.dequeue` and Ctrl+Backspace can target the right
 * row even after the local store id has rotated.
 */
export function createQueuedUserMessage(
  content: string,
  queueId: string,
): MessageInstance {
  const component = createMessageComponent("queued_user", content);
  return addMessage("queued_user", content, component, queueId);
}

/**
 * Promote a queued_user row to a normal user message in place — used when
 * the queued prompt transitions from "waiting" to "in flight". The local
 * store id stays the same so the virtual list does not reflow, and the
 * component swap is what the renderer picks up on the next paint.
 */
export function promoteQueuedToUser(queueId: string): MessageInstance | undefined {
  const existing = getMessageByQueueId(queueId);
  if (!existing || existing.type !== "queued_user") return existing;
  const component = createMessageComponent("user", existing.content);
  return updateMessage(existing.id, existing.content, component);
}

/**
 * Add an assistant message to the store and return the message instance
 */
export function createAssistantMessage(content: string): MessageInstance {
  sealToolGroups();
  const component = createMessageComponent("assistant", content);
  return addMessage("assistant", content, component);
}

// The assistant row currently streaming in, if any. One per internal turn:
// the turn-end `text` snapshot settles it, and the next turn's first delta
// starts a fresh row — which is how prose emitted between tool calls stays
// in the transcript instead of being dropped.
let liveAssistant: {
  instance: MessageInstance;
  component: StreamingAssistantMessage;
} | null = null;

/**
 * Append a streamed `text_delta` chunk, creating the live assistant row on
 * the first delta of an internal turn.
 */
export function appendAssistantDelta(delta: string): MessageInstance {
  if (liveAssistant && !liveAssistant.component.done) {
    liveAssistant.component.append(delta);
    return liveAssistant.instance;
  }
  sealToolGroups();
  const component = new StreamingAssistantMessage(delta);
  const instance = addMessage("assistant", delta, component);
  liveAssistant = { instance, component };
  return instance;
}

/**
 * Settle the live streaming row with the turn's authoritative `text`
 * snapshot. With no live row and a snapshot in hand (the non-streaming
 * provider path emits no deltas), the snapshot renders as a settled
 * assistant message. Without either, this is a no-op — it doubles as the
 * "close any dangling stream" call on the abort/error paths.
 */
export function finalizeAssistantText(content?: string): MessageInstance | null {
  if (liveAssistant) {
    const { instance, component } = liveAssistant;
    liveAssistant = null;
    component.finalize(content);
    // Same component, refreshed content — keeps message.content truthful for
    // anything reading the store, and the notify re-renders the row settled.
    return updateMessage(instance.id, component.content, component) ?? instance;
  }
  if (content) {
    return createAssistantMessage(`**FreeCode:** ${content}`);
  }
  return null;
}

/**
 * Append a streamed `thinking_delta` chunk into the open thinking block,
 * creating it on the first chunk. The turn-end `thinking` snapshot still
 * flows through createThinkingMessage, which replaces the whole buffer.
 */
export function appendThinkingDelta(
  delta: string,
  startTime?: number,
): MessageInstance {
  const messages = getMessages();
  const lastMessage = messages[messages.length - 1];
  if (
    lastMessage &&
    lastMessage.component instanceof ThinkingMessage &&
    !lastMessage.component.done
  ) {
    lastMessage.component.appendContent(delta);
    return lastMessage;
  }
  sealToolGroups();
  const component = new ThinkingMessage(delta, startTime);
  return addMessage("thinking", delta, component);
}

/**
 * Add a system message to the store and return the message instance.
 * Consecutive "[Recovery] ..." lines (retry attempts, fallback notices)
 * update the previous recovery line in place instead of stacking a new
 * message per attempt.
 */
export function createSystemMessage(content: string): MessageInstance {
  if (content.startsWith("[Recovery]")) {
    const messages = getMessages();
    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage &&
      lastMessage.type === "system" &&
      lastMessage.content.startsWith("[Recovery]")
    ) {
      const component = createMessageComponent("system", content);
      const updated = updateMessage(lastMessage.id, content, component);
      if (updated) return updated;
    }
  }
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
  turns = 1,
  contextTokens?: number,
): MessageInstance {
  const startTime = Date.now();
  const component = createMessageComponent(
    "in_progress",
    phrase,
    startTime,
    inputTokens,
    outputTokens,
    contextLimit,
    turns,
    0,
    contextTokens,
  );
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
  turns: number,
  cachedTokens = 0,
  contextTokens?: number,
): MessageInstance | undefined {
  const component = createMessageComponent(
    "in_progress",
    phrase,
    startTime,
    inputTokens,
    outputTokens,
    contextLimit,
    turns,
    cachedTokens,
    contextTokens,
  );
  return updateMessage(id, phrase, component);
}

export function createToolProgressMessage(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): MessageInstance {
  const component = new ToolProgressMessage({
    toolCallId,
    toolName,
    args,
    outputLines: [],
  });
  return addMessage("tool", toolName, component);
}

/**
 * Closes every open tool group. A user prompt, an assistant reply, or a
 * thinking block ends the run of calls it belongs to, so the next call starts
 * a fresh group below the new message.
 */
export function sealToolGroups(): void {
  for (const msg of getMessages()) {
    if (msg.component instanceof ToolGroupMessage) msg.component.seal();
  }
}

/**
 * The group still accepting calls, if any. Tool progress rows and the
 * in-progress line are skipped: with parallel tools, a sibling that is still
 * running sits between the group and the result now arriving, and that must
 * not start a second group.
 */
function findOpenToolGroup(): ToolGroupMessage | undefined {
  const messages = getMessages();
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.component instanceof ToolGroupMessage) {
      return msg.component.isSealed ? undefined : msg.component;
    }
    if (msg.component instanceof ToolProgressMessage) continue;
    if (msg.type === "in_progress") continue;
    // Ambient notices (cache status, recovery lines) interleave with tool
    // calls but are not part of the conversation, so they must not chop one
    // run of calls into a group per call.
    if (msg.type === "system") continue;
    return undefined;
  }
  return undefined;
}

export function createToolResultMessage(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  result: string | undefined,
  success: boolean,
  duration_ms?: number,
): MessageInstance {
  const options = { toolCallId, toolName, args, result, success, duration_ms };

  const open = findOpenToolGroup();
  if (open) {
    open.add(options);
    // Same store entry, new content — the list re-renders it in place.
    return updateMessage(
      getMessages().find((m) => m.component === open)!.id,
      toolName,
      open,
    )!;
  }

  const group = new ToolGroupMessage();
  group.add(options);
  return addMessage("tool", toolName, group);
}

/**
 * Create or update a thinking message - yellow/dim yellow text showing LLM reasoning
 */
export function createThinkingMessage(content: string, startTime?: number): MessageInstance {
  const messages = getMessages();
  const lastMessage = messages[messages.length - 1];

  // Update the streaming thinking block in place, preserving its startTime.
  if (lastMessage && lastMessage.component instanceof ThinkingMessage) {
    lastMessage.component.updateContent(content);
    return lastMessage;
  }

  sealToolGroups();
  const component = createMessageComponent("thinking", content, startTime);
  return addMessage("thinking", content, component);
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
export function onMessagesChange(
  callback: (messages: MessageInstance[]) => void,
): () => void {
  return subscribeToMessages(callback);
}

export { subscribeToMessages };

/**
 * Clear all messages from the store
 */
export function clearAllMessages(): void {
  liveAssistant = null;
  clearMessages();
}

/**
 * Load messages from a resumed session into the UI
 */
export function loadSessionMessages(messages: SerializedMessage[]): void {
  for (const msg of messages) {
    let content = "";
    if (msg.role === "user") {
      content = msg.parts
        .map((p) => (p.type === "text" ? p.content || "" : ""))
        .join("");
    } else {
      // assistant message - extract text content
      const textParts = msg.parts.filter((p) => p.type === "text");
      content = textParts.map((p) => p.content || "").join("\n");
    }
    if (content) {
      const label = msg.role === "user" ? "**You:**" : "**FreeCode:**";
      addMessage(
        msg.role,
        content,
        createMessageComponent(msg.role as MessageType, `${label} ${content}`),
      );
    }
  }
}

// Re-export types for convenience
export type { MessageInstance, MessageType } from "./message-types.js";

// Re-export tool message components
export {
  ToolProgressMessage,
  type ToolProgressMessageOptions,
} from "./tool-progress-message.js";
export {
  ToolResultMessage,
  type ToolResultMessageOptions,
} from "./tool-result-message.js";
export { ToolGroupMessage } from "./tool-group-message.js";

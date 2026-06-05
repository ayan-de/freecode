// Re-export from the new store-based architecture
// This file exists for backwards compatibility with any code that imports from it
export { addMessage, removeMessage, clearMessages, createMessageId } from "../state/message-store.js";
export { getMessage, getMessagesByType } from "../state/message-store.js";
import type { MessageType, MessageInstance } from "./message-types.js";
export type { MessageType, MessageInstance };
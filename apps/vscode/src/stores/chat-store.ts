// =============================================================================
// Chat Store — UI state management for VS Code extension
// =============================================================================

import { create } from "zustand";
import type { Message, MessagePart } from "@thisisayande/freecode-shared";

interface ChatStore {
  messages: Message[];
  status: "idle" | "streaming" | "error";
  error: string | null;
  addMessage: (role: "user" | "assistant", parts: MessagePart[]) => void;
  addPartToLastMessage: (part: MessagePart) => void;
  updateLastMessagePart: (index: number, part: MessagePart) => void;
  setStatus: (status: "idle" | "streaming" | "error") => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
}

let messageCounter = 0;

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  status: "idle",
  error: null,

  addMessage: (role, parts) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: `msg-${++messageCounter}`,
          role,
          parts,
          timestamp: Date.now(),
        },
      ],
    })),

  addPartToLastMessage: (part) =>
    set((state) => {
      if (state.messages.length === 0) return state;
      const lastMessage = state.messages[state.messages.length - 1];
      return {
        messages: [
          ...state.messages.slice(0, -1),
          { ...lastMessage, parts: [...lastMessage.parts, part] },
        ],
      };
    }),

  updateLastMessagePart: (index, part) =>
    set((state) => {
      if (state.messages.length === 0) return state;
      const lastMessage = state.messages[state.messages.length - 1];
      const newParts = [...lastMessage.parts];
      newParts[index] = part;
      return {
        messages: [
          ...state.messages.slice(0, -1),
          { ...lastMessage, parts: newParts },
        ],
      };
    }),

  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  clearMessages: () => set({ messages: [], status: "idle", error: null }),
}));
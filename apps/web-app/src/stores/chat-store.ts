import { create } from "zustand";
import type { Message, MessagePart } from "../lib/types";

// Shape mirrors QuestionSpec from packages/shared/src/ipc/protocol.ts. We
// re-declare it here to avoid pulling in a server-only shared package on
// the frontend build.
export interface QuestionSpecLite {
  question: string;
  header?: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
  custom?: boolean;
}

export interface PendingQuestion {
  requestId: string;
  sessionId?: string;
  questions: QuestionSpecLite[];
  /** Set when this prompt has already been resolved on another device. */
  resolved?: "answered" | "rejected";
}

export interface PendingPermission {
  requestId: string;
  sessionId?: string;
  toolName: string;
  args: Record<string, unknown>;
  description: string;
  suggestedRule?: string;
  reason?: string;
  /** Set when this prompt has already been resolved on another device. */
  resolved?: "answered" | "rejected";
}

interface ChatStore {
  messages: Message[];
  status: "idle" | "streaming" | "error";
  error: string | null;
  textSize: "small" | "medium" | "large" | "xlarge";
  /** Currently-pending question prompt, if any. Single-slot: the agent
   *  asks one prompt at a time and the second overwrites the first
   *  (which would be reported by the wire — Phase 4 fix). */
  pendingQuestion: PendingQuestion | null;
  /** Currently-pending permission prompt, if any. */
  pendingPermission: PendingPermission | null;
  addMessage: (role: "user" | "assistant", parts: MessagePart[]) => void;
  addPartToLastMessage: (part: MessagePart) => void;
  updateLastMessagePart: (index: number, part: MessagePart) => void;
  setStatus: (status: "idle" | "streaming" | "error") => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
  setTextSize: (size: "small" | "medium" | "large" | "xlarge") => void;
  setPendingQuestion: (q: PendingQuestion | null) => void;
  setPendingPermission: (p: PendingPermission | null) => void;
  /** Mark the prompt as resolved by another device — caller-side
   *  dismisses the modal on the next render. */
  markQuestionResolved: (requestId: string, kind: "answered" | "rejected") => void;
  markPermissionResolved: (
    requestId: string,
    kind: "answered" | "rejected",
  ) => void;
}

let messageCounter = 0;

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  status: "idle",
  error: null,
  textSize: (localStorage.getItem("freecode-text-size") as any) || "medium",
  pendingQuestion: null,
  pendingPermission: null,

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
  clearMessages: () =>
    set({
      messages: [],
      status: "idle",
      error: null,
      pendingQuestion: null,
      pendingPermission: null,
    }),
  setTextSize: (size) => {
    localStorage.setItem("freecode-text-size", size);
    set({ textSize: size });
  },
  setPendingQuestion: (q) => set({ pendingQuestion: q }),
  setPendingPermission: (p) => set({ pendingPermission: p }),
  markQuestionResolved: (requestId, kind) =>
    set((state) =>
      state.pendingQuestion?.requestId === requestId
        ? { pendingQuestion: { ...state.pendingQuestion, resolved: kind } }
        : state,
    ),
  markPermissionResolved: (requestId, kind) =>
    set((state) =>
      state.pendingPermission?.requestId === requestId
        ? { pendingPermission: { ...state.pendingPermission, resolved: kind } }
        : state,
    ),
}));

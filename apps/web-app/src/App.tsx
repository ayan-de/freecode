// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useChatStore } from "./stores";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Titlebar } from "./components/Titlebar";
import { RightSidebar } from "./components/RightSidebar";
import { SettingsModal } from "./components/SettingsModal";
import { QuestionModal } from "./components/QuestionModal";
import { PermissionModal } from "./components/PermissionModal";
import { PanelLeft, PanelRight } from "lucide-react";
import {
  connectBackend,
  sessionStart,
  sessionSend,
  stopSession,
  registerStreamListener,
  unregisterStreamListener,
  reconnectStream,
  callTool,
  listSessions,
  resumeSession,
  deleteSession,
  type ProviderInfo,
  type ModelInfo,
  type SessionContext,
} from "./ipc-stub";
import { useFreeCodeConfig } from "./hooks/useFreeCodeConfig";
import { markWorking, observeStreamEvent } from "./lib/turn-state";

export const App: React.FC = () => {
  const status = useChatStore((s) => s.status);
  const addMessage = useChatStore((s) => s.addMessage);
  const addPartToLastMessage = useChatStore((s) => s.addPartToLastMessage);
  const updateLastMessagePart = useChatStore((s) => s.updateLastMessagePart);
  const setStatus = useChatStore((s) => s.setStatus);
  const setError = useChatStore((s) => s.setError);
  const clearMessages = useChatStore((s) => s.clearMessages);
  // Spec §4.4 — multi-device approval flow. The store holds at most one
  // pending question and one pending permission; the modal components
  // render based on whichever slot is occupied.
  const pendingQuestion = useChatStore((s) => s.pendingQuestion);
  const pendingPermission = useChatStore((s) => s.pendingPermission);
  const setPendingQuestion = useChatStore((s) => s.setPendingQuestion);
  const setPendingPermission = useChatStore((s) => s.setPendingPermission);
  const markQuestionResolved = useChatStore((s) => s.markQuestionResolved);
  const markPermissionResolved = useChatStore((s) => s.markPermissionResolved);

  // Connection states
  const [connState, setConnState] = useState<
    "connecting" | "connected" | "error"
  >("connecting");
  const {
    providers,
    models,
    selectedProvider,
    selectedModel,
    apiKeysStatus,
    changeModel,
    saveApiKey,
  } = useFreeCodeConfig();

  const [projectPath, setProjectPath] = useState(
    "/home/ayande/Project/freecode",
  );
  const [agentMode, setAgentMode] = useState("build");
  const [apiKey, setApiKeyInput] = useState("");

  // Responsive sidebar: default to OPEN on desktop (>=1024px) and CLOSED on
  // mobile. The drawer pattern (lg:relative / fixed inset-y-0) keeps the
  // Sidebar component the same on both; only the initial open state differs.
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  // File mention database pre-fetched on session start
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);

  // Active Session states
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessionsList, setSessionsList] = useState<SessionContext[]>([]);

  // Keep track of tool call IDs to their part index in the last message
  const toolCallPartIndices = useRef<Map<string, number>>(new Map());

  const loadSessionsHistory = useCallback(async () => {
    try {
      const list = await listSessions("");
      const sorted = [...list].sort((a, b) => b.lastTurnAt - a.lastTurnAt);
      setSessionsList(sorted);
    } catch (err) {
      console.error("Failed to load session history:", err);
    }
  }, []);

  // Connect Backend on load
  useEffect(() => {
    connectBackend()
      .then(() => {
        setConnState("connected");
      })
      .catch(() => {
        setConnState("error");
      });

    // Spec §5.2 surface 2 — the Android shell pushes ConnectivityManager
    // changes in through this global. Reconnecting on the rising edge
    // beats waiting for TCP to notice a cell↔wifi handover, which can
    // take minutes.
    (window as any).__freecodeOnNetworkChanged = (available: boolean) => {
      if (available) reconnectStream();
    };

    return () => {
      unregisterStreamListener();
      delete (window as any).__freecodeOnNetworkChanged;
    };
  }, []);

  // Fetch session history when connected
  useEffect(() => {
    if (connState === "connected") {
      loadSessionsHistory();
    }
  }, [connState, loadSessionsHistory]);

  // Cycle agent mode on Shift+Tab (capture phase to intercept before textarea)
  useEffect(() => {
    const MODES = ["plan", "build", "review", "explore", "danger"] as const;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        setAgentMode((prev) => {
          const idx = MODES.indexOf(prev as (typeof MODES)[number]);
          return MODES[(idx + 1) % MODES.length];
        });
      }
    };
    document.addEventListener("keydown", handleKeyDown, true); // capture phase
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

// Handle stream events from CLI
  const handleStreamEvent = useCallback(
    (event: any) => {
      // Spec §5.3 — keep the Android foreground service alive across
      // `working` AND `blocked`. Runs before any rendering so a prompt
      // escalates the notification even if rendering later throws.
      observeStreamEvent(event);

      const currentMessages = useChatStore.getState().messages;
      const lastMsg = currentMessages[currentMessages.length - 1];

      // Spec §4.4 — incoming prompts. These don't touch the message
      // list; they fill a slot in the store and the modal components
      // render. Resolution broadcasts below dismiss the modal on this
      // device too, so the race-loser closes cleanly.
      if (event.type === "question_asked") {
        setPendingQuestion({
          requestId: event.requestId,
          sessionId: event.sessionId,
          questions: event.questions,
        });
        return;
      }
      if (event.type === "permission_asked") {
        setPendingPermission({
          requestId: event.requestId,
          sessionId: event.sessionId,
          toolName: event.toolName,
          args: event.args || {},
          description: event.description,
          suggestedRule: event.suggestedRule,
          reason: event.reason,
        });
        return;
      }
      // Spec §4.2 — the server evicted events before we reconnected.
      // Append a visible marker rather than letting the transcript close
      // silently over the hole. Handled before the assistant-message
      // bootstrap below so a gap that arrives first still lands.
      if (event.type === "stream_gap") {
        const msgs = useChatStore.getState().messages;
        const tail = msgs[msgs.length - 1];
        if (!tail || tail.role !== "assistant") addMessage("assistant", []);
        addPartToLastMessage({
          type: "gap",
          from: Number(event.from) || 0,
          to: Number(event.to) || 0,
        });
        return;
      }
      if (event.type === "question.answered" || event.type === "question.rejected") {
        // Verb-shaped bus event names leak through the bridge. We map
        // them onto the wire shape so a single switch below handles
        // both.
        const kind = event.type === "question.answered" ? "answered" : "rejected";
        markQuestionResolved(event.requestId, kind);
        return;
      }
      if (event.type === "permission.answered" || event.type === "permission.rejected") {
        const kind = event.type === "permission.answered" ? "answered" : "rejected";
        markPermissionResolved(event.requestId, kind);
        return;
      }

      // Ensure we have an assistant message to append parts to
      let activeMsg = lastMsg;
      if (!activeMsg || activeMsg.role !== "assistant") {
        addMessage("assistant", []);
        // Refresh current messages state reference
        const updatedMessages = useChatStore.getState().messages;
        activeMsg = updatedMessages[updatedMessages.length - 1];
      }

      if (event.type === "thinking") {
        const parts = activeMsg.parts;
        const lastPartIndex = parts.length - 1;
        const lastPart = parts[lastPartIndex];

        if (lastPart && lastPart.type === "thinking") {
          updateLastMessagePart(lastPartIndex, {
            type: "thinking",
            content: lastPart.content + event.content,
          });
        } else {
          addPartToLastMessage({
            type: "thinking",
            content: event.content,
          });
        }
      } else if (event.type === "text") {
        const parts = activeMsg.parts;
        const lastPartIndex = parts.length - 1;
        const lastPart = parts[lastPartIndex];

        if (lastPart && lastPart.type === "text") {
          updateLastMessagePart(lastPartIndex, {
            type: "text",
            content: lastPart.content + event.content,
          });
        } else {
          addPartToLastMessage({
            type: "text",
            content: event.content,
          });
        }
      } else if (event.type === "tool_start") {
        const partIndex = activeMsg.parts.length;
        toolCallPartIndices.current.set(event.toolCallId, partIndex);

        addPartToLastMessage({
          type: "tool",
          tool: {
            name: event.toolName,
            args: event.args || {},
          },
        });
      } else if (event.type === "tool_complete") {
        const partIndex = toolCallPartIndices.current.get(event.toolCallId);
        if (partIndex !== undefined) {
          updateLastMessagePart(partIndex, {
            type: "tool",
            tool: {
              name: event.toolName,
              args:
                activeMsg.parts[partIndex] &&
                activeMsg.parts[partIndex].type === "tool"
                  ? (activeMsg.parts[partIndex] as any).tool.args
                  : {},
            },
            result: event.result || (event.success ? "Success" : "Failed"),
          });
        }
      } else if (event.type === "done") {
        setStatus("idle");
        loadSessionsHistory();
      } else if (event.type === "error") {
        setError(event.content);
        setStatus("error");
      }
    },
    [
      addMessage,
      addPartToLastMessage,
      updateLastMessagePart,
      setStatus,
      setError,
      loadSessionsHistory,
      projectPath,
    ],
  );

  const handleStartSession = async (): Promise<string | undefined> => {
    if (!projectPath) {
      alert("Please enter a project path");
      return;
    }

    setStatus("streaming");
    setError(null);
    clearMessages();
    toolCallPartIndices.current.clear();
    setWorkspaceFiles([]);

    try {
      // Set API Key if entered
      if (apiKey) {
        await saveApiKey(selectedProvider, apiKey);
        setApiKeyInput("");
      }

      const session = await sessionStart({
        projectPath,
        provider: selectedProvider,
        model: selectedModel,
        agentMode,
      });

      setSessionId(session.sessionId);
      sessionIdRef.current = session.sessionId;
      registerStreamListener(session.sessionId, handleStreamEvent);
      setStatus("idle");

      // Load files for autocomplete context using glob tool in the background
      try {
        const globResult = await callTool("glob", {
          pattern: "**/*",
          cwd: projectPath,
        });
        if (globResult.success && globResult.output) {
          const files = globResult.output.split("\n").filter(Boolean);
          setWorkspaceFiles(files);
        }
      } catch (e) {
        console.error("Failed to load workspace file tree:", e);
      }

      loadSessionsHistory();
      return session.sessionId;
    } catch (err: any) {
      setError(err.message || "Failed to start session");
      setStatus("error");
      throw err;
    }
  };

  const handleResumeSession = async (sid: string) => {
    setStatus("streaming");
    setError(null);
    clearMessages();
    toolCallPartIndices.current.clear();
    setWorkspaceFiles([]);

    try {
      if (sessionId && sessionId !== sid) {
        await stopSession(sessionId).catch(() => {});
      }

      const resumed = await resumeSession(sid);

      setSessionId(resumed.sessionId);
      sessionIdRef.current = resumed.sessionId;

      useChatStore.setState({ messages: resumed.messages });

      registerStreamListener(resumed.sessionId, handleStreamEvent);
      setStatus("idle");

      // Load files for autocomplete context using glob tool in the background
      try {
        const globResult = await callTool("glob", {
          pattern: "**/*",
          cwd: projectPath,
        });
        if (globResult.success && globResult.output) {
          const files = globResult.output.split("\n").filter(Boolean);
          setWorkspaceFiles(files);
        }
      } catch (e) {
        console.error("Failed to load workspace file tree:", e);
      }

      loadSessionsHistory();
    } catch (err: any) {
      setError(err.message || "Failed to resume session");
      setStatus("error");
    }
  };

  const handleDeleteSession = async (sid: string) => {
    try {
      await deleteSession(sid);
      if (sid === sessionId) {
        await handleReset();
      } else {
        loadSessionsHistory();
      }
    } catch (err: any) {
      console.error("Failed to delete session:", err);
    }
  };

  const handleSend = async (message: string) => {
    let activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      try {
        activeSessionId = await handleStartSession();
        if (!activeSessionId) return;
      } catch (err) {
        return;
      }
    }

    addMessage("user", [{ type: "text", content: message }]);
    setStatus("streaming");
    setError(null);
    // The turn is live from submit, before any event arrives — the
    // first token can be many seconds away on a cold provider call.
    markWorking();

    try {
      const result = (await sessionSend(
        activeSessionId,
        message,
        selectedModel,
        agentMode,
      )) as any;

      if (result && result.success) {
        const currentMessages = useChatStore.getState().messages;
        const lastMsg = currentMessages[currentMessages.length - 1];

        if (lastMsg && lastMsg.role === "assistant") {
          const hasTextPart = lastMsg.parts.some((p) => p.type === "text");
          if (!hasTextPart && result.content) {
            addPartToLastMessage({
              type: "text",
              content: result.content,
            });
          }
        } else {
          addMessage("assistant", [
            {
              type: "text",
              content: result.content || "Done!",
            },
          ]);
        }
      }
      setStatus("idle");
    } catch (err: any) {
      setError(err.message || "Failed to send message");
      setStatus("error");
    }
  };

  const handleReset = async () => {
    if (sessionId) {
      await stopSession(sessionId).catch(() => {});
    }
    setSessionId(null);
    sessionIdRef.current = null;
    clearMessages();
    setWorkspaceFiles([]);
    toolCallPartIndices.current.clear();
    unregisterStreamListener();
    loadSessionsHistory();
  };

  const isKeySaved = selectedProvider ? apiKeysStatus[selectedProvider] : false;

  return (
    <div className="flex flex-col h-screen w-screen bg-bg-primary overflow-hidden font-sans">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Toggle — visible on every screen size. On mobile the sidebar
            is a drawer (overlay); on desktop it's a persistent column, and
            the toggle collapses it back to a thin rail. */}
        <div className="absolute top-0 left-0 h-10 w-14 flex items-center justify-center z-50">
          <button
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-white/5 transition-colors"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <PanelLeft size={16} className={sidebarOpen ? "text-white" : ""} />
          </button>
        </div>

        {/* Right Toggle — same pattern. */}
        <div className="absolute top-0 right-0 h-10 w-14 flex items-center justify-center z-50">
          <button
            onClick={() => setRightSidebarOpen((prev) => !prev)}
            className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-white/5 transition-colors"
            aria-label={rightSidebarOpen ? "Close panel" : "Open panel"}
          >
            <PanelRight
              size={16}
              className={rightSidebarOpen ? "text-white" : ""}
            />
          </button>
        </div>

        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          sessions={sessionsList}
          activeSessionId={sessionId}
          onSelectSession={handleResumeSession}
          onDeleteSession={handleDeleteSession}
          onNewConversation={handleReset}
          onSettingsClick={() => setSettingsOpen(true)}
        />

        <ChatView
          connState={connState}
          sessionId={sessionId}
          projectPath={projectPath}
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          models={models}
          providers={providers}
          onChangeModel={changeModel}
          status={status}
          onSend={handleSend}
          workspaceFiles={workspaceFiles}
          agentMode={
            agentMode as "plan" | "build" | "review" | "explore" | "danger"
          }
          onChangeMode={setAgentMode}
        />

        <RightSidebar
          isOpen={rightSidebarOpen}
          onClose={() => setRightSidebarOpen(false)}
        />

        <SettingsModal
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />

        {/* Spec §4.4 — approval modals. Mounted at the App root so they
            survive side-panel toggles and shell-navigations. The store
            holds at most one of each; whichever slot is occupied
            renders. */}
        {pendingQuestion && <QuestionModal question={pendingQuestion} />}
        {pendingPermission && (
          <PermissionModal permission={pendingPermission} />
        )}
      </div>
    </div>
  );
};

// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useChatStore } from "./stores";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Titlebar } from "./components/Titlebar";
import { RightSidebar } from "./components/RightSidebar";
import { PanelLeft, PanelRight } from "lucide-react";
import {
  connectBackend,
  sessionStart,
  sessionSend,
  stopSession,
  registerStreamListener,
  unregisterStreamListener,
  callTool,
  listSessions,
  resumeSession,
  deleteSession,
  type ProviderInfo,
  type ModelInfo,
  type SessionContext,
} from "./ipc-stub";
import { useFreeCodeConfig } from "./hooks/useFreeCodeConfig";

export const App: React.FC = () => {
  const status = useChatStore((s) => s.status);
  const addMessage = useChatStore((s) => s.addMessage);
  const addPartToLastMessage = useChatStore((s) => s.addPartToLastMessage);
  const updateLastMessagePart = useChatStore((s) => s.updateLastMessagePart);
  const setStatus = useChatStore((s) => s.setStatus);
  const setError = useChatStore((s) => s.setError);
  const clearMessages = useChatStore((s) => s.clearMessages);

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

  // Responsive sidebar open on mobile
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
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

    return () => {
      unregisterStreamListener();
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
      const currentMessages = useChatStore.getState().messages;
      const lastMsg = currentMessages[currentMessages.length - 1];

      // Ensure we have an assistant message to append parts to
      let activeMsg = lastMsg;
      if (!activeMsg || activeMsg.role !== "assistant") {
        addMessage("assistant", []);
        // Refresh current messages state reference
        const updatedMessages = useChatStore.getState().messages;
        activeMsg = updatedMessages[updatedMessages.length - 1];
      }

      if (event.type === "text" || event.type === "thinking") {
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

  const handleStartSession = async () => {
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
    } catch (err: any) {
      setError(err.message || "Failed to start session");
      setStatus("error");
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
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      alert("Please start a session first");
      return;
    }

    addMessage("user", [{ type: "text", content: message }]);
    setStatus("streaming");
    setError(null);

    try {
      await sessionSend(activeSessionId, message, selectedModel, agentMode);
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
        {/* Absolute Fixed Left Toggle */}
        <div className="absolute top-0 left-0 h-10 w-14 flex items-center justify-center z-50">
          <button
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-white/5 transition-colors"
          >
            <PanelLeft size={16} className={sidebarOpen ? "text-white" : ""} />
          </button>
        </div>

        {/* Absolute Fixed Right Toggle */}
        <div className="absolute top-0 right-0 h-10 w-14 flex items-center justify-center z-50">
          <button
            onClick={() => setRightSidebarOpen((prev) => !prev)}
            className="p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-white/5 transition-colors"
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
      </div>
    </div>
  );
};

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useChatStore } from "./stores";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Titlebar } from "./components/Titlebar";
import {
  connectBackend,
  listProviders,
  listModels,
  getApiKeyStatus,
  setApiKey,
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

export const App: React.FC = () => {
  const status = useChatStore((s) => s.status);
  const addMessage = useChatStore((s) => s.addMessage);
  const addPartToLastMessage = useChatStore((s) => s.addPartToLastMessage);
  const updateLastMessagePart = useChatStore((s) => s.updateLastMessagePart);
  const setStatus = useChatStore((s) => s.setStatus);
  const setError = useChatStore((s) => s.setError);
  const clearMessages = useChatStore((s) => s.clearMessages);

  // Connection states
  const [connState, setConnState] = useState<"connecting" | "connected" | "error">("connecting");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [projectPath, setProjectPath] = useState("/home/ayande/Project/freecode");
  const [agentMode, setAgentMode] = useState("build");
  const [apiKey, setApiKeyInput] = useState("");
  const [apiKeysStatus, setApiKeysStatus] = useState<Record<string, boolean>>({});
  
  // Responsive sidebar open on mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // File mention database pre-fetched on session start
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);

  // Active Session states
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessionsList, setSessionsList] = useState<SessionContext[]>([]);

  // Keep track of tool call IDs to their part index in the last message
  const toolCallPartIndices = useRef<Map<string, number>>(new Map());

  const loadSessionsHistory = useCallback(async (path: string) => {
    if (!path) return;
    try {
      const list = await listSessions(path);
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
        loadProviders();
      })
      .catch(() => {
        setConnState("error");
      });

    return () => {
      unregisterStreamListener();
    };
  }, []);

  // Fetch session history when connected or project path changes
  useEffect(() => {
    if (connState === "connected" && projectPath) {
      loadSessionsHistory(projectPath);
    }
  }, [connState, projectPath, loadSessionsHistory]);

  const loadProviders = async () => {
    try {
      const list = await listProviders();
      setProviders(list);
      if (list.length > 0) {
        setSelectedProvider(list[0].id);
      }
      const keyStatus = await getApiKeyStatus();
      setApiKeysStatus(keyStatus);
    } catch (err) {
      console.error("Failed to load providers:", err);
    }
  };

  // Load models when provider changes
  useEffect(() => {
    if (!selectedProvider) return;
    listModels(selectedProvider)
      .then((list) => {
        setModels(list);
        if (list.length > 0) {
          setSelectedModel(list[0].id);
        } else {
          setSelectedModel("");
        }
      })
      .catch((err) => {
        console.error("Failed to load models:", err);
        setModels([]);
        setSelectedModel("");
      });
  }, [selectedProvider]);

  // Handle stream events from CLI
  const handleStreamEvent = useCallback((event: any) => {
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
            args: activeMsg.parts[partIndex].type === "tool" ? (activeMsg.parts[partIndex] as any).tool.args : {},
          },
          result: event.result || (event.success ? "Success" : "Failed"),
        });
      }
    } else if (event.type === "done") {
      setStatus("idle");
      loadSessionsHistory(projectPath);
    } else if (event.type === "error") {
      setError(event.content);
      setStatus("error");
    }
  }, [addMessage, addPartToLastMessage, updateLastMessagePart, setStatus, setError, loadSessionsHistory, projectPath]);

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
        await setApiKey(selectedProvider, apiKey);
        setApiKeyInput("");
        const keyStatus = await getApiKeyStatus();
        setApiKeysStatus(keyStatus);
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
        const globResult = await callTool("glob", { pattern: "**/*", cwd: projectPath });
        if (globResult.success && globResult.output) {
          const files = globResult.output.split("\n").filter(Boolean);
          setWorkspaceFiles(files);
        }
      } catch (e) {
        console.error("Failed to load workspace file tree:", e);
      }

      loadSessionsHistory(projectPath);
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
        const globResult = await callTool("glob", { pattern: "**/*", cwd: projectPath });
        if (globResult.success && globResult.output) {
          const files = globResult.output.split("\n").filter(Boolean);
          setWorkspaceFiles(files);
        }
      } catch (e) {
        console.error("Failed to load workspace file tree:", e);
      }

      loadSessionsHistory(projectPath);
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
        loadSessionsHistory(projectPath);
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
    loadSessionsHistory(projectPath);
  };

  const isKeySaved = selectedProvider ? apiKeysStatus[selectedProvider] : false;

  return (
    <div className="flex flex-col h-screen w-screen bg-bg-primary overflow-hidden font-sans">
      <Titlebar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          projectPath={projectPath}
          setProjectPath={setProjectPath}
          selectedProvider={selectedProvider}
          setSelectedProvider={setSelectedProvider}
          providers={providers}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          models={models}
          agentMode={agentMode}
          setAgentMode={setAgentMode}
          apiKey={apiKey}
          setApiKeyInput={setApiKeyInput}
          isKeySaved={isKeySaved}
          sessionId={sessionId}
          onStartSession={handleStartSession}
          onResetSession={handleReset}
          status={status}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          sessionsList={sessionsList}
          onResumeSession={handleResumeSession}
          onDeleteSession={handleDeleteSession}
        />
        
        <ChatView
          connState={connState}
          sessionId={sessionId}
          projectPath={projectPath}
          selectedModel={selectedModel}
          status={status}
          onSend={handleSend}
          workspaceFiles={workspaceFiles}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      </div>
    </div>
  );
};

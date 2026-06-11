import React, { useState, useEffect, useRef, useCallback } from "react";
import { useChatStore } from "./stores";
import { MessageList } from "./chat/MessageList";
import { MessageInput } from "./chat/MessageInput";
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
  type ProviderInfo,
  type ModelInfo,
} from "./ipc-stub";
import "./App.css";

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

  // Active Session states
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Keep track of tool call IDs to their part index in the last message
  const toolCallPartIndices = useRef<Map<string, number>>(new Map());

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
    } else if (event.type === "error") {
      setError(event.content);
      setStatus("error");
    }
  }, [addMessage, addPartToLastMessage, updateLastMessagePart, setStatus, setError]);

  const handleStartSession = async () => {
    if (!projectPath) {
      alert("Please enter a project path");
      return;
    }

    setStatus("streaming");
    setError(null);
    clearMessages();
    toolCallPartIndices.current.clear();

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
    } catch (err: any) {
      setError(err.message || "Failed to start session");
      setStatus("error");
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
    toolCallPartIndices.current.clear();
    unregisterStreamListener();
  };

  const isKeySaved = selectedProvider ? apiKeysStatus[selectedProvider] : false;

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="logo-section">
          <div className="logo-icon">F</div>
          <div className="logo-text">FreeCode Web</div>
        </div>

        <div className="sidebar-group">
          <label className="sidebar-label">Project Workspace</label>
          <input
            className="input-field"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="/absolute/path/to/project"
            disabled={!!sessionId}
          />
        </div>

        <div className="sidebar-group">
          <label className="sidebar-label">Provider</label>
          <select
            className="select-field"
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            disabled={!!sessionId}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="sidebar-group">
          <label className="sidebar-label">Model</label>
          <select
            className="select-field"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={!!sessionId || models.length === 0}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </div>

        <div className="sidebar-group">
          <label className="sidebar-label">Agent Mode</label>
          <select
            className="select-field"
            value={agentMode}
            onChange={(e) => setAgentMode(e.target.value)}
            disabled={!!sessionId}
          >
            <option value="build">Build (Full Access)</option>
            <option value="plan">Plan (Read-only / Safe)</option>
            <option value="explore">Explore</option>
            <option value="review">Review</option>
          </select>
        </div>

        <div className="sidebar-group">
          <label className="sidebar-label">
            API Key {isKeySaved && <span style={{ color: "#10b981", fontSize: "10px" }}>(Saved)</span>}
          </label>
          <input
            className="input-field"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={isKeySaved ? "••••••••••••••••" : "Enter API key"}
            disabled={!!sessionId}
          />
        </div>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
          {!sessionId ? (
            <button className="btn-primary" onClick={handleStartSession} disabled={status === "streaming"}>
              Start Session
            </button>
          ) : (
            <button className="btn-secondary" onClick={handleReset}>
              Reset Session
            </button>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="main-chat">
        <div className="chat-header">
          <div className="header-status">
            <div className={`status-indicator ${connState}`} />
            <span style={{ fontWeight: 600 }}>
              {connState === "connected" ? "Connected" : connState === "connecting" ? "Connecting..." : "Disconnected"}
            </span>
          </div>
          {sessionId && (
            <div className="header-info">
              <span>
                <strong>Workspace:</strong> {projectPath}
              </span>
              <span>
                <strong>Model:</strong> {selectedModel}
              </span>
            </div>
          )}
        </div>

        <div className="chat-messages-container">
          <MessageList />
        </div>

        <MessageInput onSend={handleSend} disabled={!sessionId || status === "streaming"} />
      </div>
    </div>
  );
};

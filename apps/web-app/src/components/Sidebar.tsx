import React, { useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import {
  FolderOpen,
  Cpu,
  Layers,
  Key,
  Settings,
  X,
  Play,
  RotateCcw,
  History,
  MessageSquare,
  Trash2,
} from "lucide-react";
import type { ProviderInfo, ModelInfo, SessionContext } from "../ipc-stub";

interface SidebarProps {
  projectPath: string;
  setProjectPath: (val: string) => void;
  selectedProvider: string;
  setSelectedProvider: (val: string) => void;
  providers: ProviderInfo[];
  selectedModel: string;
  setSelectedModel: (val: string) => void;
  models: ModelInfo[];
  agentMode: string;
  setAgentMode: (val: string) => void;
  apiKey: string;
  setApiKeyInput: (val: string) => void;
  isKeySaved: boolean;
  sessionId: string | null;
  onStartSession: () => void;
  onResetSession: () => void;
  status: "idle" | "streaming" | "error";
  isOpen: boolean;
  onClose: () => void;
  
  // History lists and resume handlers
  sessionsList: SessionContext[];
  onResumeSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  projectPath,
  setProjectPath,
  selectedProvider,
  setSelectedProvider,
  providers,
  selectedModel,
  setSelectedModel,
  models,
  agentMode,
  setAgentMode,
  apiKey,
  setApiKeyInput,
  isKeySaved,
  sessionId,
  onStartSession,
  onResetSession,
  status,
  isOpen,
  onClose,
  sessionsList,
  onResumeSession,
  onDeleteSession,
}) => {
  const [activeTab, setActiveTab] = useState<"settings" | "history">("settings");

  const agentModes = [
    { value: "build", label: "Build (Full Access)" },
    { value: "plan", label: "Plan (Read-only / Safe)" },
    { value: "explore", label: "Explore" },
    { value: "review", label: "Review" },
  ];

  const sidebarClasses = `
    fixed inset-y-0 left-0 z-50 w-72 bg-bg-secondary border-r border-border p-5 flex flex-col transition-transform duration-300 ease-in-out
    lg:relative lg:transform-none lg:z-0 lg:w-80 lg:flex
    ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
  `;

  const formatTime = (timestamp: number) => {
    try {
      const diff = Date.now() - timestamp;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "Just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      return new Date(timestamp).toLocaleDateString();
    } catch {
      return "Unknown";
    }
  };

  return (
    <>
      {/* Mobile Sidebar Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <div className={sidebarClasses}>
        {/* Header */}
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 flex items-center justify-center text-white font-bold text-lg">
              F
            </div>
            <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-white to-indigo-200 bg-clip-text text-transparent">
              FreeCode Web
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white rounded-md hover:bg-white/5 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-bg-primary p-1 rounded-lg border border-border mb-6">
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === "settings"
                ? "bg-bg-tertiary text-white shadow-premium"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Settings size={14} /> Settings
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === "history"
                ? "bg-bg-tertiary text-white shadow-premium"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <History size={14} /> History
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 flex flex-col overflow-y-auto pr-1">
          {activeTab === "settings" ? (
            <div className="flex flex-col gap-5">
              {/* Workspace Directory */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <FolderOpen size={14} className="text-indigo-400" /> Workspace Directory
                </label>
                <Input
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  placeholder="/absolute/path/to/project"
                  disabled={!!sessionId}
                />
              </div>

              {/* Provider */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Settings size={14} className="text-indigo-400" /> Provider
                </label>
                <Select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  disabled={!!sessionId}
                  options={providers.map((p) => ({ value: p.id, label: p.name }))}
                />
              </div>

              {/* Model */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Cpu size={14} className="text-indigo-400" /> Model
                </label>
                <Select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={!!sessionId || models.length === 0}
                  options={models.map((m) => ({ value: m.id, label: m.id }))}
                />
              </div>

              {/* Agent Mode */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Layers size={14} className="text-indigo-400" /> Agent Mode
                </label>
                <Select
                  value={agentMode}
                  onChange={(e) => setAgentMode(e.target.value)}
                  disabled={!!sessionId}
                  options={agentModes}
                />
              </div>

              {/* API Key */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Key size={14} className="text-indigo-400" /> API Key{" "}
                  {isKeySaved && (
                    <span className="text-[10px] text-emerald-400 normal-case italic">
                      (saved)
                    </span>
                  )}
                </label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={isKeySaved ? "••••••••••••••••" : "Enter API key"}
                  disabled={!!sessionId}
                />
              </div>
            </div>
          ) : (
            /* History Content */
            <div className="flex flex-col gap-2 h-full">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Recent Sessions
              </span>
              {sessionsList.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-gray-500">
                  <MessageSquare size={24} className="mb-2 opacity-30" />
                  <span className="text-xs">No recent sessions</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {sessionsList.map((sessionItem) => {
                    const isActive = sessionItem.id === sessionId;
                    return (
                      <div
                        key={sessionItem.id}
                        className={`group relative flex items-center justify-between rounded-lg p-2.5 cursor-pointer border transition-all ${
                          isActive
                            ? "bg-indigo-600/10 border-indigo-500/35 text-white"
                            : "bg-bg-tertiary border-border text-gray-300 hover:bg-white/5"
                        }`}
                        onClick={() => onResumeSession(sessionItem.id)}
                      >
                        <div className="flex flex-col truncate pr-6">
                          <span className="text-xs font-semibold truncate">
                            {sessionItem.title || `Session ${sessionItem.id.slice(0, 8)}`}
                          </span>
                          <span className="text-[10px] text-gray-500 mt-0.5">
                            {sessionItem.turnCount} turns · {formatTime(sessionItem.lastTurnAt)}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(sessionItem.id);
                          }}
                          className="absolute right-2 opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="mt-auto pt-4 border-t border-border flex flex-col gap-3">
          {!sessionId ? (
            <Button
              className="w-full"
              onClick={onStartSession}
              disabled={status === "streaming"}
            >
              <Play size={16} className="mr-2 fill-current" /> Start Session
            </Button>
          ) : (
            <Button
              className="w-full"
              variant="secondary"
              onClick={onResetSession}
            >
              <RotateCcw size={16} className="mr-2" /> Reset Session
            </Button>
          )}
        </div>
      </div>
    </>
  );
};

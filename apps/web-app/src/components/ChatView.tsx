import React from "react";
import { MessageList } from "../chat/MessageList";
import { PromptInput } from "./PromptInput";
import { Wifi, WifiOff, Loader } from "lucide-react";
import type { ProviderInfo, ModelInfo } from "../ipc-stub";

interface ChatViewProps {
  connState: "connecting" | "connected" | "error";
  sessionId: string | null;
  projectPath: string;
  selectedModel: string;
  selectedProvider: string;
  models: ModelInfo[];
  providers: ProviderInfo[];
  status: "idle" | "streaming" | "error";
  onSend: (message: string) => void;
  onChangeModel: (providerId: string, modelId: string) => void;
  workspaceFiles: string[];
}

export const ChatView: React.FC<ChatViewProps> = ({
  connState,
  sessionId,
  projectPath,
  selectedModel,
  selectedProvider,
  models,
  providers,
  onChangeModel,
  status,
  onSend,
  workspaceFiles,
}) => {
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-bg-primary">
      {/* Header */}
      <header className="h-10 border-b border-border bg-bg-secondary flex items-center justify-between px-12 z-10">
        <div className="flex items-center gap-3">
          {/* Connection Status */}
          <div className="flex items-center gap-2 text-sm font-semibold">
            {connState === "connected" ? (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <Wifi size={14} /> Connected
              </span>
            ) : connState === "connecting" ? (
              <span className="flex items-center gap-1.5 text-yellow-500">
                <Loader size={14} className="animate-spin" /> Connecting...
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-red-500">
                <WifiOff size={14} /> Disconnected
              </span>
            )}
          </div>
        </div>

        {/* Right Side: Session Metadata & Toggle */}
        <div className="flex items-center gap-3">
          {sessionId && (
            <div className="hidden sm:flex items-center gap-6 text-xs text-gray-400 border-border pr-4">
              <span className="truncate max-w-xs">
                <strong className="text-gray-500 uppercase font-semibold mr-1">
                  Workspace:
                </strong>{" "}
                {projectPath}
              </span>
              <span>
                <strong className="text-gray-500 uppercase font-semibold mr-1">
                  Model:
                </strong>{" "}
                {selectedModel}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Message Feed Container */}
      <div className="relative flex-1 flex flex-col overflow-hidden bg-bg-primary">
        <div className="flex-1 overflow-y-auto pb-32">
          {!sessionId ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto">
              <div className="flex items-center justify-center mb-2">
                <FreeCodeLogo />
              </div>
              {/* <h2 className="text-lg font-bold text-gray-100 mb-2">No Active Session</h2> */}
              <p className="text-sm text-gray-400 leading-relaxed">
                Start a session in the settings sidebar to begin coding and
                interacting with your project.
              </p>
            </div>
          ) : (
            <MessageList />
          )}
        </div>

        {/* Floating Input Area (Fixed to the bottom of ChatView) */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-20 pointer-events-none">
          <div className="shadow-2xl rounded-2xl bg-bg-primary border border-border pointer-events-auto">
            <PromptInput
              onSend={onSend}
              disabled={
                !sessionId ||
                status === "streaming" ||
                connState !== "connected"
              }
              workspaceFiles={workspaceFiles}
              projectPath={projectPath}
              selectedModel={selectedModel}
              selectedProvider={selectedProvider}
              models={models}
              providers={providers}
              onChangeModel={onChangeModel}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// FreeCode Logo
const FreeCodeLogo = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 286 60"
    width="286"
    height="60"
  >
    <style>
      {`
        .logo-left { font: bold 14px monospace; fill: #F5C71A; white-space: pre; }
        .logo-right { font: bold 14px monospace; fill: #C2990F; white-space: pre; }
      `}
    </style>
    <text x="0" y="15">
      <tspan className="logo-left">█▀▀ █▀▀█ █▀▀ █▀▀ </tspan><tspan className="logo-right">█▀▀ █▀▀█ █▀▀▄ █▀▀</tspan>
    </text>
    <text x="0" y="32">
      <tspan className="logo-left">█▀▀ █▄▄▀ █▀▀ █▀▀ </tspan><tspan className="logo-right">█   █  █ █  █ █▀▀</tspan>
    </text>
    <text x="0" y="49">
      <tspan className="logo-left">▀   ▀ ▀▀ ▀▀▀ ▀▀▀ </tspan><tspan className="logo-right">▀▀▀ ▀▀▀▀ ▀▀▀  ▀▀▀</tspan>
    </text>
  </svg>
);

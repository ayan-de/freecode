import React, { useState } from "react";
import { X, Sliders, Shield, Laptop, Eye, HelpCircle } from "lucide-react";
import { useChatStore } from "../stores";
import { useFreeCodeConfig } from "../hooks/useFreeCodeConfig";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const textSize = useChatStore((state) => state.textSize);
  const setTextSize = useChatStore((state) => state.setTextSize);
  const [activeTab, setActiveTab] = useState<string>("appearance");

  // Model configuration hook
  const {
    providers,
    models,
    selectedProvider,
    selectedModel,
    changeModel,
    isLoading: configLoading,
  } = useFreeCodeConfig();

  if (!isOpen) return null;

  const menuItems = [
    { id: "general", label: "General", icon: Sliders, disabled: true },
    { id: "account", label: "Account", icon: HelpCircle, disabled: true },
    { id: "permissions", label: "Permissions", icon: Shield, disabled: true },
    { id: "appearance", label: "Appearance", icon: Eye, disabled: false },
    { id: "models", label: "Models", icon: Laptop, disabled: false },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      {/* Modal Box */}
      <div className="relative w-full max-w-3xl h-[480px] bg-[#121318] border border-border rounded-xl shadow-premium flex overflow-hidden text-gray-200">
        
        {/* Left internal sidebar */}
        <div className="w-56 border-r border-border bg-black/20 p-5 flex flex-col gap-1">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 px-2">
            Settings
          </div>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeTab;
            return (
              <button
                key={item.id}
                disabled={item.disabled}
                onClick={() => !item.disabled && setActiveTab(item.id)}
                className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  isActive
                    ? "bg-white/10 text-white"
                    : item.disabled
                    ? "text-gray-500 cursor-not-allowed opacity-50"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right content area */}
        <div className="flex-1 p-8 flex flex-col relative bg-[#121318]">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>

          {/* Appearance Tab */}
          {activeTab === "appearance" && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white mb-2">Appearance</h2>
                <p className="text-sm text-gray-400">
                  Configure the display and text size preferences for your chat session.
                </p>
              </div>

              <div className="flex-1 flex flex-col gap-6">
                <div className="p-5 bg-white/[0.02] rounded-lg border border-border flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold text-white">Chat Text Size</label>
                    <span className="text-xs text-gray-400">
                      Select the font size for user prompts and AI assistant responses.
                    </span>
                  </div>
                  <select
                    value={textSize}
                    onChange={(e) => setTextSize(e.target.value as any)}
                    className="select-field"
                    style={{ width: "220px", marginTop: "4px" }}
                  >
                    <option value="small">Small (13px)</option>
                    <option value="medium">Medium (15px)</option>
                    <option value="large">Large (17px)</option>
                    <option value="xlarge">Extra Large (19px)</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Models Tab */}
          {activeTab === "models" && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white mb-2">Models</h2>
                <p className="text-sm text-gray-400">
                  Select the AI model to use for your chat sessions.
                </p>
              </div>

              <div className="flex-1 flex flex-col gap-6">
                {configLoading ? (
                  <div className="p-5 bg-white/[0.02] rounded-lg border border-border">
                    <p className="text-sm text-gray-400">Loading models...</p>
                  </div>
                ) : providers.length === 0 ? (
                  <div className="p-5 bg-white/[0.02] rounded-lg border border-border">
                    <p className="text-sm text-gray-400">
                      No providers configured. Add an API key in your FreeCode CLI config.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Provider Selection */}
                    <div className="p-5 bg-white/[0.02] rounded-lg border border-border flex flex-col gap-4">
                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-semibold text-white">Provider</label>
                        <span className="text-xs text-gray-400">
                          Select the AI provider to use.
                        </span>
                      </div>
                      <select
                        value={selectedProvider}
                        onChange={async (e) => {
                          const providerId = e.target.value;
                          const providerModels = await (async () => {
                            const { listModels } = await import("../ipc-stub");
                            return listModels(providerId);
                          })();
                          if (providerModels.length > 0) {
                            changeModel(providerId, providerModels[0].id);
                          }
                        }}
                        className="select-field"
                        style={{ width: "220px", marginTop: "4px" }}
                      >
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Model Selection */}
                    <div className="p-5 bg-white/[0.02] rounded-lg border border-border flex flex-col gap-4">
                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-semibold text-white">Model</label>
                        <span className="text-xs text-gray-400">
                          Select the AI model to use for chat sessions.
                        </span>
                      </div>
                      <select
                        value={selectedModel}
                        onChange={(e) => {
                          changeModel(selectedProvider, e.target.value);
                        }}
                        className="select-field"
                        style={{ width: "220px", marginTop: "4px" }}
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

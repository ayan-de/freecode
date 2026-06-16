import React from "react";
import { X, Sliders, Shield, Laptop, Eye, HelpCircle } from "lucide-react";
import { useChatStore } from "../stores";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const textSize = useChatStore((state) => state.textSize);
  const setTextSize = useChatStore((state) => state.setTextSize);

  if (!isOpen) return null;

  const menuItems = [
    { id: "general", label: "General", icon: Sliders, disabled: true },
    { id: "account", label: "Account", icon: HelpCircle, disabled: true },
    { id: "permissions", label: "Permissions", icon: Shield, disabled: true },
    { id: "appearance", label: "Appearance", icon: Eye, disabled: false },
    { id: "models", label: "Models", icon: Laptop, disabled: true },
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
            const isActive = item.id === "appearance";
            return (
              <button
                key={item.id}
                disabled={item.disabled}
                className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-gray-500 cursor-not-allowed opacity-50"
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

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">Appearance</h2>
            <p className="text-sm text-gray-400">
              Configure the display and text size preferences for your chat session.
            </p>
          </div>

          {/* Settings Section */}
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
        </div>
      </div>
    </div>
  );
};

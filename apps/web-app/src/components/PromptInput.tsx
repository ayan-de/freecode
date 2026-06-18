import React, { useState, useEffect, useRef, useCallback } from "react";
import { Send, File, Plus, ChevronUp, Mic } from "lucide-react";
import { listModels, type ProviderInfo, type ModelInfo } from "../ipc-stub";
import { MODES, MODE_COLORS_CSS, type AgentMode } from "../themes";
import { ModeButton } from "./ui/ModeButton";
import { useChatStore } from "../stores";

interface PromptInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  workspaceFiles: string[];
  projectPath: string;
  selectedModel: string;
  selectedProvider: string;
  models: ModelInfo[];
  providers: ProviderInfo[];
  onChangeModel: (providerId: string, modelId: string) => void;
  agentMode: AgentMode;
  onChangeMode: (mode: AgentMode) => void;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  onSend,
  disabled,
  workspaceFiles,
  projectPath,
  selectedModel,
  selectedProvider,
  models,
  providers,
  onChangeModel,
  agentMode,
  onChangeMode,
}) => {
  const [value, setValue] = useState("");
  const textSize = useChatStore((s) => s.textSize);
  const fontSizeMap = {
    small: "13px",
    medium: "15px",
    large: "17px",
    xlarge: "19px",
  };
  const fontSize = fontSizeMap[textSize] || "15px";
  const [suggestionState, setSuggestionState] = useState<{
    isOpen: boolean;
    query: string;
    triggerIndex: number;
    filtered: string[];
    selectedIndex: number;
  }>({
    isOpen: false,
    query: "",
    triggerIndex: -1,
    filtered: [],
    selectedIndex: 0,
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionListRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  // Get mode color for border
  const modeColor = MODE_COLORS_CSS[agentMode] || MODE_COLORS_CSS.build;

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsModelMenuOpen(false);
      }
    };
    if (isModelMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isModelMenuOpen]);

  // Filter files based on query
  useEffect(() => {
    if (!suggestionState.isOpen) return;

    const query = suggestionState.query.toLowerCase();
    const matches = workspaceFiles
      .filter((file) => {
        // Match relative path or basename
        const relative = file.replace(projectPath, "");
        return (
          relative.toLowerCase().includes(query) ||
          file.toLowerCase().includes(query)
        );
      })
      .slice(0, 10); // Limit to top 10 matches

    setSuggestionState((prev) => ({
      ...prev,
      filtered: matches,
      selectedIndex: Math.min(
        prev.selectedIndex,
        Math.max(0, matches.length - 1),
      ),
    }));
  }, [
    suggestionState.query,
    workspaceFiles,
    suggestionState.isOpen,
    projectPath,
  ]);

  // Adjust scroll when selectedIndex changes
  useEffect(() => {
    if (suggestionListRef.current) {
      const activeEl = suggestionListRef.current.children[
        suggestionState.selectedIndex
      ] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [suggestionState.selectedIndex]);

  const handleSubmit = useCallback(() => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue("");
  }, [value, disabled, onSend]);

  const insertSuggestion = (file: string) => {
    const textBefore = value.substring(0, suggestionState.triggerIndex);
    const textAfter = value.substring(textareaRef.current?.selectionStart || 0);

    // Get file basename for display
    const basename = file.split(/[/\\]/).pop() || file;
    // Format as a markdown file link
    const fileLink = ` [${basename}](file://${file}) `;

    const newValue = textBefore + fileLink + textAfter;
    setValue(newValue);

    setSuggestionState({
      isOpen: false,
      query: "",
      triggerIndex: -1,
      filtered: [],
      selectedIndex: 0,
    });

    // Reset focus & cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const cursorPosition = textBefore.length + fileLink.length;
        textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
      }
    }, 10);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestionState.isOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestionState((prev) => ({
          ...prev,
          selectedIndex:
            (prev.selectedIndex + 1) % Math.max(1, prev.filtered.length),
        }));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestionState((prev) => ({
          ...prev,
          selectedIndex:
            (prev.selectedIndex - 1 + prev.filtered.length) %
            Math.max(1, prev.filtered.length),
        }));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected =
          suggestionState.filtered[suggestionState.selectedIndex];
        if (selected) {
          insertSuggestion(selected);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSuggestionState((prev) => ({ ...prev, isOpen: false }));
      }
    } else {
      // Cycle agent mode on Shift+Tab
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        const idx = MODES.indexOf(agentMode);
        onChangeMode(MODES[(idx + 1) % MODES.length]);
        return;
      }
      // Send message with Enter (without Shift)
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setValue(val);

    const selectionStart = e.target.selectionStart || 0;
    const textBeforeCursor = val.substring(0, selectionStart);

    // Look for the last '@' symbol in the word before cursor
    const lastAtIdx = textBeforeCursor.lastIndexOf("@");
    if (lastAtIdx !== -1) {
      const word = textBeforeCursor.substring(lastAtIdx);
      // Ensure the @ is at start of line or preceded by whitespace
      const charBeforeAt =
        lastAtIdx > 0 ? textBeforeCursor[lastAtIdx - 1] : " ";
      const isValidTrigger = /\s/.test(charBeforeAt) && !/\s/.test(word);

      if (isValidTrigger) {
        setSuggestionState((prev) => ({
          ...prev,
          isOpen: true,
          query: word.substring(1),
          triggerIndex: lastAtIdx,
        }));
        return;
      }
    }

    if (suggestionState.isOpen) {
      setSuggestionState((prev) => ({ ...prev, isOpen: false }));
    }
  };

  return (
    <div className="relative w-full flex flex-col">
      {/* Model Selection Dropdown Popover */}
      {isModelMenuOpen && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-2 mb-2 w-72 bg-bg-tertiary/95 border border-border rounded-sm shadow-premium backdrop-blur-md z-30 p-3 flex flex-col gap-3 pointer-events-auto"
        >
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Provider
          </div>
          <div className="flex flex-wrap gap-1.5 pb-2 border-b border-border/50">
            {providers.map((p) => {
              const isActive = p.id === selectedProvider;
              return (
                <button
                  key={p.id}
                  onClick={async () => {
                    const list = await listModels(p.id).catch(() => []);
                    const firstModel = list.length > 0 ? list[0].id : "";
                    onChangeModel(p.id, firstModel);
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    isActive
                      ? "bg-indigo-600 text-white"
                      : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>

          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Model
          </div>
          <div className="flex flex-col max-h-48 overflow-y-auto gap-1">
            {models.length === 0 ? (
              <div className="text-xs text-gray-500 py-1 italic">
                No models available
              </div>
            ) : (
              models.map((m) => {
                const isActive = m.id === selectedModel;
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      onChangeModel(selectedProvider, m.id);
                      setIsModelMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center justify-between ${
                      isActive
                        ? "bg-white/5 text-indigo-400 border border-indigo-500/20"
                        : "text-gray-300 hover:bg-white/5"
                    }`}
                  >
                    <span>{m.name || m.id}</span>
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Autocomplete Suggestion Dropdown */}
      {suggestionState.isOpen && suggestionState.filtered.length > 0 && (
        <div
          ref={suggestionListRef}
          className="absolute bottom-full left-0 right-0 mb-2 max-h-56 overflow-y-auto bg-bg-tertiary/95 border border-border rounded-lg shadow-premium backdrop-blur-md z-30 py-1"
        >
          {suggestionState.filtered.map((file, idx) => {
            const isSelected = idx === suggestionState.selectedIndex;
            const relativePath = file
              .replace(projectPath, "")
              .replace(/^[/\\]/, "");
            const basename = file.split(/[/\\]/).pop() || file;

            return (
              <div
                key={file}
                onClick={() => insertSuggestion(file)}
                onMouseEnter={() =>
                  setSuggestionState((p) => ({ ...p, selectedIndex: idx }))
                }
                className={`px-4 py-2 text-sm cursor-pointer flex items-center justify-between transition-colors ${
                  isSelected
                    ? "bg-indigo-600 text-white"
                    : "text-gray-300 hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <File
                    size={14}
                    className={isSelected ? "text-white" : "text-gray-400"}
                  />
                  <span className="font-medium truncate">{basename}</span>
                  <span
                    className={`text-xs truncate ${
                      isSelected ? "text-indigo-200" : "text-gray-500"
                    }`}
                  >
                    {relativePath}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Input container - border color changes based on agent mode */}
      <div
        className="relative flex flex-col w-full bg-bg-tertiary border rounded-sm transition-all p-2 gap-1"
        style={{
          borderColor: modeColor,
          borderWidth: "1px",
          boxShadow: `0 0 12px 2px ${modeColor}40`,
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Ask anything, @ to mention, / for actions"
          className="w-full min-h-[44px] max-h-40 py-2 px-3 bg-transparent text-gray-100 font-sans placeholder-gray-500 resize-none outline-none"
          style={{ fontSize }}
          rows={1}
        />

        {/* Bottom Toolbar */}
        <div className="flex items-center justify-between px-2 pb-1">
          <div className="flex items-center gap-3">
            <button className="text-gray-400 hover:text-white transition-colors p-1 rounded-sm hover:bg-white/5">
              <Plus size={16} />
            </button>
            <button
              onClick={() => setIsModelMenuOpen((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors py-1 px-2 rounded-sm hover:bg-white/5"
            >
              <span>{selectedModel || "Select Model"}</span>
              <ChevronUp
                size={14}
                className={`transition-transform duration-200 ${isModelMenuOpen ? "rotate-180" : ""}`}
              />
            </button>
            {/* Mode cycling button */}
            <ModeButton agentMode={agentMode} onChangeMode={onChangeMode} />
          </div>

          <div className="flex items-center gap-2">
            {!value.trim() && (
              <button
                disabled={disabled}
                className="w-8 h-8 rounded-sm bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <Mic size={14} />
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={disabled || !value.trim()}
              className="w-8 h-8 rounded-sm text-bg-primary flex items-center justify-center transition-all disabled:opacity-30 disabled:pointer-events-none hover:opacity-90 active:scale-95"
              style={{ backgroundColor: modeColor }}
            >
              <Send size={14} className="stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

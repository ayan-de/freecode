import React, { useState, useEffect, useRef, useCallback } from "react";
import { Send, File, CornerDownLeft } from "lucide-react";

interface PromptInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  workspaceFiles: string[];
  projectPath: string;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  onSend,
  disabled,
  workspaceFiles,
  projectPath,
}) => {
  const [value, setValue] = useState("");
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

  // Filter files based on query
  useEffect(() => {
    if (!suggestionState.isOpen) return;

    const query = suggestionState.query.toLowerCase();
    const matches = workspaceFiles
      .filter((file) => {
        // Match relative path or basename
        const relative = file.replace(projectPath, "");
        return relative.toLowerCase().includes(query) || file.toLowerCase().includes(query);
      })
      .slice(0, 10); // Limit to top 10 matches

    setSuggestionState((prev) => ({
      ...prev,
      filtered: matches,
      selectedIndex: Math.min(prev.selectedIndex, Math.max(0, matches.length - 1)),
    }));
  }, [suggestionState.query, workspaceFiles, suggestionState.isOpen, projectPath]);

  // Adjust scroll when selectedIndex changes
  useEffect(() => {
    if (suggestionListRef.current) {
      const activeEl = suggestionListRef.current.children[suggestionState.selectedIndex] as HTMLElement;
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
          selectedIndex: (prev.selectedIndex + 1) % Math.max(1, prev.filtered.length),
        }));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestionState((prev) => ({
          ...prev,
          selectedIndex:
            (prev.selectedIndex - 1 + prev.filtered.length) % Math.max(1, prev.filtered.length),
        }));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = suggestionState.filtered[suggestionState.selectedIndex];
        if (selected) {
          insertSuggestion(selected);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSuggestionState((prev) => ({ ...prev, isOpen: false }));
      }
    } else {
      // Send message with Cmd+Enter or Ctrl+Enter
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
      const charBeforeAt = lastAtIdx > 0 ? textBeforeCursor[lastAtIdx - 1] : " ";
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
    <div className="relative border-t border-border bg-bg-secondary p-4 flex flex-col gap-2">
      {/* Autocomplete Suggestion Dropdown */}
      {suggestionState.isOpen && suggestionState.filtered.length > 0 && (
        <div
          ref={suggestionListRef}
          className="absolute bottom-full left-4 right-4 mb-2 max-h-56 overflow-y-auto bg-bg-tertiary/95 border border-border rounded-lg shadow-premium backdrop-blur-md z-30 py-1"
        >
          {suggestionState.filtered.map((file, idx) => {
            const isSelected = idx === suggestionState.selectedIndex;
            const relativePath = file.replace(projectPath, "").replace(/^[/\\]/, "");
            const basename = file.split(/[/\\]/).pop() || file;

            return (
              <div
                key={file}
                onClick={() => insertSuggestion(file)}
                onMouseEnter={() => setSuggestionState((p) => ({ ...p, selectedIndex: idx }))}
                className={`px-4 py-2 text-sm cursor-pointer flex items-center justify-between transition-colors ${
                  isSelected ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <File size={14} className={isSelected ? "text-white" : "text-gray-400"} />
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

      {/* Input container */}
      <div className="relative flex items-end bg-bg-tertiary border border-border rounded-lg focus-within:border-indigo-500/50 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Ask a question or type @ to mention a file... (Cmd+Enter to send)"
          className="w-full min-h-[60px] max-h-40 py-3 pl-4 pr-12 bg-transparent text-gray-100 text-sm font-sans placeholder-gray-500 resize-none outline-none"
          rows={1}
        />
        <div className="absolute right-3 bottom-3 flex items-center gap-2">
          <button
            onClick={handleSubmit}
            disabled={disabled || !value.trim()}
            className="w-8 h-8 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      {/* Footer Hint */}
      <div className="flex justify-between text-[11px] text-gray-500 px-1">
        <span>Type <code className="bg-bg-tertiary px-1 py-0.5 rounded text-gray-400 font-mono">@</code> to reference project files</span>
        <span className="flex items-center gap-1">
          <CornerDownLeft size={10} /> Cmd+Enter to send
        </span>
      </div>
    </div>
  );
};

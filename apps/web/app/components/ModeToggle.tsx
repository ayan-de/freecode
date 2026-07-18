"use client";

import { User, Code2 } from "lucide-react";

export type ViewMode = "user" | "dev";

interface ModeToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="fixed top-6 right-6 z-[60] flex items-center gap-1 rounded-full border border-border bg-card/90 p-1 shadow-lg backdrop-blur"
    >
      <button
        role="tab"
        aria-selected={mode === "user"}
        onClick={() => onChange("user")}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
          mode === "user"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <User size={14} />
        User
      </button>
      <button
        role="tab"
        aria-selected={mode === "dev"}
        onClick={() => onChange("dev")}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
          mode === "dev"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Code2 size={14} />
        Dev
      </button>
    </div>
  );
}

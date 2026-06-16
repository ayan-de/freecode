import React from "react";
import { MODES, MODE_COLORS_CSS, type AgentMode } from "../../themes";

interface ModeButtonProps {
  agentMode: AgentMode;
  onChangeMode: (mode: AgentMode) => void;
}

export const ModeButton: React.FC<ModeButtonProps> = ({
  agentMode,
  onChangeMode,
}) => {
  const modeColor = MODE_COLORS_CSS[agentMode];

  return (
    <button
      onClick={() => {
        const idx = MODES.indexOf(agentMode);
        onChangeMode(MODES[(idx + 1) % MODES.length]);
      }}
      className="flex items-center gap-1.5 text-xs font-bold uppercase px-2 py-0 rounded-sm transition-all hover:opacity-80"
      style={{
        backgroundColor: modeColor,
        color: "#000",
      }}
      title="Click to cycle mode"
    >
      {agentMode}
    </button>
  );
};

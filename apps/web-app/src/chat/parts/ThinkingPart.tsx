import React, { useState } from "react";

interface ThinkingPartProps {
  content: string;
}

export const ThinkingPart: React.FC<ThinkingPartProps> = ({ content }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: "rgba(234, 179, 8, 0.02)",
        borderRadius: "8px",
        margin: "12px 0",
        border: "1px solid rgba(234, 179, 8, 0.12)",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "10px 14px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          userSelect: "none",
        }}
      >
        <span style={{ color: "#eab308", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px" }}>
          Thinking Process
        </span>
        <span style={{ color: "rgba(255, 255, 255, 0.4)", fontSize: "12px" }}>{expanded ? "v" : ">"}</span>
      </div>
      {expanded && (
        <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(234, 179, 8, 0.12)" }}>
          <div
            style={{
              whiteSpace: "pre-wrap",
              lineHeight: "1.6",
              fontSize: "13px",
              color: "rgba(255, 255, 255, 0.55)",
              borderLeft: "2px solid rgba(234, 179, 8, 0.4)",
              paddingLeft: "10px",
            }}
          >
            {content}
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState } from "react";

interface ToolPartProps {
  tool: { name: string; args: Record<string, unknown> };
  result?: string;
}

export const ToolPart: React.FC<ToolPartProps> = ({ tool, result }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: "#2d2d2d",
        borderRadius: "4px",
        margin: "8px 0",
        border: "1px solid #404040",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "8px 12px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ color: "#4fc3f7", fontWeight: 500 }}>
          🔧 {tool.name}
        </span>
        <span style={{ color: "#888" }}>{expanded ? "▼" : "▶"}</span>
      </div>
      {expanded && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid #404040" }}>
          <div style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>
            Arguments: {JSON.stringify(tool.args)}
          </div>
          {result && (
            <pre
              style={{
                margin: 0,
                fontSize: "12px",
                fontFamily: "monaco, Consolas, monospace",
                whiteSpace: "pre-wrap",
              }}
            >
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

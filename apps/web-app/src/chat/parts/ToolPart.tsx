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
        background: "rgba(255, 255, 255, 0.02)",
        borderRadius: "8px",
        margin: "12px 0",
        border: "1px solid rgba(255, 255, 255, 0.06)",
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
        <span style={{ color: "#60a5fa", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px" }}>
          <span>🔧</span> {tool.name}
        </span>
        <span style={{ color: "rgba(255, 255, 255, 0.4)", fontSize: "12px" }}>{expanded ? "▼" : "▶"}</span>
      </div>
      {expanded && (
        <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
          <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.4)", marginBottom: "8px" }}>
            Arguments: <code style={{ fontFamily: "var(--font-mono, monospace)", color: "#d4d4d8" }}>{JSON.stringify(tool.args)}</code>
          </div>
          {result && (
            <pre
              style={{
                margin: 0,
                padding: "12px",
                background: "rgba(0, 0, 0, 0.3)",
                borderRadius: "6px",
                border: "1px solid rgba(255, 255, 255, 0.04)",
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                whiteSpace: "pre-wrap",
                color: "#e4e4e7",
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

import React, { useState } from "react";

interface CodePartProps {
  language: string;
  content: string;
}

export const CodePart: React.FC<CodePartProps> = ({ language, content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.25)",
        borderRadius: "8px",
        margin: "12px 0",
        overflow: "hidden",
        border: "1px solid rgba(255, 255, 255, 0.05)",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "6px 14px",
          background: "rgba(255, 255, 255, 0.03)",
          fontSize: "12px",
          color: "rgba(255, 255, 255, 0.4)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        }}
      >
        <span>{language}</span>
        <button
          onClick={handleCopy}
          style={{
            background: "none",
            border: "none",
            color: copied ? "#4caf50" : "rgba(255, 255, 255, 0.4)",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "12px 14px",
          overflow: "auto",
          fontSize: "13px",
          fontFamily: "var(--font-mono, monospace)",
          color: "#e4e4e7",
        }}
      >
        <code>{content}</code>
      </pre>
    </div>
  );
};

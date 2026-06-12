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
        background: "#1e1e1e",
        borderRadius: "4px",
        margin: "8px 0",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "4px 12px",
          background: "#2d2d2d",
          fontSize: "12px",
          color: "#888",
        }}
      >
        <span>{language}</span>
        <button
          onClick={handleCopy}
          style={{
            background: "none",
            border: "none",
            color: copied ? "#4caf50" : "#888",
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
          padding: "12px",
          overflow: "auto",
          fontSize: "13px",
          fontFamily: "monaco, Consolas, monospace",
        }}
      >
        <code>{content}</code>
      </pre>
    </div>
  );
};

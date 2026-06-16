import React from "react";
import type { Message } from "../lib/types";
import { TextPart } from "./parts/TextPart";
import { CodePart } from "./parts/CodePart";
import { ToolPart } from "./parts/ToolPart";

interface MessageProps {
  message: Message;
}

export const ChatMessage: React.FC<MessageProps> = ({ message }) => {
  const isUser = message.role === "user";

  return (
    <div
      style={{
        width: "100%",
        marginBottom: "16px",
      }}
    >
      <div
        style={{
          width: "100%",
          background: isUser ? "rgba(255, 255, 255, 0.03)" : "transparent",
          border: isUser ? "1px solid rgba(255, 255, 255, 0.06)" : "none",
          padding: isUser ? "16px 20px" : "12px 0px",
          borderRadius: isUser ? "8px" : "0px",
          color: "#f3f4f6",
          boxSizing: "border-box",
        }}
      >
        {message.parts.map((part, i) => {
          switch (part.type) {
            case "text":
              return <TextPart key={i} content={part.content} />;
            case "code":
              return (
                <CodePart
                  key={i}
                  language={part.language}
                  content={part.content}
                />
              );
            case "tool":
              return <ToolPart key={i} tool={part.tool} result={part.result} />;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
};

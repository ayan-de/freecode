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
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: "16px",
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          background: isUser ? "#0e639c" : "#2d2d2d",
          padding: "12px 16px",
          borderRadius: "8px",
          color: "#d4d4d4",
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

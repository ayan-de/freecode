import React, { useEffect, useRef } from "react";
import { useChatStore } from "../stores";
import { ChatMessage } from "./Message";

export const MessageList: React.FC = () => {
  const messages = useChatStore((state) => state.messages);
  const status = useChatStore((state) => state.status);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}
      {status === "streaming" && (
        <div
          style={{
            color: "#888",
            fontStyle: "italic",
            padding: "8px 0",
          }}
        >
          🔄 Processing...
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
};

import React from "react";

interface TextPartProps {
  content: string;
}

export const TextPart: React.FC<TextPartProps> = ({ content }) => {
  return (
    <div style={{ whiteSpace: "pre-wrap", lineHeight: "1.5" }}>{content}</div>
  );
};

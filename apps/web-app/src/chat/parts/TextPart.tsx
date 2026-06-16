import React from "react";
import { marked } from "marked";

interface TextPartProps {
  content: string;
}

export const TextPart: React.FC<TextPartProps> = ({ content }) => {
  const htmlContent = marked.parse(content) as string;

  return (
    <div
      className="markdown-content"
      style={{ lineHeight: "1.6" }}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};

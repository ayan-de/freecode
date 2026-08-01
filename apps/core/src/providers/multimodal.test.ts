import assert from "node:assert/strict";
import test from "node:test";
import {
  convertToCoreMessages,
  messagesContainImages,
  providerSupportsVision,
} from "./utils.js";
import type { Message } from "../agent/types.js";

test("multimodal message conversion: passes through image parts to provider format", () => {
  const msg: Message = {
    id: "1",
    role: "user",
    timestamp: Date.now(),
    parts: [
      {
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        mediaType: "image/png",
        altText: "A simple red square",
      },
      { type: "text", content: "What is in this image?" },
    ],
  };

  const result = convertToCoreMessages([msg]);
  assert.equal(result.length, 1);
  assert.equal(Array.isArray(result[0].content), true);
  const content = result[0].content as any[];
  assert.equal(content[0].type, "image");
  assert.equal(
    content[0].image,
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  );
  assert.equal(content[0].mediaType, "image/png");
  assert.equal(content[1].text, "What is in this image?");
});

test("multimodal message conversion: detects images in messages", () => {
  const withImage: Message = {
    id: "1",
    role: "user",
    timestamp: Date.now(),
    parts: [{ type: "image", data: "abc", mediaType: "image/png" }],
  };
  const withoutImage: Message = {
    id: "2",
    role: "user",
    timestamp: Date.now(),
    parts: [{ type: "text", content: "hello" }],
  };

  assert.equal(messagesContainImages([withImage]), true);
  assert.equal(messagesContainImages([withoutImage]), false);
});

test("multimodal message conversion: converts text-only messages to simple string format", () => {
  const msg: Message = {
    id: "1",
    role: "user",
    timestamp: Date.now(),
    parts: [
      { type: "text", content: "Hello" },
      { type: "text", content: "World" },
    ],
  };

  const result = convertToCoreMessages([msg]);
  assert.equal(result.length, 1);
  assert.equal(result[0].content, "Hello\n\nWorld");
});

test("multimodal message conversion: handles mixed text and code parts", () => {
  const msg: Message = {
    id: "1",
    role: "user",
    timestamp: Date.now(),
    parts: [
      { type: "text", content: "Here is the code:" },
      { type: "code", language: "typescript", content: "const x = 1;" },
    ],
  };

  const result = convertToCoreMessages([msg]);
  assert.equal(result.length, 1);
  assert.equal(
    (result[0].content as string).includes("Here is the code:"),
    true,
  );
  assert.equal((result[0].content as string).includes("```typescript"), true);
  assert.equal((result[0].content as string).includes("const x = 1;"), true);
});

test("multimodal message conversion: handles multiple images in a single message", () => {
  const msg: Message = {
    id: "1",
    role: "user",
    timestamp: Date.now(),
    parts: [
      { type: "image", data: "abc123", mediaType: "image/png" },
      { type: "text", content: "Compare these two images" },
      { type: "image", data: "def456", mediaType: "image/jpeg" },
    ],
  };

  const result = convertToCoreMessages([msg]);
  assert.equal(result.length, 1);
  const content = result[0].content as any[];
  assert.equal(content.length, 3);
  assert.equal(content[0].type, "image");
  assert.equal(content[0].image, "abc123");
  assert.equal(content[0].mediaType, "image/png");
  assert.equal(content[1].type, "text");
  assert.equal(content[2].type, "image");
  assert.equal(content[2].image, "def456");
  assert.equal(content[2].mediaType, "image/jpeg");
});

test("multimodal message conversion: keeps tool calls and results when an image is in the conversation", () => {
  const messages: Message[] = [
    {
      id: "1",
      role: "assistant",
      timestamp: Date.now(),
      parts: [
        {
          type: "tool",
          tool: {
            id: "call-1",
            tool: "read",
            args: { filePath: "/tmp/shot.png", asImage: true },
            execution: "sequential",
          },
          result: "Attached shot.png (image/png, 0.1KB) as an image.",
        },
      ],
    },
    {
      id: "2",
      role: "user",
      timestamp: Date.now(),
      parts: [
        { type: "text", content: "Image from the tool call above:" },
        { type: "image", data: "abc123", mediaType: "image/png" },
      ],
    },
  ];

  const result = convertToCoreMessages(messages);

  // assistant(tool-call) -> tool(tool-result) -> user(image)
  assert.equal(result.length, 3);
  assert.equal(result[0].role, "assistant");
  assert.equal((result[0].content as any[])[0].type, "tool-call");
  assert.equal(result[1].role, "tool");
  const toolResult = (result[1].content as any[])[0];
  assert.equal(toolResult.type, "tool-result");
  assert.equal(toolResult.toolCallId, "call-1");
  assert.equal(result[2].role, "user");
  assert.equal((result[2].content as any[])[1].type, "image");
});

test("providerSupportsVision: gates image parts to providers that accept them", () => {
  assert.equal(providerSupportsVision("anthropic"), true);
  assert.equal(providerSupportsVision("openai"), true);
  assert.equal(providerSupportsVision("gemini"), true);
  assert.equal(providerSupportsVision("deepseek"), false);
  assert.equal(providerSupportsVision("minimax"), false);
  assert.equal(providerSupportsVision("zai"), false);
});

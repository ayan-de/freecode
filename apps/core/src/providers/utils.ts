import type { ModelMessage, AssistantModelMessage, ToolModelMessage } from "ai";
import type { Message } from "../agent/types.js";

/**
 * Transforms FreeCode internal Message structures to Vercel AI SDK ModelMessage formats.
 * Correctly splits assistant tool-calls and their results into consecutive assistant and tool messages.
 */
export function convertToCoreMessages(messages: Message[]): ModelMessage[] {
  const coreMessages: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const textParts: string[] = [];
      for (const part of msg.parts) {
        if (part.type === "text") {
          textParts.push(part.content);
        } else if (part.type === "code") {
          textParts.push(`\`\`\`${part.language}\n${part.content}\n\`\`\``);
        }
      }
      coreMessages.push({
        role: "user",
        content: textParts.join("\n\n"),
      });
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: Array<{
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
      }> = [];
      const toolResults: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: { type: "text"; value: string };
      }> = [];

      for (const part of msg.parts) {
        if (part.type === "text") {
          textParts.push(part.content);
        } else if (part.type === "code") {
          textParts.push(`\`\`\`${part.language}\n${part.content}\n\`\`\``);
        } else if (part.type === "tool") {
          toolCalls.push({
            type: "tool-call",
            toolCallId: part.tool.id,
            toolName: part.tool.tool,
            input: part.tool.args,
          });
          if (part.result !== undefined) {
            toolResults.push({
              type: "tool-result",
              toolCallId: part.tool.id,
              toolName: part.tool.tool,
              // AI SDK v6 requires a structured ToolResultOutput, not a raw
              // string — otherwise the ModelMessage[] schema rejects it.
              output: {
                type: "text",
                value:
                  typeof part.result === "string"
                    ? part.result
                    : JSON.stringify(part.result),
              },
            });
          }
        }
      }

      // If both text and tool calls exist, pack them as content parts in assistant message
      if (toolCalls.length > 0) {
        const content: any[] = [];
        if (textParts.length > 0) {
          content.push({ type: "text", text: textParts.join("\n\n") });
        }
        content.push(...toolCalls);
        coreMessages.push({
          role: "assistant",
          content,
        } as AssistantModelMessage);
      } else {
        coreMessages.push({
          role: "assistant",
          content: textParts.join("\n\n"),
        });
      }

      // Append tool results as a separate 'tool' role message immediately following the assistant message
      if (toolResults.length > 0) {
        coreMessages.push({
          role: "tool",
          content: toolResults,
        } as ToolModelMessage);
      }
    }
  }

  return coreMessages;
}

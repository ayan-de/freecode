// =============================================================================
// Provider Response Normalizer
// PRIMARY: Transform raw provider output (HTML/SSE) to canonical format
// INPUT: raw unknown (provider-specific format: HTML text, SSE chunks, JSON)
// OUTPUT: NormalizedResponse { content: AssistantContent[], reasoning?, stopReason }
// TRANSFORMS: ChatGPT text → AssistantContent[] | Claude blocks → AssistantContent[] | Gemini parts → AssistantContent[]
// PURPOSE: Separates provider-specific logic from internal representation
//          Enables adding new providers by adding normalizers without changing parser
// =============================================================================

// =============================================================================
// AssistantContent - Canonical content blocks from AI
// =============================================================================
export type AssistantContent =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

// =============================================================================
// NormalizedResponse - Provider-agnostic internal representation
// =============================================================================
export interface NormalizedResponse {
  content: AssistantContent[];
  reasoning?: string;
  stopReason: "tool_use" | "completed" | "error" | "interrupted";
  raw?: unknown;
}

// =============================================================================
// ProviderNormalizer - Interface for provider-specific normalizers
// =============================================================================
export interface ProviderNormalizer {
  normalize(raw: unknown): NormalizedResponse;
}

// =============================================================================
// ChatGPT Normalizer
// Handles: [TOOL_CALLS]...\ntool:args\n...[/TOOL_CALLS] format
// =============================================================================
export const ChatGPTNormalizer: ProviderNormalizer = {
  normalize(raw: unknown): NormalizedResponse {
    return normalizeChatGPTResponse(raw);
  },
};

// =============================================================================
// Claude Normalizer
// Handles: Anthropic's content blocks format
// =============================================================================
export const ClaudeNormalizer: ProviderNormalizer = {
  normalize(raw: unknown): NormalizedResponse {
    return normalizeClaudeResponse(raw);
  },
};

// =============================================================================
// Gemini Normalizer
// Handles: Google's candidates + parts format
// =============================================================================
export const GeminiNormalizer: ProviderNormalizer = {
  normalize(raw: unknown): NormalizedResponse {
    return normalizeGeminiResponse(raw);
  },
};

// =============================================================================
// Internal Normalization Functions
// =============================================================================

function normalizeChatGPTResponse(raw: unknown): NormalizedResponse {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  const content: AssistantContent[] = [];
  const toolCallRegex = /\[TOOL_CALLS\]([\s\S]*?)\[\/TOOL_CALLS\]/g;
  let match;
  let lastIndex = 0;
  let hasTools = false;

  // Parse text content and tool calls from raw response
  while ((match = toolCallRegex.exec(text)) !== null) {
    // Text before tool block
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index).trim();
      if (textContent) {
        content.push({ type: "text", text: textContent });
      }
    }

    // Parse tool block content
    const toolsStr = match[1];
    const toolLines = toolsStr.split("\n").filter((line) => line.trim());

    for (const line of toolLines) {
      const toolMatch = line.match(/^(\w+):(.+)$/);
      if (toolMatch) {
        const [, toolName, args] = toolMatch;
        content.push({
          type: "tool_use",
          id: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: toolName,
          input: parseArgs(args.trim()),
        });
        hasTools = true;
      }
    }

    lastIndex = toolCallRegex.lastIndex;
  }

  // Text after last tool block
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) {
      content.push({ type: "text", text: remaining });
    }
  }

  return {
    content,
    stopReason: hasTools ? "tool_use" : "completed",
    raw,
  };
}

function normalizeClaudeResponse(raw: unknown): NormalizedResponse {
  const data =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};

  const content: AssistantContent[] = [];

  // Claude uses content blocks: { type: "text" | "tool_use", ... }
  if (Array.isArray(data.content)) {
    for (const block of data.content as Array<Record<string, unknown>>) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text as string });
      } else if (block.type === "tool_use") {
        content.push({
          type: "tool_use",
          id: block.id as string,
          name: block.name as string,
          input: block.input as Record<string, unknown>,
        });
      }
    }
  }

  return {
    content,
    reasoning: data.reasoning as string | undefined,
    stopReason:
      (data.stop_reason as
        | "tool_use"
        | "completed"
        | "error"
        | "interrupted") || "completed",
    raw,
  };
}

function normalizeGeminiResponse(raw: unknown): NormalizedResponse {
  const data =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};

  const content: AssistantContent[] = [];

  // Gemini uses candidates[].content.parts[]
  if (Array.isArray(data.candidates)) {
    for (const candidate of data.candidates as Array<Record<string, unknown>>) {
      const contentData = candidate.content as
        | Record<string, unknown>
        | undefined;
      if (contentData && Array.isArray(contentData.parts)) {
        for (const part of contentData.parts as Array<
          Record<string, unknown>
        >) {
          if (part.text) {
            content.push({ type: "text", text: part.text as string });
          } else if (part.functionCall) {
            const fc = part.functionCall as Record<string, unknown>;
            content.push({
              type: "tool_use",
              id: (fc.id as string) || `tool-${Date.now()}`,
              name: fc.name as string,
              input: (fc.args as Record<string, unknown>) || {},
            });
          }
        }
      }
    }
  }

  return {
    content,
    stopReason: "completed",
    raw,
  };
}

// =============================================================================
// Helper: parseArgs
// Try JSON parse, fallback to wrapping in object
// =============================================================================
function parseArgs(argsStr: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argsStr);
    return typeof parsed === "object" && parsed !== null
      ? parsed
      : { args: argsStr };
  } catch {
    return { args: argsStr };
  }
}

// =============================================================================
// Factory: createNormalizer
// Get appropriate normalizer for provider
// =============================================================================
export function createNormalizer(provider: string): ProviderNormalizer {
  switch (provider) {
    case "chatgpt":
      return ChatGPTNormalizer;
    case "claude":
      return ClaudeNormalizer;
    case "gemini":
      return GeminiNormalizer;
    default:
      return ChatGPTNormalizer;
  }
}

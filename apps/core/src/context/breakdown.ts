// =============================================================================
// Context Breakdown — what is occupying the model's context window, by category.
//
// Backs the `/context` command. The categories mirror how the request is
// actually assembled in agent/loop.ts callProviderOnce():
//
//   system blocks  = PromptCompiler.buildStaticSegments()   (cached prefix)
//                  + compaction summary / memories / todos  (session blocks)
//   tools          = getToolDefs(), sent as native schemas
//   message[0]     = the dynamic project context (file tree + git head + clock)
//   message[1..]   = the conversation
//
// Numbers are estimates (chars/4, the same estimator compaction budgets with),
// because there is no offline tokenizer shared across Anthropic, OpenAI, Gemini
// and MiniMax, and a per-provider network round trip is far too expensive for a
// command you run to *check* your spend. `measuredInputTokens` carries the last
// real provider-reported input count so the caller can show the estimate next
// to ground truth rather than presenting a guess as fact.
// =============================================================================

import type {
  ContextBreakdown,
  ContextSegmentId,
  ContextSegmentStat,
} from "@thisisayande/freecode-shared";
import type { SerializedMessage } from "../session/store.js";
import { PromptCompiler } from "./compiler.js";
import { getFrozenSessionContext } from "./session-context.js";
import { estimateTokenCount } from "../compaction/tokens.js";
import { MemoryService } from "../compaction/service.js";
import { getMemoryGraphService } from "../memory/graph/index.js";
import { renderRetrievedMemories } from "../memory/mem-prompt.js";
import { getToolDefs } from "../tools/defs-cache.js";
import { renderTodoPromptBlock } from "../tools/todo.js";
import { getModelContextLimit } from "../models-dev.js";
import type { AgentMode } from "../agent/types.js";

const MCP_TOOL_PREFIX = "mcp__";

/**
 * Serialized size of a tool as the provider receives it: name, description and
 * the full JSON Schema. The schema is usually the larger half, which is exactly
 * the part a tool-count alone hides.
 */
function toolTokens(tool: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}): number {
  return estimateTokenCount(
    tool.name + tool.description + JSON.stringify(tool.parameters),
  );
}

/** Tokens for one stored message, counting every part the provider will see. */
function messageTokens(message: SerializedMessage): number {
  let total = 0;
  for (const part of message.parts) {
    total += estimateTokenCount(part.content ?? "");
    total += estimateTokenCount(part.result ?? "");
    if (part.tool) {
      total += estimateTokenCount(
        part.tool.name + JSON.stringify(part.tool.args),
      );
    }
    // Images are re-encoded by each provider at wildly different rates, so
    // base64 length / 4 would be a fiction. Skipped, and said so in the UI.
  }
  return total;
}

/**
 * The most recent provider-reported input size. Each request resends the whole
 * conversation, so the last one *is* the occupancy — no summing (same reasoning
 * as AgentLoop.lastMeasuredContextTokens).
 */
function lastMeasuredInput(messages: SerializedMessage[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = messages[i]?.usage?.inputTokens;
    if (typeof tokens === "number" && tokens > 0) return tokens;
  }
  return undefined;
}

export interface BuildContextBreakdownOptions {
  sessionId: string;
  projectPath: string;
  provider: string;
  model?: string;
  agentMode?: AgentMode;
  messages: SerializedMessage[];
}

export async function buildContextBreakdown(
  options: BuildContextBreakdownOptions,
): Promise<ContextBreakdown> {
  const {
    sessionId,
    projectPath,
    provider,
    model,
    agentMode = "build",
    messages,
  } = options;

  // Read the session's frozen project context up front — the compiler needs the
  // project name, and the dynamic-message section below needs the tree/clock.
  const frozen = getFrozenSessionContext(sessionId, projectPath);
  const compiler = new PromptCompiler(projectPath, frozen.ctx.name, agentMode);
  const segments: ContextSegmentStat[] = [];
  const push = (id: ContextSegmentId, label: string, tokens: number): void => {
    if (tokens > 0) segments.push({ id, label, tokens });
  };

  // --- static system blocks -------------------------------------------------
  for (const segment of await compiler.buildStaticSegments(provider, model)) {
    push(segment.id, segment.label, estimateTokenCount(segment.text));
  }

  // --- tool schemas ---------------------------------------------------------
  const tools = getToolDefs();
  let builtinTokens = 0;
  let mcpTokens = 0;
  let mcpCount = 0;
  for (const tool of tools) {
    if (tool.name.startsWith(MCP_TOOL_PREFIX)) {
      mcpTokens += toolTokens(tool);
      mcpCount++;
    } else {
      builtinTokens += toolTokens(tool);
    }
  }
  push("tools", "Tool definitions", builtinTokens);
  push("mcp-tools", "MCP tools", mcpTokens);

  // --- per-turn session blocks ---------------------------------------------
  // Same order the loop assembles them in, minus the transient reminders: those
  // are drained into whichever turn is being built, so at rest there are none.
  const summary = new MemoryService(sessionId).getPromptContext().summary ?? "";
  push("compaction-summary", "Compaction summary", estimateTokenCount(summary));

  // peekMemories, not prepareMemories: pricing the block must not kick a
  // retrieval or a judge call. Empty until the session's first turn resolves.
  const memoryBlock = renderRetrievedMemories(
    getMemoryGraphService(projectPath).peekMemories(sessionId),
  );
  push("memories", "Memories", estimateTokenCount(memoryBlock));
  push(
    "todos",
    "Todo list",
    estimateTokenCount(renderTodoPromptBlock(sessionId)),
  );

  // --- the dynamic first user message --------------------------------------
  push(
    "project-context",
    "Project context",
    estimateTokenCount(
      "Project context:\n\n" +
        compiler.compileDynamicContext(
          frozen.ctx.tree,
          frozen.ctx.gitHead,
          "",
          undefined,
          frozen.clock,
        ),
    ),
  );

  // --- the conversation -----------------------------------------------------
  let messageTotal = 0;
  for (const message of messages) messageTotal += messageTokens(message);
  push("messages", "Messages", messageTotal);

  const usedTokens = segments.reduce((sum, s) => sum + s.tokens, 0);
  const contextLimit = model
    ? await getModelContextLimit(provider, model).catch(() => 0)
    : 0;

  return {
    provider,
    model,
    contextLimit: contextLimit > 0 ? contextLimit : undefined,
    segments,
    usedTokens,
    freeTokens:
      contextLimit > 0 ? Math.max(0, contextLimit - usedTokens) : undefined,
    measuredInputTokens: lastMeasuredInput(messages),
    toolCount: tools.length,
    mcpToolCount: mcpCount,
    messageCount: messages.length,
  };
}

import type { HookRuntime } from "../hooks/runtime.js";
import { createHookRuntime } from "../hooks/runtime.js";
import {
  DEFAULT_COMPACTION_CONFIG,
  type CompactionConfig,
  type CompactionResult,
  type MemoryMessage,
  type MemoryRole,
  type MemoryState,
  type PromptMemoryContext,
} from "./types.js";
import { estimateTokenCount, shouldCompact } from "./tokens.js";
import { selectForCompaction } from "./selector.js";
import { makeSummary, summarizeMessages } from "./summarizer.js";
import type { LlmSummarize } from "./llm-summarizer.js";
import { FileMemoryStorage, type MemoryStorage } from "./storage.js";

export interface CompactOptions {
  // When provided, used to generate the summary; on failure the heuristic
  // summarizer is used instead. The agent loop supplies this with the current
  // provider/model so summaries are real LLM output rather than keyword bullets.
  llmSummarize?: LlmSummarize;
}

interface MemoryServiceOptions {
  config?: Partial<CompactionConfig>;
  storage?: MemoryStorage;
  hooks?: HookRuntime;
}

// ponytail: fixed retry threshold after a hook blocks compaction; make it
// a CompactionConfig field if hooks ever need tighter control.
const BLOCKED_RETRY_GROWTH_TOKENS = 5_000;

export class MemoryService {
  private readonly config: CompactionConfig;
  private readonly storage: MemoryStorage;
  private readonly hooks: HookRuntime;
  private state: MemoryState;
  // Token count at the moment a PreCompact hook last blocked compaction;
  // used to avoid re-attempting (and re-failing) on every message.
  private blockedAtTokenCount?: number;

  constructor(sessionId: string, options: MemoryServiceOptions = {}) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...options.config };
    this.storage = options.storage ?? new FileMemoryStorage();
    this.hooks = options.hooks ?? createHookRuntime();
    this.state = this.storage.load(sessionId) ?? {
      sessionId,
      messages: [],
      summaries: [],
      tokenCount: 0,
      totalCompactions: 0,
    };
  }

  private normalizeContent(role: MemoryRole, content: string): string {
    if (role !== "assistant") return content;
    if (!content.startsWith("Tool ")) return content;
    if (content.length <= this.config.maxToolOutputChars) return content;
    return `${content.slice(0, this.config.maxToolOutputChars)}\n[tool output truncated for memory]`;
  }

  addMessage(role: MemoryRole, content: string): MemoryMessage {
    const normalizedContent = this.normalizeContent(role, content);
    const message: MemoryMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role,
      content: normalizedContent,
      timestamp: Date.now(),
      tokenCount: estimateTokenCount(normalizedContent),
    };
    this.state.messages.push(message);
    this.state.tokenCount += message.tokenCount;
    this.storage.save(this.state);
    return message;
  }

  // `contextLimit` comes from models.dev (getModelContextLimit) when available;
  // omit it to fall back to the local model table in tokens.ts.
  shouldCompact(model: string, contextLimit?: number): boolean {
    if (
      this.blockedAtTokenCount !== undefined &&
      this.state.tokenCount <
        this.blockedAtTokenCount + BLOCKED_RETRY_GROWTH_TOKENS
    ) {
      return false;
    }
    return shouldCompact(
      this.state.tokenCount,
      model,
      this.config.autoCompactBufferTokens,
      contextLimit,
    );
  }

  getPromptContext(): PromptMemoryContext {
    return {
      summary: this.state.summaries.at(-1)?.content,
      recentMessages: [...this.state.messages],
      tokenCount: this.state.tokenCount,
    };
  }

  async compact(options: CompactOptions = {}): Promise<CompactionResult> {
    const selected = selectForCompaction(this.state.messages, this.config);
    if (selected.summarize.length === 0) {
      return {
        success: true,
        preservedMessageIds: selected.preserve.map((message) => message.id),
        compactedMessageIds: [],
        tokenCountBefore: this.state.tokenCount,
        tokenCountAfter: this.state.tokenCount,
      };
    }

    const pre = await this.hooks.runPreCompact({
      sessionId: this.state.sessionId,
      turnCount: this.state.totalCompactions,
    });
    if (!pre.allowed) {
      this.blockedAtTokenCount = this.state.tokenCount;
      return {
        success: false,
        blocked: true,
        reason: pre.blockReason,
        preservedMessageIds: this.state.messages.map((message) => message.id),
        compactedMessageIds: [],
        tokenCountBefore: this.state.tokenCount,
        tokenCountAfter: this.state.tokenCount,
      };
    }

    const previousSummary = this.state.summaries.at(-1)?.content;
    const summarizeInput = {
      sessionId: this.state.sessionId,
      previousSummary,
      messages: selected.summarize,
    };
    let summary = summarizeMessages(summarizeInput);
    if (options.llmSummarize) {
      try {
        const content = await options.llmSummarize(summarizeInput);
        summary = makeSummary(summarizeInput, content);
      } catch (err) {
        // Fall back to the heuristic summary already computed above.
        console.warn(
          `[MemoryService] LLM summarization failed, using heuristic: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const tokenCountAfter =
      summary.summaryTokenCount + selected.preserveTokenCount;
    const result: CompactionResult = {
      success: true,
      summary,
      preservedMessageIds: selected.preserve.map((message) => message.id),
      compactedMessageIds: selected.summarize.map((message) => message.id),
      tokenCountBefore: this.state.tokenCount,
      tokenCountAfter,
    };

    this.blockedAtTokenCount = undefined;
    this.state = {
      ...this.state,
      messages: selected.preserve,
      summaries: [...this.state.summaries, summary],
      tokenCount: tokenCountAfter,
      totalCompactions: this.state.totalCompactions + 1,
      lastCompactionAt: Date.now(),
    };
    this.storage.save(this.state);
    await this.hooks.runPostCompact(
      {
        sessionId: this.state.sessionId,
        turnCount: this.state.totalCompactions,
      },
      result.success,
    );

    return result;
  }
}

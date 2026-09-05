import type { Message } from "../agent/types.js";
import type { NormalizedUsage } from "./provider-shared.js";
import type { EffortLevel } from "@thisisayande/freecode-shared";

export type { EffortLevel };

export interface ProviderInfo {
  id: string;
  name: string;
  /**
   * Model used when the caller names none. Optional: most of the catalogue is
   * models.dev-derived, and models.dev publishes no "default" — inventing one
   * would mean guessing a model id that may not exist on that endpoint.
   */
  defaultModel?: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  // Tokens this provider reserves for the reply when the caller doesn't set
  // maxTokens. Providers count it against the context window, so the usable
  // input budget is (context limit - this), not the full limit — compaction
  // subtracts it before deciding whether to fire.
  maxOutputTokens: number;
  /**
   * May this provider be spent on model calls the user did not ask for —
   * memory extraction, consolidation, the retrieval judge, LLM compaction
   * summaries, trajectory redirection?
   *
   * Undefined means yes, so every metered provider is unaffected: there the
   * calls are small, cheap, and ride a warm prompt cache. Set false for a
   * provider whose budget is a request quota rather than tokens, where one
   * background call costs exactly as much as the user's own turn. Consumers
   * read it through `allowsAuxiliaryCalls()`, which fails open.
   */
  auxiliaryCalls?: boolean;
  /**
   * Does this provider need an API key before it can be used?
   *
   * Undefined means yes, which is every metered provider. Set false for one
   * authenticated some other way (a browser session cookie, or nothing at
   * all) — otherwise the model picker treats "no key on file" as "not
   * configured" and demands the user invent one before letting them select it.
   */
  requiresApiKey?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface SystemBlock {
  text: string;
  cache?: boolean;
}

/** Content part that can be sent to vision-capable providers. */
export type MultimodalContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      /** Base64-encoded image data. AI SDK handles provider-specific conversion. */
      image: string;
      /** Media type (e.g., image/png, image/jpeg). */
      mediaType?: string;
    };

export interface ExecuteOptions {
  prompt?: string;
  messages?: Message[];
  system?: string | SystemBlock[];
  model?: string;
  // Set when the caller deliberately omits `model` to let the provider fall
  // back to its default (e.g. memory extraction, which skips the session's
  // main model on purpose) — suppresses resolveModel's "no model specified"
  // warning, which otherwise reads as the user's configured model being
  // ignored.
  quietModelFallback?: boolean;
  temperature?: number;
  maxTokens?: number;
  // Reasoning-effort tier. Mapped per-provider (see effort.ts) to whatever
  // native knob controls it; undefined leaves the provider's own default.
  effort?: EffortLevel;
  tools?: ToolDef[];
  toolResults?: Array<{
    toolCallId: string;
    result: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stream?: boolean;
  // Cancellation: callers (agent loop) pass an AbortSignal so in-flight
  // provider requests can be interrupted (Ctrl+C, session.stop).
  abortSignal?: AbortSignal;
  // Cache-routing hint. OpenAI shards its prompt cache across machines and
  // routes on this key, so sending a stable one per conversation keeps a
  // session's turns landing where its own prefix is already warm. Providers
  // that cache without a routing key (Anthropic, Gemini, DeepSeek) ignore it.
  // Subagents pass their own id deliberately — a different context should not
  // be routed to the parent's cache.
  sessionId?: string;
  // Request-scoped text appended as a final user message AFTER the cache
  // anchors are placed (see buildGenerateOptions). For mutable per-turn state
  // — memory recalls, todo list, drained reminders — that used to live in the
  // system param, where any change re-sent the entire conversation: system
  // sits upstream of every message, so one changed byte there busted every
  // downstream breakpoint. At the tail it costs only its own tokens and the
  // cached prefix stays byte-stable. Never persisted to history.
  ephemeralTail?: string;
}

/**
 * Token usage from a single provider call. Carries the additive shape
 * documented in `provider-shared.ts` (every field is independently
 * meaningful; consumers never subtract). The agent loop accumulates this
 * across turns; the daily tracker / cache hit rate read it as-is.
 *
 * Mirrors `NormalizedUsage` with the legacy `cacheCreationInputTokens`
 * alias preserved so existing readers (`loop.ts`, `cache-awareness.ts`,
 * `recorder.ts`, IPC protocol) don't all need to rename in one go.
 */
export type ExecuteUsage = NormalizedUsage & {
  /** Legacy name for `cacheWriteInputTokens`. Same value. */
  cacheCreationInputTokens?: number;
};

export interface ExecuteResult {
  content: string;
  thinking?: string; // Extended thinking/reasoning content
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    id: string;
  }>;
  usage?: ExecuteUsage;
  stopReason: "stop" | "tool_use" | "max_tokens" | "unknown";
  provider: string;
  /** What we ASKED for. */
  model: string;
  /**
   * What the provider says it actually served, when it says anything.
   *
   * Distinct from `model` because an alias resolves server-side: asking for
   * `claude-sonnet-4-6` can be answered by a dated snapshot, and a silent roll
   * of that snapshot reprices every eval baseline pinned to the alias without
   * changing a single recorded id. Undefined means the provider did not say —
   * never assume it matches.
   */
  echoedModel?: string;
}

export type ProviderChunk =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "usage";
      usage: NonNullable<ExecuteResult["usage"]>;
    }
  | {
      type: "done";
      stopReason: ExecuteResult["stopReason"];
      /** See `ExecuteResult.echoedModel`. Carried on `done` rather than as its
       *  own chunk so no consumer has to learn a new case to ignore. */
      echoedModel?: string;
    }
  | { type: "error"; error: string };

export interface AIProvider {
  info: ProviderInfo;
  execute(opts: ExecuteOptions): Promise<ExecuteResult>;
  // Optional streaming API. When present and caller opts in, the provider
  // yields ProviderChunks as they arrive from the model. Callers that do not
  // implement streaming can continue to use execute() unchanged.
  stream?(opts: ExecuteOptions): AsyncIterable<ProviderChunk>;
}

// =============================================================================
// Core Domain Types
// =============================================================================

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  timestamp: number;
}

export type MessagePart =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string }
  | {
      type: "tool";
      tool: { name: string; args: Record<string, unknown> };
      result?: string;
    }
  | {
      type: "image";
      /** Base64-encoded image data (without the data:image/xxx;base64, prefix) */
      data: string;
      /** Media type: image/png, image/jpeg, image/gif, image/webp */
      mediaType: string;
      /** Optional plain-text description for providers without vision support */
      altText?: string;
    };

// =============================================================================
// Tool Types
// =============================================================================

export interface ToolContext {
  cwd: string;
  abort?: AbortSignal;
}

export interface ToolResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface ToolDef<P = unknown, R extends ToolResult = ToolResult> {
  id: string;
  description: string;
  parameters: JsonSchema;
  execute: (params: P, ctx: ToolContext) => Promise<R>;
}

export type ToolRegistry = Record<string, ToolDef>;

export interface JsonSchema {
  type: string;
  properties?: Record<string, { description?: string; type?: string }>;
  required?: string[];
}

export interface ToolListItem {
  id: string;
  description: string;
}

/** A prompt command (e.g. /init) defined in core and exposed to every frontend. */
export interface CommandInfo {
  name: string;
  description: string;
  argHint?: string;
}

// =============================================================================
// Provider Types
// =============================================================================

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  adapter: unknown;
  config: {
    url: string;
  };
}

// =============================================================================
// Session Types
// =============================================================================

export interface SessionConfig {
  projectPath: string;
  provider?: string;
  // Pins the session to a model at start. Omitted, the session inherits
  // config.json's current model rather than the provider's hardcoded default.
  model?: string;
  agentMode?: "plan" | "build" | "review" | "explore" | "danger";
}

export interface SessionInfo {
  id: string;
  projectPath: string;
  provider: string;
  startedAt: number;
}

// Lifecycle state of a persisted session. Mirrors core's `SessionMeta["status"]`.
// `interrupted` means a turn was killed mid-stream and can be safely resumed;
// `archived`/`deleted` are user actions; `active` is the normal case.
export type SessionStatus = "active" | "interrupted" | "archived" | "deleted";

/**
 * One session as returned by `session.list` — the metadata only, no transcript.
 * Mirrors core's `SessionMeta` (`apps/core/src/session/store.ts`). The wire
 * shape is the same so this is the canonical definition for every frontend.
 */
export interface SessionMeta {
  id: string;
  title: string;
  projectPath: string;
  provider: string;
  /** Carried from SessionMeta so a resumed session restores the model it was pinned to. */
  model?: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  lastTurnAt: number;
  turnCount: number;
  parentId?: string;
  aggregatedTokenCount?: number;
}

/**
 * A persisted message from `session.resume`. Mirrors core's `SerializedMessage`
 * (`apps/core/src/session/store.ts`). The `image` part carries base64 data +
 * media type so vision-capable providers can rehydrate the round-trip.
 */
export interface SerializedMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{
    type: "text" | "code" | "tool" | "image";
    content?: string;
    language?: string;
    tool?: { name: string; args: Record<string, unknown> };
    result?: string;
    /** Base64 image data (image parts only). */
    data?: string;
    /** Media type, e.g. image/png (image parts only). */
    mediaType?: string;
    altText?: string;
  }>;
  timestamp: number;
  /** True if the previous turn ended mid-stream; core appends a resume marker. */
  interrupted?: boolean;
}

/**
 * Full session record returned by `session.resume`: metadata + transcript.
 * Mirrors core's `SessionContext` (`apps/core/src/session/manager.ts`). The
 * IPC layer returns `{ sessionId, messages }` (a slimmer view of this) — see
 * `SessionResumeResult` below.
 */
export interface SessionContext extends SessionMeta {
  messages: SerializedMessage[];
}

/**
 * Wire shape of the `session.resume` response (see `apps/core/src/server.ts`).
 * `sessionId` echoes the requested id; `messages` is the full transcript so the
 * frontend can rehydrate the chat without a follow-up fetch.
 */
export interface SessionResumeResult {
  sessionId: string;
  messages?: SerializedMessage[];
}

/**
 * Optional filter accepted by `session.list`. Mirrors what core passes through
 * to `SessionStore.list`.
 */
export interface SessionFilter {
  status?: SessionStatus;
  projectPath?: string;
}

/**
 * One Claude Code session as returned by `session.claudeList`. Slimmed to
 * the columns the resume picker renders — mirrors `SessionMeta` so the
 * frontend can reuse the same row renderer, with `provider` pinned to the
 * `"claude-code"` literal so `Enter` can dispatch by tab.
 *
 * `fullPath` is the absolute path to the `.jsonl` transcript (used by
 * `session.claudeTranscript` to re-read it).
 */
export interface ClaudeSessionMeta {
  id: string;
  title: string;
  projectPath: string;
  provider: "claude-code";
  model?: string;
  createdAt: number;
  updatedAt: number;
  /** Same as `updatedAt` — Claude Code has no separate per-turn clock. */
  lastTurnAt: number;
  turnCount: number;
  fullPath: string;
}

/**
 * Wire shape of the `session.claudeTranscript` response. The transcript is
 * converted to `SerializedMessage[]` so the existing preview markdown
 * renderer (see `apps/tui/src/components/resume-picker.tsx::transcriptToMarkdown`)
 * is reused with no changes.
 */
export interface ClaudeTranscript {
  sessionId: string;
  messages: SerializedMessage[];
}

/**
 * Optional filter accepted by `session.claudeList`.
 */
export interface ClaudeListFilter {
  projectPath?: string;
  limit?: number;
}

// ===========================================================================
// Context Breakdown (`context.stats` / the `/context` command)
// ===========================================================================

/**
 * A category of context-window occupancy. The ids mirror how core assembles a
 * request (see `apps/core/src/context/breakdown.ts`), so a frontend can color
 * or order them without parsing labels.
 */
export type ContextSegmentId =
  | "system-prompt"
  | "project-instructions"
  | "skills"
  | "memory-guidance"
  | "tools"
  | "mcp-tools"
  | "compaction-summary"
  | "memories"
  | "todos"
  | "project-context"
  | "messages";

export interface ContextSegmentStat {
  id: ContextSegmentId;
  /** Human-readable name, e.g. "Project instructions". */
  label: string;
  tokens: number;
}

/**
 * Where the context window is going, as of right now.
 *
 * `segments`/`usedTokens` are estimates (chars/4 — the same estimator
 * compaction budgets with); `measuredInputTokens` is the provider's own count
 * from the last completed turn, so a frontend can show the estimate against
 * ground truth instead of presenting a guess as fact. Both are absent rather
 * than zero when unknown: `contextLimit` needs a models.dev lookup, and
 * `measuredInputTokens` needs at least one completed turn.
 */
export interface ContextBreakdown {
  provider: string;
  model?: string;
  contextLimit?: number;
  segments: ContextSegmentStat[];
  usedTokens: number;
  freeTokens?: number;
  measuredInputTokens?: number;
  toolCount: number;
  mcpToolCount: number;
  messageCount: number;
}

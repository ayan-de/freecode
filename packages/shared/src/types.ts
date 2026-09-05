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

/**
 * How ready a provider is to be selected.
 *
 * Four states rather than a boolean, because a web session that authenticates
 * anonymously is usable with nothing on file — `ready` is a working provider,
 * and collapsing it into "not configured" sends the user looking for a
 * credential that does not exist.
 */
export type ProviderStatus =
  | "ready" // Works now, no credential needed (anonymous web session).
  | "signed-in" // Optional credential on file, session upgraded.
  | "configured" // Required credential on file.
  | "needs-setup"; // Required credential missing — cannot be used yet.

/** What signing in to a web session costs, so a frontend can prompt for it. */
export interface WebCredentialSpec {
  field: "cookie" | "apiKey";
  label: string;
  hint: string;
  required: boolean;
}

/** A web session's stored credential. Every field optional — absent is anonymous. */
export interface WebCredentials {
  cookie?: string;
  cookieFile?: string;
  authUser?: string;
  xsrfToken?: string;
  apiKey?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  /** `api` is metered and keyed (/model); `web` drives a browser session (/web). */
  kind?: "api" | "web";
  status?: ProviderStatus;
  /** Present only on `web` providers. */
  credential?: WebCredentialSpec;
  /** Selectable right now. Kept for shells that predate `status`. */
  hasApiKey?: boolean;
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

// Reasoning-effort tier, forwarded to whichever provider-native knob controls
// it (Anthropic `effort`, OpenAI `reasoningEffort`, Gemini `thinkingLevel`).
// Omitted means "let the provider use its own default." `xhigh`/`max` are
// Anthropic/OpenAI-only tiers; Gemini's `thinkingLevel` enum stops at `high`,
// so the gemini provider clamps those two down (see providers/effort.ts).
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface SessionConfig {
  projectPath: string;
  provider?: string;
  // Pins the session to a model at start. Omitted, the session inherits
  // config.json's current model rather than the provider's hardcoded default.
  model?: string;
  agentMode?: "plan" | "build" | "review" | "explore" | "danger";
  effort?: EffortLevel;
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
  effort?: EffortLevel;
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
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>;
  memories: MemoryEntry[];
  exportedAt: number;
  expiresAt?: number;
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

// =============================================================================
// Wire shapes for the remaining IPC methods
//
// These mirror types that live in `apps/core` — shared cannot import from an
// app, and an app type carries internals (Effect handles, storage paths) that
// have no business on the wire. Same pattern as `SessionMeta` and
// `SerializedMessage` above. `ipc/wire-shapes.test.ts` in core asserts each
// core type is assignable to its mirror, so drift is a typecheck failure
// rather than a runtime surprise in a frontend.
// =============================================================================

/** Mirrors core's `ModelLimit` (`models-dev.ts`). */
export interface ModelLimit {
  /** Context-window size (max input tokens). */
  context: number;
  /** Max output tokens per response. */
  output: number;
}

/** Mirrors core's `ModelCost` (`models-dev.ts`) — USD per million tokens. */
export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Mirrors core's `ProviderModel` (`models-dev.ts`) — one `models.list` row. */
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  /** Present when models.dev reports limits for this model. */
  limit?: ModelLimit;
  /** Present when models.dev publishes a rate card for this model. */
  cost?: ModelCost;
  /** Input modalities, e.g. ["text", "image", "pdf"]. Absent if unreported. */
  inputModalities?: string[];
}

/** Mirrors core's `MemoryType` (`memory/mem-types.ts`). */
export type MemoryType =
  | "user"
  | "feedback"
  | "project"
  | "reference"
  | "episode";

/** Mirrors core's `MemoryEntry` (`memory/mem-types.ts`). */
export interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  supersedes?: string[];
  /** ISO date (YYYY-MM-DD) an episode describes; absent means undated. */
  happened_at?: string;
}

/** Mirrors the return of core's `MemoryGraphService.stats()`. */
export interface MemoryGraphStats {
  vectors: number;
  dims: number;
  nodes: number;
  edges: number;
  clusters: number;
  embedder: boolean;
}

export type AnthropicAuthMode = "oauth" | "api-key";

/**
 * Mirrors core's `RedactedConfig` (`providers/config.ts`) — the ONLY config
 * shape that leaves the process. There is no wire type for the raw config
 * because there must never be one: `config.get` returns this.
 */
export interface RedactedConfig {
  providers?: Record<
    string,
    { hasApiKey: boolean; model?: string; authMode?: AnthropicAuthMode }
  >;
  web?: Record<string, { hasCredential: boolean }>;
  current?: { provider: string; model: string };
  lastAgentMode?: string;
  recovery?: { fallbackProviders?: string[] };
}

/**
 * Mirrors the wire-facing half of core's `LoopResult` (`agent/types.ts`).
 * `finalState` is deliberately omitted: it is the loop's internal state
 * machine, and no frontend reads it.
 */
export interface TurnResult {
  success: boolean;
  message?: string;
  content?: string;
  thinking?: string;
  turnCount: number;
  iterationCount: number;
  usage?: {
    /** Already includes cache writes — they are billed as input. */
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    /** The same tokens as above, broken out for the hit rate. Not an addend. */
    cacheCreationInputTokens?: number;
    /** The last API call's full input — true context-window occupancy. */
    contextTokens?: number;
  };
}

/**
 * Mirrors core's `ExportedSession` (`store/remote.ts`). Its `messages` are a
 * flattened transcript, NOT `SerializedMessage` — the export format drops
 * parts so it stays readable and stable across store versions.
 */
export interface ExportedSession {
  version: 1;
  metadata: {
    id: string;
    title: string;
    projectPath: string;
    provider: string;
    status: "active" | "archived" | "deleted";
    createdAt: number;
    updatedAt: number;
    lastTurnAt: number;
    turnCount: number;
    parentId?: string;
  };
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>;
  memories: MemoryEntry[];
  exportedAt: number;
  expiresAt?: number;
}

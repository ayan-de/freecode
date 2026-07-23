//! Mirrors packages/shared/src/ipc/protocol.ts and types.ts.
//! Keep in sync with the TS source of truth when the wire protocol changes.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: &'static str,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct JsonRpcError {
    #[allow(dead_code)]
    pub code: i64,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct JsonRpcResponse {
    pub id: Value,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<JsonRpcError>,
}

/// Streamed while a turn is in flight. Lines on stdout that carry a "type"
/// but no "jsonrpc" field are StreamEvents rather than JSON-RPC responses.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    ToolStart {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        args: Value,
    },
    ToolOutput {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        content: String,
    },
    ToolComplete {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        result: String,
        success: bool,
        #[serde(rename = "duration_ms")]
        duration_ms: Option<u64>,
    },
    Thinking {
        content: String,
    },
    Text {
        content: String,
    },
    TextDelta {
        delta: String,
    },
    ThinkingDelta {
        delta: String,
    },
    Done {
        content: String,
    },
    Error {
        content: String,
    },
    /// Compaction began (summarizing older turns to free context).
    CompactionStart {
        #[serde(default)]
        trigger: String,
    },
    /// Compaction finished; carries the before/after token estimates.
    CompactionComplete {
        #[serde(default)]
        trigger: String,
        #[serde(default)]
        compacted: bool,
        #[serde(rename = "tokensBefore", default)]
        tokens_before: u64,
        #[serde(rename = "tokensAfter", default)]
        tokens_after: u64,
        #[serde(default)]
        reason: Option<String>,
    },
    /// Core is blocked waiting for the user to answer. Ignoring these hangs
    /// the turn — the agent loop only resumes on `question.answer`/`reject`.
    QuestionAsked {
        #[serde(rename = "requestId")]
        request_id: String,
        questions: Vec<QuestionSpec>,
    },
    /// Core is blocked waiting for a permission decision (`permission.answer`).
    PermissionAsked {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(default)]
        description: String,
        #[serde(rename = "suggestedRule", default)]
        suggested_rule: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// Synthesized locally (core never sends this) from the `session.send`
    /// RPC result's usage, so the status bar's context meter can update.
    Usage {
        context_tokens: u64,
    },
    /// Synthesized locally after a model switch (core never sends this) so the
    /// status meter's denominator tracks the newly selected model's window.
    ContextLimit {
        limit: u64,
    },
}

/// One question in a `question_asked` event; mirrors `QuestionSpec` in
/// `packages/shared/src/ipc/protocol.ts`.
#[derive(Debug, Clone, Deserialize)]
pub struct QuestionSpec {
    pub question: String,
    #[serde(default)]
    pub header: Option<String>,
    #[serde(default)]
    pub options: Vec<QuestionOption>,
    #[serde(default)]
    pub multiple: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct QuestionOption {
    pub label: String,
    #[serde(default)]
    pub description: String,
}

/// A line read from the core's stdout is either a JSON-RPC response
/// (has "jsonrpc") or a bare StreamEvent (has "type" only).
pub enum IncomingLine {
    Response(JsonRpcResponse),
    Event(StreamEvent),
    Unparseable,
}

pub fn parse_line(line: &str) -> IncomingLine {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return IncomingLine::Unparseable;
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return IncomingLine::Unparseable;
    };
    if value.get("jsonrpc").is_some() {
        return match serde_json::from_value::<JsonRpcResponse>(value) {
            Ok(resp) => IncomingLine::Response(resp),
            Err(_) => IncomingLine::Unparseable,
        };
    }
    if value.get("type").is_some() {
        return match serde_json::from_value::<StreamEvent>(value) {
            Ok(evt) => IncomingLine::Event(evt),
            Err(_) => IncomingLine::Unparseable,
        };
    }
    IncomingLine::Unparseable
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionConfig {
    #[serde(rename = "projectPath")]
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(rename = "agentMode", skip_serializing_if = "Option::is_none")]
    pub agent_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SessionInfo {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Whether core can find an API key for this provider (config or env). The
    /// picker badges providers that still need one.
    #[serde(rename = "hasApiKey", default)]
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SessionSendResult {
    #[allow(dead_code)]
    pub success: bool,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub usage: Option<TokenUsage>,
}

/// Token accounting from the agent loop's final `LoopResult.usage`
/// (`apps/core/src/agent/types.ts`). `context_tokens` is the last API call's
/// full input — true context-window occupancy; when the core omits it we fall
/// back to `input + cache_read`, mirroring `apps/tui/src/index.ts`.
#[derive(Debug, Clone, Deserialize)]
pub struct TokenUsage {
    #[serde(rename = "inputTokens", default)]
    pub input_tokens: u64,
    #[serde(rename = "cacheReadInputTokens", default)]
    pub cache_read_input_tokens: u64,
    #[serde(rename = "contextTokens", default)]
    pub context_tokens: Option<u64>,
}

impl TokenUsage {
    /// True context-window occupancy: the core's `contextTokens` when present,
    /// otherwise the input + cache-read fallback the TS TUI uses.
    pub fn context_tokens(&self) -> u64 {
        self.context_tokens
            .unwrap_or(self.input_tokens + self.cache_read_input_tokens)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolListItem {
    #[allow(dead_code)]
    pub id: String,
    #[allow(dead_code)]
    pub description: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CurrentModel {
    pub provider: String,
    pub model: String,
}

/// One entry from `models.list`; mirrors `ModelInfo` in
/// `apps/tui/src/ipc/client.ts`. Only `id` is required — `name` falls back to
/// the id, and the model's context/output limits are ignored here (the status
/// bar resolves the window via `models.contextLimit`).
#[derive(Debug, Clone, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

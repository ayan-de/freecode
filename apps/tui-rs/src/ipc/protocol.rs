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
    #[allow(dead_code)]
    pub description: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SessionSendResult {
    #[allow(dead_code)]
    pub success: bool,
    #[serde(default)]
    pub content: Option<String>,
}

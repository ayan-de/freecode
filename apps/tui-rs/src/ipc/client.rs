//! JSON-RPC bridge to the CLI backend (apps/core). Mirrors apps/tui/src/ipc/client.ts:
//! spawns the same daemon process and speaks the same newline-delimited protocol.

use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::protocol::{
    parse_line, CurrentModel, IncomingLine, JsonRpcRequest, ModelInfo, ProviderInfo, SessionConfig,
    SessionInfo, SessionSendResult, StreamEvent, ToolListItem,
};

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct IpcClient {
    stdin: Mutex<ChildStdin>,
    next_id: AtomicU64,
    pending: PendingMap,
    _child: Child,
    pub events: Mutex<mpsc::UnboundedReceiver<StreamEvent>>,
    /// Sender side of `events`, kept so RPC-result-derived events (e.g. token
    /// usage from `session.send`) can be injected into the same stream the
    /// UI loop already drains.
    event_tx: mpsc::UnboundedSender<StreamEvent>,
}

fn find_project_root() -> PathBuf {
    if let Ok(root) = env::var("FREECODE_ROOT") {
        return PathBuf::from(root);
    }
    let mut dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    loop {
        if dir.join("pnpm-workspace.yaml").exists() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => return env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }
}

impl IpcClient {
    pub async fn start() -> Result<Self> {
        let project_root = find_project_root();
        let dist_path = project_root.join("apps/core/dist/server.js");

        let mut child = if Path::new(&dist_path).exists() {
            Command::new("node")
                .arg(&dist_path)
                .current_dir(&project_root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .context("failed to spawn node apps/core/dist/server.js")?
        } else {
            let src_entry = project_root.join("apps/core/src/server.ts");
            Command::new("npx")
                .args(["tsx", src_entry.to_str().unwrap()])
                .current_dir(&project_root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .context("failed to spawn npx tsx apps/core/src/server.ts")?
        };

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        let stderr = child.stderr.take();

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let reader_tx = event_tx.clone();

        let pending_reader = pending.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                match parse_line(&line) {
                    IncomingLine::Response(resp) => {
                        let id = match resp.id.as_u64() {
                            Some(id) => id,
                            None => continue,
                        };
                        let mut pending = pending_reader.lock().await;
                        if let Some(tx) = pending.remove(&id) {
                            let result = match resp.error {
                                Some(err) => Err(err.message),
                                None => Ok(resp.result.unwrap_or(Value::Null)),
                            };
                            let _ = tx.send(result);
                        }
                    }
                    IncomingLine::Event(evt) => {
                        let _ = reader_tx.send(evt);
                    }
                    IncomingLine::Unparseable => {}
                }
            }
        });

        // eprintln! here would write straight to the real terminal underneath
        // the alternate screen and corrupt the TUI's rendering, so core's
        // stderr goes to a log file instead of the live display.
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let log_path = env::temp_dir().join("freecode-tui-core.log");
                let mut log_file = tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                    .await
                    .ok();
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Some(file) = log_file.as_mut() {
                        let _ = file.write_all(format!("{line}\n").as_bytes()).await;
                    }
                }
            });
        }

        Ok(Self {
            stdin: Mutex::new(stdin),
            next_id: AtomicU64::new(1),
            pending,
            _child: child,
            events: Mutex::new(event_rx),
            event_tx,
        })
    }

    async fn call(&self, method: &str, params: Option<Value>) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: method.to_string(),
            params,
        };
        let mut line = serde_json::to_vec(&request)?;
        line.push(b'\n');

        self.stdin.lock().await.write_all(&line).await?;

        match rx.await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(message)) => Err(anyhow!("{method} failed: {message}")),
            Err(_) => Err(anyhow!("{method} dropped: core process closed the channel")),
        }
    }

    pub async fn providers_list(&self) -> Result<Vec<ProviderInfo>> {
        let value = self.call("providers.list", None).await?;
        Ok(serde_json::from_value(value)?)
    }

    pub async fn tools_list(&self) -> Result<Vec<ToolListItem>> {
        let value = self.call("tools.list", None).await?;
        Ok(serde_json::from_value(value)?)
    }

    /// The provider/model actually configured for use (`config.getCurrentModel`
    /// on the core), as opposed to `providers_list`'s catalog of what's
    /// available. Returns `Ok(None)` when nothing has been configured yet.
    pub async fn current_model(&self) -> Result<Option<CurrentModel>> {
        let value = self.call("config.getCurrentModel", None).await?;
        if value.is_null() {
            return Ok(None);
        }
        Ok(Some(serde_json::from_value(value)?))
    }

    /// The models offered by `provider_id` (`models.list`), for the `/model`
    /// picker. Returns them in the order core lists them.
    pub async fn models_list(&self, provider_id: &str) -> Result<Vec<ModelInfo>> {
        let value = self
            .call("models.list", Some(serde_json::json!({ "providerId": provider_id })))
            .await?;
        Ok(serde_json::from_value(value)?)
    }

    /// Persist the active model (`config.setCurrentModel`) and emit the new
    /// context-window limit as a synthetic event, so the status meter's
    /// denominator updates the same way it does at startup.
    pub async fn set_current_model(&self, provider: &str, model: &str) -> Result<()> {
        self.call(
            "config.setCurrentModel",
            Some(serde_json::json!({ "provider": provider, "model": model })),
        )
        .await?;
        if let Ok(limit) = self.model_context_limit(provider, model).await {
            let _ = self.event_tx.send(StreamEvent::ContextLimit { limit });
        }
        Ok(())
    }

    pub async fn session_start(&self, config: SessionConfig) -> Result<SessionInfo> {
        let value = self.call("session.start", Some(serde_json::to_value(config)?)).await?;
        Ok(serde_json::from_value(value)?)
    }

    pub async fn session_send(
        &self,
        session_id: &str,
        message: &str,
        model: Option<&str>,
    ) -> Result<SessionSendResult> {
        let params = serde_json::json!({
            "sessionId": session_id,
            "message": message,
            "model": model,
        });
        let value = self.call("session.send", Some(params)).await?;
        let result: SessionSendResult = serde_json::from_value(value)?;
        // The RPC result resolves after the turn's Done stream event; inject the
        // turn's context-window occupancy into the same event stream so the UI
        // loop updates the status bar's context meter.
        if let Some(usage) = &result.usage {
            let _ = self.event_tx.send(StreamEvent::Usage {
                context_tokens: usage.context_tokens(),
            });
        }
        Ok(result)
    }

    /// The context-window size for a model, resolved by core from models.dev
    /// (the single source of truth). Returns 0 when the model is unknown.
    pub async fn model_context_limit(&self, provider: &str, model: &str) -> Result<u64> {
        let value = self
            .call(
                "models.contextLimit",
                Some(serde_json::json!({ "provider": provider, "model": model })),
            )
            .await?;
        Ok(value.as_u64().unwrap_or(0))
    }

    /// Unblock a `question_asked`. An empty `answers` list rejects it, which
    /// core surfaces to the agent as "the user declined to answer".
    pub async fn question_answer(&self, request_id: &str, answers: Vec<String>) -> Result<()> {
        let method = if answers.is_empty() { "question.reject" } else { "question.answer" };
        self.call(
            method,
            Some(serde_json::json!({ "requestId": request_id, "answers": answers })),
        )
        .await?;
        Ok(())
    }

    /// Unblock a `permission_asked` with a `PermissionPromptDecision` value.
    pub async fn permission_answer(&self, request_id: &str, decision: &str) -> Result<()> {
        self.call(
            "permission.answer",
            Some(serde_json::json!({ "requestId": request_id, "decision": decision })),
        )
        .await?;
        Ok(())
    }

    pub async fn session_stop(&self, session_id: &str) -> Result<()> {
        self.call("session.stop", Some(serde_json::json!({ "sessionId": session_id })))
            .await?;
        Ok(())
    }
}

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
    parse_line, CurrentModel, IncomingLine, JsonRpcRequest, ProviderInfo, SessionConfig,
    SessionInfo, SessionSendResult, StreamEvent, ToolListItem,
};

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct IpcClient {
    stdin: Mutex<ChildStdin>,
    next_id: AtomicU64,
    pending: PendingMap,
    _child: Child,
    pub events: Mutex<mpsc::UnboundedReceiver<StreamEvent>>,
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
                        let _ = event_tx.send(evt);
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
        Ok(serde_json::from_value(value)?)
    }

    pub async fn session_stop(&self, session_id: &str) -> Result<()> {
        self.call("session.stop", Some(serde_json::json!({ "sessionId": session_id })))
            .await?;
        Ok(())
    }
}

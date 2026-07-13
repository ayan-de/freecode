mod app;
mod ipc;
mod ui;

use std::io::stdout;
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{
    DisableMouseCapture, EnableMouseCapture, Event, EventStream, KeyCode, KeyEventKind,
    KeyModifiers,
};
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use futures::StreamExt;
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use std::sync::Arc;
use tokio::time::interval;
use tui_textarea::{Input, TextArea};

use app::{App, Status};
use ipc::{protocol::SessionConfig, IpcClient};

#[tokio::main]
async fn main() -> Result<()> {
    let client = Arc::new(IpcClient::start().await?);

    enable_raw_mode()?;
    let mut out = stdout();
    execute!(out, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(out);
    let mut terminal = Terminal::new(backend)?;

    let result = run(&mut terminal, &client).await;

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    result
}

async fn run(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    client: &Arc<IpcClient>,
) -> Result<()> {
    let mut app = App::new();
    let mut input = TextArea::default();
    input.set_placeholder_text("Type a message, Enter to send, Esc to quit");

    let cwd = std::env::current_dir()?.to_string_lossy().to_string();
    app.cwd = cwd.clone();
    match client
        .session_start(SessionConfig { project_path: cwd, provider: None })
        .await
    {
        Ok(info) => {
            app.session_id = Some(info.session_id);
        }
        Err(err) => app.push_system(format!("failed to start session: {err}")),
    }
    if let Ok(Some(current)) = client.current_model().await {
        app.provider = current.provider;
        app.model = current.model;
    }
    if let Ok(tools) = client.tools_list().await {
        app.tool_count = tools.len();
    }

    let mut crossterm_events = EventStream::new();
    let mut tick = interval(Duration::from_millis(100));

    loop {
        terminal.draw(|frame| ui::draw(frame, &app, &input))?;

        tokio::select! {
            maybe_event = crossterm_events.next() => {
                let Some(Ok(event)) = maybe_event else { continue };
                if handle_terminal_event(event, &mut app, &mut input, client).await? {
                    break;
                }
            }
            event = async {
                client.events.lock().await.recv().await
            } => {
                if let Some(evt) = event {
                    app.apply_stream_event(evt);
                }
            }
            _ = tick.tick() => {}
        }

        if app.should_quit {
            break;
        }
    }

    Ok(())
}

async fn handle_terminal_event(
    event: Event,
    app: &mut App,
    input: &mut TextArea<'_>,
    client: &Arc<IpcClient>,
) -> Result<bool> {
    if let Event::Key(key) = &event {
        if key.kind != KeyEventKind::Press {
            return Ok(false);
        }
        match (key.code, key.modifiers) {
            (KeyCode::Esc, _) => {
                app.should_quit = true;
                return Ok(true);
            }
            (KeyCode::Char('c'), KeyModifiers::CONTROL) => {
                app.should_quit = true;
                return Ok(true);
            }
            (KeyCode::Enter, KeyModifiers::NONE) => {
                let text = input.lines().join("\n");
                if !text.trim().is_empty() {
                    *input = TextArea::default();
                    input.set_placeholder_text("Type a message, Enter to send, Esc to quit");
                    send_message(text, app, client);
                }
                return Ok(false);
            }
            _ => {}
        }
    }
    input.input(Input::from(event));
    Ok(false)
}

/// Fires the RPC in the background; the response's StreamEvents arrive on
/// the shared IPC channel and are applied to `app` in the main select loop.
fn send_message(text: String, app: &mut App, client: &Arc<IpcClient>) {
    let Some(session_id) = app.session_id.clone() else {
        app.push_system("no active session".into());
        return;
    };
    app.push_user(text.clone());
    app.begin_assistant_turn();
    app.status = Status::Sending;

    let client = client.clone();
    tokio::spawn(async move {
        if let Err(err) = client.session_send(&session_id, &text, None).await {
            eprintln!("[session.send error] {err}");
        }
    });
}

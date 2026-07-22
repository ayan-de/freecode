use freecode_tui::{app, ipc, ui};

use std::io::stdout;
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{
    DisableMouseCapture, EnableMouseCapture, Event, EventStream, KeyCode, KeyEventKind,
    KeyModifiers, MouseEventKind,
};
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use futures::StreamExt;
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use std::sync::Arc;
use tokio::time::interval;
use tui_textarea::{Input, TextArea};

use app::{App, Prompt, PromptOutcome, Status};
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
        // Context-window size is resolved by core from models.dev, not a
        // table baked into this frontend.
        if let Ok(limit) = client
            .model_context_limit(&current.provider, &current.model)
            .await
        {
            app.context.limit = limit;
        }
        app.set_model(current.provider, current.model);
    }
    if let Ok(tools) = client.tools_list().await {
        app.tool_count = tools.len();
    }

    let mut crossterm_events = EventStream::new();
    // ~60 FPS: the tick paces the buffered-reveal crawl so streamed tokens
    // appear smoothly rather than in network-sized bursts. We only redraw when
    // something actually changed (`dirty`), so an idle TUI stays quiet.
    let mut tick = interval(Duration::from_millis(16));
    let mut dirty = true;

    loop {
        if dirty {
            terminal.draw(|frame| ui::draw(frame, &mut app, &input))?;
            dirty = false;
        }

        tokio::select! {
            maybe_event = crossterm_events.next() => {
                let Some(Ok(event)) = maybe_event else { continue };
                if handle_terminal_event(event, &mut app, &mut input, client).await? {
                    break;
                }
                dirty = true;
            }
            event = async {
                client.events.lock().await.recv().await
            } => {
                if let Some(evt) = event {
                    app.apply_stream_event(evt);
                    dirty = true;
                }
            }
            _ = tick.tick() => {
                // Drain a slice of the pending token buffer into the visible
                // text; only mark dirty (redraw) when there was something to
                // reveal. The landing intro also animates off this tick, so keep
                // redrawing while it's live regardless of token activity. The
                // working-state oscilloscope likewise animates every tick (and
                // its energy decays here), so keep redrawing while sending.
                app.decay_energy();
                let working = app.status == Status::Sending;
                if app.reveal_step() || app.intro_active() || working {
                    dirty = true;
                }
            }
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
    if let Event::Mouse(mouse) = &event {
        match mouse.kind {
            MouseEventKind::ScrollUp => app.scroll_up(3),
            MouseEventKind::ScrollDown => app.scroll_down(3),
            _ => {}
        }
        return Ok(false);
    }
    if let Event::Key(key) = &event {
        if key.kind != KeyEventKind::Press {
            return Ok(false);
        }
        // A blocking prompt owns the keyboard: core is stopped until it is
        // answered, so nothing else may consume these keys.
        if app.prompt.is_some() {
            handle_prompt_key(key.code, app, client);
            return Ok(false);
        }
        match (key.code, key.modifiers) {
            (KeyCode::Esc, _) => {
                app.should_quit = true;
                return Ok(true);
            }
            (KeyCode::PageUp, _) => {
                app.scroll_up(10);
                return Ok(false);
            }
            (KeyCode::PageDown, _) => {
                app.scroll_down(10);
                return Ok(false);
            }
            (KeyCode::Char('o'), KeyModifiers::CONTROL) => {
                app.toggle_tools_expanded();
                return Ok(false);
            }
            (KeyCode::Char('c'), KeyModifiers::CONTROL) => {
                app.should_quit = true;
                return Ok(true);
            }
            // Shift+Tab: crossterm reports this as BackTab on most terminals.
            // The (Tab, SHIFT) arm is a defensive fallback for terminals that
            // don't translate.
            (KeyCode::BackTab, _) | (KeyCode::Tab, KeyModifiers::SHIFT) => {
                app.cycle_mode();
                return Ok(false);
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

/// Drive the open modal. Every path that closes it sends core an answer —
/// leaving it unanswered would hang the turn forever.
fn handle_prompt_key(code: KeyCode, app: &mut App, client: &Arc<IpcClient>) {
    let outcome = match code {
        KeyCode::Up | KeyCode::Char('k') => {
            app.prompt.as_mut().map(Prompt::move_up);
            None
        }
        KeyCode::Down | KeyCode::Char('j') => {
            app.prompt.as_mut().map(Prompt::move_down);
            None
        }
        KeyCode::Char(' ') => {
            app.prompt.as_mut().map(Prompt::toggle);
            None
        }
        // Number keys jump straight to an option; in single-select they pick it.
        KeyCode::Char(c @ '1'..='9') => {
            let idx = c as usize - '1' as usize;
            let multiple = app.prompt.as_ref().is_some_and(|p| p.multiple);
            match app.prompt.as_mut() {
                Some(p) if idx < p.options.len() => {
                    p.selected = idx;
                    if multiple {
                        p.toggle();
                        None
                    } else {
                        app.submit_prompt()
                    }
                }
                _ => None,
            }
        }
        KeyCode::Enter => app.submit_prompt(),
        KeyCode::Esc => app.cancel_prompt(),
        _ => None,
    };

    let client = client.clone();
    match outcome {
        Some(PromptOutcome::Answer { request_id, answers }) => {
            tokio::spawn(async move {
                if let Err(err) = client.question_answer(&request_id, answers).await {
                    eprintln!("[question.answer error] {err}");
                }
            });
        }
        Some(PromptOutcome::Permission { request_id, decision }) => {
            tokio::spawn(async move {
                if let Err(err) = client.permission_answer(&request_id, &decision).await {
                    eprintln!("[permission.answer error] {err}");
                }
            });
        }
        Some(PromptOutcome::More) | None => {}
    }
}

/// Fires the RPC in the background; the response's StreamEvents arrive on
/// the shared IPC channel and are applied to `app` in the main select loop.
fn send_message(text: String, app: &mut App, client: &Arc<IpcClient>) {
    let Some(session_id) = app.session_id.clone() else {
        app.push_system("no active session".into());
        return;
    };
    app.push_user(text.clone());
    app.status = Status::Sending;

    let client = client.clone();
    tokio::spawn(async move {
        if let Err(err) = client.session_send(&session_id, &text, None).await {
            eprintln!("[session.send error] {err}");
        }
    });
}

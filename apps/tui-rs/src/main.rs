use freecode_tui::{app, commands, ipc, ui};

use std::io::stdout;
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{
    DisableMouseCapture, EnableMouseCapture, Event, EventStream, KeyCode, KeyEventKind,
    KeyModifiers, MouseButton, MouseEventKind,
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
use commands::{CommandOutcome, CommandRegistry};
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
    let registry = CommandRegistry::with_builtins();
    let mut input = TextArea::default();
    input.set_placeholder_text("Type a message, Enter to send, Esc to quit");

    let cwd = std::env::current_dir()?.to_string_lossy().to_string();
    app.cwd = cwd.clone();
    match client
        .session_start(SessionConfig {
            project_path: cwd,
            provider: None,
            agent_mode: Some(app.mode.keyword().into()),
        })
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
            terminal.draw(|frame| ui::draw(frame, &mut app, &input, &registry))?;
            dirty = false;
        }

        tokio::select! {
            maybe_event = crossterm_events.next() => {
                let Some(Ok(event)) = maybe_event else { continue };
                if handle_terminal_event(event, &mut app, &mut input, &registry, client).await? {
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
    registry: &CommandRegistry,
    client: &Arc<IpcClient>,
) -> Result<bool> {
    if let Event::Mouse(mouse) = &event {
        match mouse.kind {
            MouseEventKind::ScrollUp => app.scroll_up(3),
            MouseEventKind::ScrollDown => app.scroll_down(3),
            // Click to open/close the collapsed "Thought" chips.
            MouseEventKind::Down(MouseButton::Left) => app.toggle_thoughts_expanded(),
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
            handle_prompt_key(key.code, app, client).await;
            return Ok(false);
        }
        // While the composer holds a slash-command prefix, the completion menu
        // owns Up/Down (select) and Tab (complete). Everything else — including
        // Enter to run — falls through to the normal composer handling below.
        let text = input.lines().join("\n");
        let menu_len = commands::completions(registry, &text).len();
        if menu_len > 0 {
            match key.code {
                KeyCode::Up => {
                    app.command_menu_up();
                    return Ok(false);
                }
                KeyCode::Down => {
                    app.command_menu_down(menu_len);
                    return Ok(false);
                }
                KeyCode::Tab => {
                    let matches = commands::completions(registry, &text);
                    let idx = app.command_cursor(menu_len);
                    if let Some(cmd) = matches.get(idx) {
                        reset_composer(input);
                        input.insert_str(format!("/{} ", cmd.name()));
                        app.reset_command_cursor();
                    }
                    return Ok(false);
                }
                _ => {}
            }
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
                    reset_composer(input);
                    app.reset_command_cursor();
                    if commands::is_command(&text) {
                        match commands::dispatch(registry, &text, app) {
                            CommandOutcome::Quit => {
                                app.should_quit = true;
                                return Ok(true);
                            }
                            CommandOutcome::OpenModelPicker => {
                                open_provider_picker(app, client).await;
                            }
                            CommandOutcome::CompactSession => {
                                // Fire in the background; compaction_* stream
                                // events render progress on the shared channel.
                                if let Some(session_id) = app.session_id.clone() {
                                    let client = client.clone();
                                    tokio::spawn(async move {
                                        if let Err(err) =
                                            client.session_compact(&session_id).await
                                        {
                                            eprintln!("[session.compact error] {err}");
                                        }
                                    });
                                }
                            }
                            CommandOutcome::Done => {}
                        }
                    } else {
                        send_message(text, app, client);
                    }
                }
                return Ok(false);
            }
            _ => {}
        }
    }
    input.input(Input::from(event));
    Ok(false)
}

/// Empty the composer and restore its placeholder — used after sending a
/// message, running a command, or accepting a completion.
fn reset_composer(input: &mut TextArea<'_>) {
    *input = TextArea::default();
    input.set_placeholder_text("Type a message, Enter to send, Esc to quit");
}

/// Drive the open modal. Every path that closes a core-blocking prompt sends an
/// answer — leaving it unanswered would hang the turn forever. The local
/// `/model` pickers instead chain (provider → models) or persist the choice.
async fn handle_prompt_key(code: KeyCode, app: &mut App, client: &Arc<IpcClient>) {
    // The free-text "Other" field owns the keyboard while focused: keys type
    // into it rather than driving the picker.
    if app.prompt.as_ref().is_some_and(|p| p.editing_other) {
        let outcome = match code {
            KeyCode::Enter => app.confirm_other(),
            KeyCode::Esc => {
                app.prompt.as_mut().map(Prompt::stop_editing_other);
                None
            }
            KeyCode::Backspace => {
                app.prompt.as_mut().map(Prompt::other_backspace);
                None
            }
            KeyCode::Char(c) => {
                if let Some(p) = app.prompt.as_mut() {
                    p.other_push(c);
                }
                None
            }
            _ => None,
        };
        dispatch_prompt_outcome(outcome, client);
        return;
    }

    // Searchable `/model` pickers own printable keys for the search query, so
    // only the arrows/enter/esc/backspace drive the list; number keys and j/k
    // are search text here, not navigation.
    let outcome = if app.prompt.as_ref().is_some_and(Prompt::is_searchable) {
        match code {
            KeyCode::Up => {
                app.prompt.as_mut().map(Prompt::move_up);
                None
            }
            KeyCode::Down => {
                app.prompt.as_mut().map(Prompt::move_down);
                None
            }
            KeyCode::Backspace => {
                app.prompt.as_mut().map(Prompt::search_backspace);
                None
            }
            KeyCode::Char(c) => {
                if let Some(p) = app.prompt.as_mut() {
                    p.search_push(c);
                }
                None
            }
            KeyCode::Enter => app.activate_prompt(),
            KeyCode::Esc => app.cancel_prompt(),
            _ => None,
        }
    } else {
        match code {
            KeyCode::Up | KeyCode::Char('k') => {
                app.prompt.as_mut().map(Prompt::move_up);
                None
            }
            KeyCode::Down | KeyCode::Char('j') => {
                app.prompt.as_mut().map(Prompt::move_down);
                None
            }
            KeyCode::Char(' ') => {
                app.toggle_prompt();
                None
            }
            // Number keys jump straight to an option; in single-select they pick
            // it (or open the "Other" field), in multi-select they toggle it.
            KeyCode::Char(c @ '1'..='9') => {
                let idx = c as usize - '1' as usize;
                let in_range = app.prompt.as_ref().is_some_and(|p| idx < p.options.len());
                if in_range {
                    let multiple = app.prompt.as_ref().is_some_and(|p| p.multiple);
                    app.prompt.as_mut().unwrap().selected = idx;
                    if multiple {
                        app.toggle_prompt();
                        None
                    } else {
                        app.activate_prompt()
                    }
                } else {
                    None
                }
            }
            KeyCode::Enter => app.activate_prompt(),
            KeyCode::Esc => app.cancel_prompt(),
            _ => None,
        }
    };

    match outcome {
        // Step 1 → step 2: load the chosen provider's models and open the
        // model picker, pre-selecting the active model only when it belongs to
        // that provider.
        Some(PromptOutcome::Provider { provider }) => {
            let current = if provider == app.provider {
                app.model.clone()
            } else {
                String::new()
            };
            match client.models_list(&provider).await {
                Ok(models) if !models.is_empty() => {
                    app.open_model_picker(provider, current, models);
                }
                Ok(_) => app.push_system(format!("No models available for provider {provider}.")),
                Err(err) => app.push_system(format!("Failed to load models: {err}")),
            }
        }
        // Step 2: update local state (badge + meter) and persist the choice.
        Some(PromptOutcome::Model { provider, model }) => {
            app.set_model(provider.clone(), model.clone());
            app.push_system(format!("Model set to {provider}/{model}"));
            let client = client.clone();
            tokio::spawn(async move {
                if let Err(err) = client.set_current_model(&provider, &model).await {
                    eprintln!("[config.setCurrentModel error] {err}");
                }
            });
        }
        // Core-bound replies (question/permission) route through the shared
        // dispatcher; `More`/`None` leave the modal open.
        other => dispatch_prompt_outcome(other, client),
    }
}

/// Fire the RPC for a resolved prompt outcome. Every closing outcome must reach
/// core, or the blocked turn hangs forever; `More`/`None` mean the modal is
/// still open, so there is nothing to send yet. The local `/model` outcomes
/// (`Provider`/`Model`) are handled by the caller (they need `app`), so they
/// are no-ops here.
fn dispatch_prompt_outcome(outcome: Option<PromptOutcome>, client: &Arc<IpcClient>) {
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
        Some(PromptOutcome::Provider { .. })
        | Some(PromptOutcome::Model { .. })
        | Some(PromptOutcome::More)
        | None => {}
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

    // Read the current mode now; core reads agentMode per turn, so cycling
    // (Shift+Tab) takes effect on the next send.
    let agent_mode = app.mode.keyword();
    let client = client.clone();
    tokio::spawn(async move {
        if let Err(err) = client
            .session_send(&session_id, &text, None, Some(agent_mode))
            .await
        {
            eprintln!("[session.send error] {err}");
        }
    });
}

/// Open the first `/model` step. Fetches the provider list over IPC (awaited
/// inline in the event loop, like `session_start` at boot) and opens the
/// picker, pre-selecting the active provider. Failures surface as a system
/// message rather than an empty modal. Selecting a provider then loads its
/// models — see the `Provider` arm in `handle_prompt_key`.
async fn open_provider_picker(app: &mut App, client: &Arc<IpcClient>) {
    let current_provider = client
        .current_model()
        .await
        .ok()
        .flatten()
        .map(|c| c.provider)
        .unwrap_or_default();
    match client.providers_list().await {
        Ok(providers) if !providers.is_empty() => {
            app.open_provider_picker(providers, current_provider);
        }
        Ok(_) => app.push_system("No providers available.".into()),
        Err(err) => app.push_system(format!("Failed to load providers: {err}")),
    }
}

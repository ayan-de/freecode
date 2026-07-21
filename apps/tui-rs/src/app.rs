use crate::ipc::StreamEvent;

/// Agent mode drives tool/permissive behavior on the core side and the badge
/// shown in the status bar. Order matches `apps/tui/src/themes.ts` and
/// `apps/core/src/agent/types.ts` so Shift+Tab cycles through the same set
/// the TS TUI exposes.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    #[default]
    Plan,
    Build,
    Review,
    Explore,
    Danger,
}

impl Mode {
    /// Ordered list used by `cycle_mode`. Keeping it on the type (rather than
    /// duplicating in App) means new modes only need to be added in one place.
    pub const ALL: &'static [Mode] = &[
        Mode::Plan,
        Mode::Build,
        Mode::Review,
        Mode::Explore,
        Mode::Danger,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Mode::Plan => "PLAN",
            Mode::Build => "BUILD",
            Mode::Review => "REVIEW",
            Mode::Explore => "EXPLORE",
            Mode::Danger => "DANGER",
        }
    }
}

#[derive(Debug, Clone)]
pub enum Role {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
    /// Assistant reasoning streamed before/alongside the answer. Empty for
    /// user/system messages and assistant turns without a thinking phase.
    pub thinking: String,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    #[default]
    Idle,
    Sending,
}

/// Context-window usage pulled from the session. `limit == 0` means the core
/// hasn't reported a window size yet — the status bar will hide the meter
/// rather than show a divide-by-zero bar.
#[derive(Debug, Default, Clone, Copy)]
pub struct ContextUsage {
    pub tokens: u64,
    pub limit: u64,
}

impl ContextUsage {
    pub fn ratio(self) -> Option<f64> {
        if self.limit == 0 {
            None
        } else {
            Some((self.tokens as f64) / (self.limit as f64))
        }
    }
}

pub struct App {
    pub messages: Vec<ChatMessage>,
    pub session_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub status: Status,
    pub mode: Mode,
    pub context: ContextUsage,
    pub should_quit: bool,
    pub scroll: u16,
    /// When true the transcript sticks to the bottom as new content streams in;
    /// scrolling up releases it, scrolling back to the bottom re-arms it.
    pub follow: bool,
    pub cwd: String,
    pub tool_count: usize,
    in_progress: Option<usize>,
}

impl App {
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            session_id: None,
            provider: String::new(),
            model: String::new(),
            status: Status::Idle,
            mode: Mode::default(),
            context: ContextUsage::default(),
            should_quit: false,
            scroll: 0,
            follow: true,
            cwd: String::new(),
            tool_count: 0,
            in_progress: None,
        }
    }

    /// Advance to the next mode, wrapping at the end. Returns the new mode so
    /// callers (e.g., IPC push of the new agent mode) can react without
    /// re-reading `app.mode`.
    pub fn cycle_mode(&mut self) -> Mode {
        let idx = Mode::ALL
            .iter()
            .position(|m| *m == self.mode)
            .unwrap_or(0);
        self.mode = Mode::ALL[(idx + 1) % Mode::ALL.len()];
        self.mode
    }

    /// Update the provider/model. The context-window size is resolved
    /// separately by core (`models.contextLimit`) and applied via
    /// `context.limit`, keeping this frontend free of any hardcoded table.
    pub fn set_model(&mut self, provider: String, model: String) {
        self.provider = provider;
        self.model = model;
    }

    /// The turn number the composer is about to send (1-indexed), matching
    /// how many user prompts have already gone out.
    pub fn next_prompt_number(&self) -> usize {
        self.messages
            .iter()
            .filter(|m| matches!(m.role, Role::User))
            .count()
            + 1
    }

    /// Scroll the transcript up by `n` rows, releasing bottom-follow.
    pub fn scroll_up(&mut self, n: u16) {
        self.follow = false;
        self.scroll = self.scroll.saturating_sub(n);
    }

    /// Scroll down by `n` rows. The draw pass clamps to the real bottom and
    /// re-arms follow once we reach it.
    pub fn scroll_down(&mut self, n: u16) {
        self.scroll = self.scroll.saturating_add(n);
    }

    pub fn push_user(&mut self, content: String) {
        self.follow = true;
        self.messages.push(ChatMessage {
            role: Role::User,
            content,
            thinking: String::new(),
        });
    }

    pub fn push_system(&mut self, content: String) {
        self.messages.push(ChatMessage {
            role: Role::System,
            content,
            thinking: String::new(),
        });
    }

    pub fn begin_assistant_turn(&mut self) {
        self.messages.push(ChatMessage {
            role: Role::Assistant,
            content: String::new(),
            thinking: String::new(),
        });
        self.in_progress = Some(self.messages.len() - 1);
    }

    pub fn apply_stream_event(&mut self, event: StreamEvent) {
        // Token usage is derived from the `session.send` RPC result, which
        // resolves *after* the turn's Done event — by which point `in_progress`
        // is already cleared. Handle it before the in-progress guard below.
        if let StreamEvent::Usage { context_tokens } = &event {
            self.context.tokens = *context_tokens;
            return;
        }
        let Some(idx) = self.in_progress else { return };
        match event {
            StreamEvent::TextDelta { delta } => {
                self.messages[idx].content.push_str(&delta);
            }
            StreamEvent::Text { content } => {
                self.messages[idx].content = content;
            }
            StreamEvent::ThinkingDelta { delta } => {
                self.messages[idx].thinking.push_str(&delta);
            }
            StreamEvent::Thinking { content } => {
                self.messages[idx].thinking = content;
            }
            StreamEvent::ToolStart { tool_name, .. } => {
                self.push_system(format!("→ running {tool_name}"));
            }
            StreamEvent::ToolComplete { tool_name, success, .. } => {
                let mark = if success { "done" } else { "failed" };
                self.push_system(format!("← {tool_name} {mark}"));
            }
            StreamEvent::Error { content } => {
                self.push_system(format!("error: {content}"));
                self.status = Status::Idle;
                self.in_progress = None;
            }
            StreamEvent::Done { .. } => {
                self.status = Status::Idle;
                self.in_progress = None;
            }
            _ => {}
        }
    }
}


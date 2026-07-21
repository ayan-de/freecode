use std::time::Instant;

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
    /// Buffered-reveal tails: streamed deltas land here first and are drained
    /// into `content`/`thinking` at a fixed frame cadence (`reveal_step`), so
    /// uneven network chunks crawl in smoothly instead of appearing in bursts.
    pub content_pending: String,
    pub thinking_pending: String,
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
    /// Wall clock started when the app boots — drives the landing "particle
    /// materialize" intro (see `ui::intro`). Fixed at construction so the
    /// animation is a pure function of elapsed time and never re-triggers.
    pub started: Instant,
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
            started: Instant::now(),
            in_progress: None,
        }
    }

    /// Milliseconds since boot, as a float for the intro animation clock.
    pub fn intro_elapsed_ms(&self) -> f32 {
        self.started.elapsed().as_secs_f32() * 1000.0
    }

    /// The landing intro (looping logo materialize) is live whenever the
    /// transcript is empty. Once a message exists the landing is gone.
    pub fn intro_active(&self) -> bool {
        self.messages.is_empty()
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
            content_pending: String::new(),
            thinking_pending: String::new(),
        });
    }

    pub fn push_system(&mut self, content: String) {
        self.messages.push(ChatMessage {
            role: Role::System,
            content,
            thinking: String::new(),
            content_pending: String::new(),
            thinking_pending: String::new(),
        });
    }

    pub fn begin_assistant_turn(&mut self) {
        self.messages.push(ChatMessage {
            role: Role::Assistant,
            content: String::new(),
            thinking: String::new(),
            content_pending: String::new(),
            thinking_pending: String::new(),
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
            // Streamed deltas land in the pending tail, not directly on screen;
            // `reveal_step` drains them at a fixed cadence for a smooth crawl.
            StreamEvent::TextDelta { delta } => {
                self.messages[idx].content_pending.push_str(&delta);
            }
            // Full snapshot at turn end: reconcile against what's already been
            // revealed so the remainder still crawls in rather than snapping.
            StreamEvent::Text { content } => {
                let m = &mut self.messages[idx];
                if let Some(rest) = content.strip_prefix(m.content.as_str()) {
                    m.content_pending = rest.to_string();
                } else {
                    m.content.clear();
                    m.content_pending = content;
                }
            }
            StreamEvent::ThinkingDelta { delta } => {
                self.messages[idx].thinking_pending.push_str(&delta);
            }
            StreamEvent::Thinking { content } => {
                let m = &mut self.messages[idx];
                if let Some(rest) = content.strip_prefix(m.thinking.as_str()) {
                    m.thinking_pending = rest.to_string();
                } else {
                    m.thinking.clear();
                    m.thinking_pending = content;
                }
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

    /// Drain a slice of each message's pending tail into the visible text.
    /// Called once per render tick; returns `true` if anything changed so the
    /// caller can mark the frame dirty. Draining every message (not just the
    /// in-progress one) lets the crawl finish naturally after `Done` clears
    /// `in_progress`.
    pub fn reveal_step(&mut self) -> bool {
        let mut changed = false;
        for msg in &mut self.messages {
            if !msg.content_pending.is_empty() {
                reveal_chars(&mut msg.content, &mut msg.content_pending);
                changed = true;
            }
            if !msg.thinking_pending.is_empty() {
                reveal_chars(&mut msg.thinking, &mut msg.thinking_pending);
                changed = true;
            }
        }
        changed
    }
}

/// Move an adaptive number of chars from the front of `pending` to the end of
/// `visible`, respecting UTF-8 boundaries. Reveals ~1/5 of the backlog (min 3)
/// per call, so at a ~60 FPS tick a steady stream stays smooth (~80ms behind)
/// while a large burst is caught up within a few frames.
fn reveal_chars(visible: &mut String, pending: &mut String) {
    let backlog = pending.chars().count();
    let take = (backlog / 5).max(3);
    let byte_end = pending
        .char_indices()
        .nth(take)
        .map(|(i, _)| i)
        .unwrap_or(pending.len());
    visible.push_str(&pending[..byte_end]);
    pending.replace_range(..byte_end, "");
}


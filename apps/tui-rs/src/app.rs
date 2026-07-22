use std::time::Instant;

use crate::ipc::protocol::{QuestionSpec, StreamEvent};

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
    /// A tool call; the message's `tool` field carries the detail.
    Tool,
}

/// One tool call, rendered as a collapsed line that can be expanded to its
/// output. `success == None` means still running.
#[derive(Debug, Clone, Default)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// The one argument worth showing inline (path, command, pattern).
    pub summary: String,
    /// Streamed output lines, shown as a live tail while running.
    pub output: Vec<String>,
    pub result: String,
    pub success: Option<bool>,
    pub duration_ms: Option<u64>,
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
    /// Set only for `Role::Tool` entries.
    pub tool: Option<ToolCall>,
}

impl Default for ChatMessage {
    fn default() -> Self {
        Self {
            role: Role::System,
            content: String::new(),
            thinking: String::new(),
            content_pending: String::new(),
            thinking_pending: String::new(),
            tool: None,
        }
    }
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

/// What answering the prompt should send back to core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptKind {
    /// `question.answer` with the chosen option labels.
    Question,
    /// `permission.answer` with a `PermissionPromptDecision` value.
    Permission,
}

#[derive(Debug, Clone)]
pub struct PromptOption {
    pub label: String,
    pub description: String,
}

/// A modal awaiting the user. While one is open core is blocked, so the
/// composer is disabled and keys drive the picker instead.
#[derive(Debug, Clone)]
pub struct Prompt {
    pub kind: PromptKind,
    pub request_id: String,
    pub title: String,
    pub subtitle: String,
    pub options: Vec<PromptOption>,
    pub selected: usize,
    /// Multi-select (question `multiple`): Space toggles, Enter submits.
    pub multiple: bool,
    pub checked: Vec<bool>,
    /// Remaining questions in a multi-question ask, and the answers collected
    /// so far. Empty for permission prompts.
    pending: Vec<QuestionSpec>,
    answers: Vec<String>,
}

impl Prompt {
    fn from_question(request_id: String, spec: QuestionSpec, pending: Vec<QuestionSpec>, answers: Vec<String>) -> Self {
        let options: Vec<PromptOption> = spec
            .options
            .into_iter()
            .map(|o| PromptOption { label: o.label, description: o.description })
            .collect();
        Self {
            kind: PromptKind::Question,
            request_id,
            title: spec.header.unwrap_or_else(|| "Question".to_string()),
            subtitle: spec.question,
            checked: vec![false; options.len()],
            options,
            selected: 0,
            multiple: spec.multiple,
            pending,
            answers,
        }
    }

    pub fn move_up(&mut self) {
        self.selected = self.selected.checked_sub(1).unwrap_or(self.options.len().saturating_sub(1));
    }

    pub fn move_down(&mut self) {
        if !self.options.is_empty() {
            self.selected = (self.selected + 1) % self.options.len();
        }
    }

    pub fn toggle(&mut self) {
        if self.multiple {
            if let Some(c) = self.checked.get_mut(self.selected) {
                *c = !*c;
            }
        }
    }

    /// The values to send. Multi-select sends every checked option (falling
    /// back to the highlighted one if nothing was checked).
    fn chosen(&self) -> Vec<String> {
        if self.multiple {
            let picked: Vec<String> = self
                .options
                .iter()
                .zip(&self.checked)
                .filter(|(_, c)| **c)
                .map(|(o, _)| o.label.clone())
                .collect();
            if !picked.is_empty() {
                return picked;
            }
        }
        self.options
            .get(self.selected)
            .map(|o| vec![o.label.clone()])
            .unwrap_or_default()
    }
}

/// What the main loop should send to core after the user answers.
#[derive(Debug)]
pub enum PromptOutcome {
    /// `question.answer` — all questions in the ask are now answered.
    Answer { request_id: String, answers: Vec<String> },
    /// `permission.answer` with a decision value.
    Permission { request_id: String, decision: String },
    /// More questions remain in this ask; nothing to send yet.
    More,
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
    /// Ctrl+O expands finished tool calls to show their output.
    pub tools_expanded: bool,
    /// Open modal (question or permission). Core is blocked while this is set.
    pub prompt: Option<Prompt>,
    /// Wall clock started when the app boots — drives the landing "particle
    /// materialize" intro (see `ui::intro`). Fixed at construction so the
    /// animation is a pure function of elapsed time and never re-triggers.
    pub started: Instant,
    in_progress: Option<usize>,
    /// Activity "energy" in [0,1] driving the working oscilloscope's amplitude.
    /// Streamed deltas and tool events bump it up; it decays every tick so the
    /// waveform swells during bursts and settles to a gentle idle wobble in the
    /// gaps between them.
    energy: f32,
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
            tools_expanded: false,
            prompt: None,
            started: Instant::now(),
            in_progress: None,
            energy: 0.0,
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

    /// Seconds since boot — the phase clock for the working oscilloscope.
    pub fn osc_phase(&self) -> f32 {
        self.started.elapsed().as_secs_f32()
    }

    /// Current activity energy in [0,1], driving the oscilloscope amplitude.
    pub fn energy(&self) -> f32 {
        self.energy
    }

    /// Decay the activity energy one render tick (~16ms) toward zero, so a
    /// burst of streamed tokens fades to the idle wobble within ~100ms of the
    /// stream going quiet.
    pub fn decay_energy(&mut self) {
        self.energy *= 0.90;
    }

    /// Bump energy up (clamped to 1) in response to streaming activity.
    fn bump_energy(&mut self, amount: f32) {
        self.energy = (self.energy + amount).min(1.0);
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
            ..Default::default()
        });
    }

    pub fn push_system(&mut self, content: String) {
        self.messages.push(ChatMessage {
            role: Role::System,
            content,
            ..Default::default()
        });
    }

    pub fn begin_assistant_turn(&mut self) {
        self.messages.push(ChatMessage {
            role: Role::Assistant,
            ..Default::default()
        });
        self.in_progress = Some(self.messages.len() - 1);
    }

    /// Toggle expansion of every finished tool call. A per-call selection
    /// model would need cursor navigation the transcript doesn't have yet.
    /// ponytail: global toggle, add per-call selection when the transcript
    /// grows a cursor.
    pub fn toggle_tools_expanded(&mut self) {
        self.tools_expanded = !self.tools_expanded;
    }

    /// The assistant message currently receiving text, opening a new one if a
    /// tool call closed the last. Returns `None` when no turn is in flight, so
    /// late events after `Done` are dropped rather than starting a stray message.
    fn open_assistant(&mut self) -> Option<usize> {
        if self.status != Status::Sending {
            return None;
        }
        if self.in_progress.is_none() {
            self.begin_assistant_turn();
        }
        self.in_progress
    }

    /// Accept the highlighted (or checked) options. Advances to the next
    /// question when the ask carried several; otherwise closes the modal and
    /// returns what to send to core.
    pub fn submit_prompt(&mut self) -> Option<PromptOutcome> {
        let prompt = self.prompt.take()?;
        let chosen = prompt.chosen();

        if prompt.kind == PromptKind::Permission {
            return Some(PromptOutcome::Permission {
                request_id: prompt.request_id,
                decision: permission_decision(prompt.selected),
            });
        }

        let mut answers = prompt.answers;
        answers.extend(chosen);
        let mut pending = prompt.pending;
        if pending.is_empty() {
            return Some(PromptOutcome::Answer { request_id: prompt.request_id, answers });
        }
        let next = pending.remove(0);
        self.prompt = Some(Prompt::from_question(prompt.request_id, next, pending, answers));
        Some(PromptOutcome::More)
    }

    /// Esc: reject the question outright, or deny the permission. Either way
    /// core unblocks — never leave it waiting.
    pub fn cancel_prompt(&mut self) -> Option<PromptOutcome> {
        let prompt = self.prompt.take()?;
        match prompt.kind {
            PromptKind::Permission => Some(PromptOutcome::Permission {
                request_id: prompt.request_id,
                decision: "deny".to_string(),
            }),
            PromptKind::Question => Some(PromptOutcome::Answer {
                request_id: prompt.request_id,
                answers: Vec::new(),
            }),
        }
    }

    /// The tool entry for `id`, searched from the end since the call being
    /// updated is almost always the most recent one.
    fn tool_mut(&mut self, id: &str) -> Option<&mut ToolCall> {
        self.messages
            .iter_mut()
            .rev()
            .find_map(|m| m.tool.as_mut().filter(|t| t.id == id))
    }

    pub fn apply_stream_event(&mut self, event: StreamEvent) {
        // Token usage is derived from the `session.send` RPC result, which
        // resolves *after* the turn's Done event — by which point `in_progress`
        // is already cleared. Handle it before the in-progress guard below.
        if let StreamEvent::Usage { context_tokens } = &event {
            self.context.tokens = *context_tokens;
            return;
        }
        // Text/thinking events lazily open an assistant message. A tool call
        // closes the current one, so the next step's text lands *after* the
        // tool in the transcript rather than being folded back into the text
        // that preceded it.
        let idx = match event {
            StreamEvent::TextDelta { .. }
            | StreamEvent::Text { .. }
            | StreamEvent::ThinkingDelta { .. }
            | StreamEvent::Thinking { .. } => match self.open_assistant() {
                Some(idx) => idx,
                None => return,
            },
            _ => usize::MAX,
        };
        match event {
            // Streamed deltas land in the pending tail, not directly on screen;
            // `reveal_step` drains them at a fixed cadence for a smooth crawl.
            StreamEvent::TextDelta { delta } => {
                self.messages[idx].content_pending.push_str(&delta);
                self.bump_energy(0.06);
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
                self.bump_energy(0.05);
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
            StreamEvent::ToolStart { tool_call_id, tool_name, args } => {
                self.messages.push(ChatMessage {
                    role: Role::Tool,
                    tool: Some(ToolCall {
                        summary: arg_summary(&args),
                        id: tool_call_id,
                        name: tool_name,
                        ..Default::default()
                    }),
                    ..Default::default()
                });
                self.in_progress = None;
                self.bump_energy(0.9);
            }
            StreamEvent::ToolOutput { tool_call_id, content } => {
                if let Some(call) = self.tool_mut(&tool_call_id) {
                    call.output
                        .extend(content.lines().map(str::to_string));
                }
                self.bump_energy(0.3);
            }
            StreamEvent::ToolComplete {
                tool_call_id,
                success,
                result,
                duration_ms,
                ..
            } => {
                if let Some(call) = self.tool_mut(&tool_call_id) {
                    call.success = Some(success);
                    call.result = result;
                    call.duration_ms = duration_ms;
                    call.output.clear();
                }
                self.bump_energy(0.7);
            }
            StreamEvent::QuestionAsked { request_id, mut questions } => {
                if questions.is_empty() {
                    return;
                }
                let first = questions.remove(0);
                self.follow = true;
                self.prompt = Some(Prompt::from_question(request_id, first, questions, Vec::new()));
            }
            StreamEvent::PermissionAsked {
                request_id,
                tool_name,
                description,
                suggested_rule,
                reason,
            } => {
                self.follow = true;
                self.prompt = Some(Prompt {
                    kind: PromptKind::Permission,
                    request_id,
                    title: format!("{tool_name} wants to run"),
                    subtitle: if description.is_empty() { reason.unwrap_or_default() } else { description },
                    options: permission_options(suggested_rule),
                    selected: 0,
                    multiple: false,
                    checked: vec![false; 4],
                    pending: Vec::new(),
                    answers: Vec::new(),
                });
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


/// The one argument worth showing beside a tool name. Tries the conventional
/// keys first, then falls back to whatever string argument exists, so MCP
/// tools with unknown schemas still get a useful label.
fn arg_summary(args: &serde_json::Value) -> String {
    const KEYS: &[&str] = &["file_path", "path", "command", "pattern", "query", "url"];
    let pick = KEYS
        .iter()
        .find_map(|k| args.get(*k).and_then(|v| v.as_str()))
        .or_else(|| args.as_object()?.values().find_map(|v| v.as_str()));
    pick.map(|s| s.lines().next().unwrap_or(s).to_string())
        .unwrap_or_default()
}

/// Permission choices, in the order `permission_decision` maps them. The
/// "always" row names the rule core suggested so it is obvious what is being
/// persisted.
fn permission_options(suggested_rule: Option<String>) -> Vec<PromptOption> {
    let always = match suggested_rule {
        Some(rule) => format!("Always allow {rule}"),
        None => "Always allow".to_string(),
    };
    vec![
        PromptOption { label: "Allow once".into(), description: "Run this one time".into() },
        PromptOption { label: "Allow for this session".into(), description: "Stop asking until you quit".into() },
        PromptOption { label: always, description: "Persist a permission rule".into() },
        PromptOption { label: "Deny".into(), description: "Refuse and tell the agent".into() },
    ]
}

/// Row index → the `PermissionPromptDecision` wire value.
fn permission_decision(index: usize) -> String {
    match index {
        0 => "allow-once",
        1 => "allow-session",
        2 => "allow-always",
        _ => "deny",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tool_lifecycle() {
        let mut app = App::new();
        app.status = Status::Sending;
        app.apply_stream_event(StreamEvent::ToolStart {
            tool_call_id: "a".into(),
            tool_name: "bash".into(),
            args: json!({ "command": "ls -l\nsecond line" }),
        });
        app.apply_stream_event(StreamEvent::ToolOutput {
            tool_call_id: "a".into(),
            content: "one\ntwo".into(),
        });
        let call = app.messages.last().unwrap().tool.as_ref().unwrap();
        assert_eq!(call.summary, "ls -l", "summary is the first line only");
        assert_eq!(call.output.len(), 2);
        assert!(call.success.is_none());

        app.apply_stream_event(StreamEvent::ToolComplete {
            tool_call_id: "a".into(),
            tool_name: "bash".into(),
            result: "total 0".into(),
            success: true,
            duration_ms: Some(300),
        });
        let call = app.messages.last().unwrap().tool.as_ref().unwrap();
        assert_eq!(call.success, Some(true));
        assert_eq!(call.result, "total 0");
        assert!(call.output.is_empty(), "live tail is dropped on completion");
    }

    /// Text arriving after a tool call must land *after* it in the transcript,
    /// not be folded back into the text that preceded the call.
    #[test]
    fn text_after_a_tool_call_stays_below_it() {
        let mut app = App::new();
        app.status = Status::Sending;
        app.apply_stream_event(StreamEvent::TextDelta { delta: "before".into() });
        app.apply_stream_event(StreamEvent::ToolStart {
            tool_call_id: "a".into(),
            tool_name: "read".into(),
            args: json!({ "file_path": "x.rs" }),
        });
        app.apply_stream_event(StreamEvent::TextDelta { delta: "after".into() });

        let roles: Vec<_> = app.messages.iter().map(|m| format!("{:?}", m.role)).collect();
        assert_eq!(roles, ["Assistant", "Tool", "Assistant"]);
    }

    fn question(header: &str, multiple: bool) -> serde_json::Value {
        json!({
            "header": header,
            "question": "which?",
            "multiple": multiple,
            "options": [{ "label": "A", "description": "" }, { "label": "B", "description": "" }],
        })
    }

    /// A multi-question ask must collect every answer before replying, or core
    /// stays blocked on the questions it never heard back about.
    #[test]
    fn multi_question_ask_is_answered_once_at_the_end() {
        let mut app = App::new();
        app.apply_stream_event(
            serde_json::from_value(json!({
                "type": "question_asked",
                "requestId": "r1",
                "questions": [question("one", false), question("two", true)],
            }))
            .unwrap(),
        );
        assert_eq!(app.prompt.as_ref().unwrap().title, "one");

        // First question: pick B.
        app.prompt.as_mut().unwrap().selected = 1;
        assert!(matches!(app.submit_prompt(), Some(PromptOutcome::More)));
        assert_eq!(app.prompt.as_ref().unwrap().title, "two");

        // Second is multi-select: check both.
        let p = app.prompt.as_mut().unwrap();
        p.toggle();
        p.move_down();
        p.toggle();
        match app.submit_prompt() {
            Some(PromptOutcome::Answer { request_id, answers }) => {
                assert_eq!(request_id, "r1");
                assert_eq!(answers, ["B", "A", "B"]);
            }
            other => panic!("expected a final answer, got {other:?}"),
        }
        assert!(app.prompt.is_none());
    }

    /// Esc must always unblock core — denying, never silently closing.
    #[test]
    fn escaping_a_permission_denies_it() {
        let mut app = App::new();
        app.apply_stream_event(
            serde_json::from_value(json!({
                "type": "permission_asked",
                "requestId": "r2",
                "toolName": "bash",
                "description": "rm -rf /",
                "suggestedRule": "Bash(rm:*)",
            }))
            .unwrap(),
        );
        match app.cancel_prompt() {
            Some(PromptOutcome::Permission { request_id, decision }) => {
                assert_eq!(request_id, "r2");
                assert_eq!(decision, "deny");
            }
            other => panic!("expected a deny, got {other:?}"),
        }
    }

    #[test]
    fn summary_falls_back_to_any_string_arg() {
        assert_eq!(arg_summary(&json!({ "weird": "x", "n": 1 })), "x");
        assert_eq!(arg_summary(&json!({ "n": 1 })), "");
    }
}

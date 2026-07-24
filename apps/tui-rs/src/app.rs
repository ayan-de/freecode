use std::collections::HashSet;
use std::time::Instant;

use crate::ipc::protocol::{QuestionSpec, StreamEvent};

/// Agent mode drives tool/permissive behavior on the core side and the badge
/// shown in the status bar. Order matches `apps/tui/src/themes.ts` and
/// `apps/core/src/agent/types.ts` so Shift+Tab cycles through the same set
/// the TS TUI exposes.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Plan,
    #[default]
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

    /// Nerd Font icon shown before the label in the mode badge. Empty modes fall
    /// back to just the label until an icon is chosen for them.
    pub fn icon(self) -> &'static str {
        match self {
            Mode::Plan => "",
            Mode::Build => "",
            Mode::Review => "",
            Mode::Explore => "",
            Mode::Danger => "󰯆",
        }
    }

    /// Lowercase keyword sent to core as `agentMode` (`plan`/`build`/…). Core
    /// expects lowercase, so this is the wire form of `label`.
    pub fn keyword(self) -> &'static str {
        match self {
            Mode::Plan => "plan",
            Mode::Build => "build",
            Mode::Review => "review",
            Mode::Explore => "explore",
            Mode::Danger => "danger",
        }
    }

    /// Parse a lowercase keyword (e.g. from `/mode build`) into a `Mode`. The
    /// inverse of `label`, so the `/mode` command and the badge stay in sync.
    pub fn from_keyword(s: &str) -> Option<Mode> {
        match s {
            "plan" => Some(Mode::Plan),
            "build" => Some(Mode::Build),
            "review" => Some(Mode::Review),
            "explore" => Some(Mode::Explore),
            "danger" => Some(Mode::Danger),
            _ => None,
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
    /// First step of `/model`: pick a provider, then its models load.
    Provider,
    /// Second step of `/model` — `config.setCurrentModel`, not a core ask.
    Model,
}

#[derive(Debug, Clone)]
pub struct PromptOption {
    pub label: String,
    pub description: String,
    /// The value to send when this row is chosen, if it differs from `label`.
    /// Model rows carry the model id here (the label is the pretty name);
    /// questions/permissions leave it `None` and answer with the label.
    pub value: Option<String>,
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
    /// Index of the synthetic free-text "Other" row (always the last option on
    /// a question). `None` for permission prompts, which have no escape hatch.
    other_index: Option<usize>,
    /// True while the "Other" text field is focused: keys type into
    /// `other_text` instead of driving the picker.
    pub editing_other: bool,
    /// The custom answer typed into the "Other" field.
    pub other_text: String,
    /// For the model picker (`PromptKind::Model`), the provider its models
    /// belong to — so submitting resolves to `provider/model`, even when the
    /// user switched providers first. `None` for every other kind.
    target_provider: Option<String>,
    /// Type-to-search query for the `/model` pickers (`is_searchable`). Filters
    /// the option list by substring on label/value; empty for questions and
    /// permissions, which are never searchable.
    pub search: String,
    /// Remaining questions in a multi-question ask, and the answers collected
    /// so far. Empty for permission prompts.
    pending: Vec<QuestionSpec>,
    answers: Vec<String>,
}

impl Prompt {
    fn from_question(request_id: String, spec: QuestionSpec, pending: Vec<QuestionSpec>, answers: Vec<String>) -> Self {
        let mut options: Vec<PromptOption> = spec
            .options
            .into_iter()
            .map(|o| PromptOption { label: o.label, description: o.description, value: None })
            .collect();
        // Every question gets a free-text escape hatch as its last row, so the
        // user can answer with something none of the offered options cover.
        let other_index = Some(options.len());
        options.push(PromptOption {
            label: "Other".to_string(),
            description: "Type your own answer".to_string(),
            value: None,
        });
        Self {
            kind: PromptKind::Question,
            request_id,
            title: spec.header.unwrap_or_else(|| "Question".to_string()),
            subtitle: spec.question,
            checked: vec![false; options.len()],
            options,
            selected: 0,
            multiple: spec.multiple,
            other_index,
            editing_other: false,
            other_text: String::new(),
            target_provider: None,
            search: String::new(),
            pending,
            answers,
        }
    }

    /// First step of `/model`: pick a provider. The current one is pre-selected
    /// and badged; providers without an API key are flagged so the choice is
    /// informed. Selecting one loads its models (`ui::prompt` renders this like
    /// the question modal).
    fn provider(providers: Vec<crate::ipc::protocol::ProviderInfo>, current: String) -> Self {
        let selected = providers.iter().position(|p| p.id == current).unwrap_or(0);
        let options: Vec<PromptOption> = providers
            .into_iter()
            .map(|p| {
                let is_current = p.id == current;
                let mut description = p.description;
                if !p.has_api_key {
                    description = if description.is_empty() {
                        "needs API key".to_string()
                    } else {
                        format!("{description} · needs API key")
                    };
                }
                PromptOption {
                    label: if is_current { format!("{}  (current)", p.name) } else { p.name },
                    description,
                    value: Some(p.id),
                }
            })
            .collect();
        Self {
            kind: PromptKind::Provider,
            request_id: String::new(),
            title: "Select provider".to_string(),
            subtitle: "Choose a provider, then a model".to_string(),
            checked: vec![false; options.len()],
            options,
            selected,
            multiple: false,
            other_index: None,
            editing_other: false,
            other_text: String::new(),
            target_provider: None,
            search: String::new(),
            pending: Vec::new(),
            answers: Vec::new(),
        }
    }

    /// Second step of `/model`: one row per model for `provider`, the current
    /// one pre-selected and badged. Resolves to `config.setCurrentModel` on
    /// submit; `provider` is stashed so a cross-provider switch persists the
    /// right pair.
    fn model(provider: String, current: String, models: Vec<crate::ipc::protocol::ModelInfo>) -> Self {
        let selected = models.iter().position(|m| m.id == current).unwrap_or(0);
        let options: Vec<PromptOption> = models
            .into_iter()
            .map(|m| {
                let is_current = m.id == current;
                let name = m.name.unwrap_or_else(|| m.id.clone());
                PromptOption {
                    label: if is_current { format!("{name}  (current)") } else { name },
                    description: m.description.unwrap_or_default(),
                    value: Some(m.id),
                }
            })
            .collect();
        Self {
            kind: PromptKind::Model,
            request_id: String::new(),
            title: format!("Model · {provider}"),
            subtitle: "Select the active model".to_string(),
            checked: vec![false; options.len()],
            options,
            selected,
            multiple: false,
            other_index: None,
            editing_other: false,
            other_text: String::new(),
            target_provider: Some(provider),
            search: String::new(),
            pending: Vec::new(),
            answers: Vec::new(),
        }
    }

    fn selected_is_other(&self) -> bool {
        Some(self.selected) == self.other_index
    }

    /// Focus the free-text field, moving the cursor onto the "Other" row.
    pub fn start_editing_other(&mut self) {
        if let Some(i) = self.other_index {
            self.selected = i;
            self.editing_other = true;
        }
    }

    pub fn stop_editing_other(&mut self) {
        self.editing_other = false;
    }

    pub fn other_push(&mut self, c: char) {
        self.other_text.push(c);
    }

    pub fn other_backspace(&mut self) {
        self.other_text.pop();
    }

    pub fn move_up(&mut self) {
        let n = self.filtered_indices().len();
        self.selected = self.selected.checked_sub(1).unwrap_or(n.saturating_sub(1));
    }

    pub fn move_down(&mut self) {
        let n = self.filtered_indices().len();
        if n > 0 {
            self.selected = (self.selected + 1) % n;
        }
    }

    /// Whether this modal has a type-to-search line above a scrolling list —
    /// the `/model` provider and model pickers. Questions/permissions do not.
    pub fn is_searchable(&self) -> bool {
        matches!(self.kind, PromptKind::Provider | PromptKind::Model)
    }

    /// Indices into `options` that match the current `search`, preserving order.
    /// With no query (all non-searchable modals) this is simply every index, so
    /// `selected` indexes it identically to `options` — keeping questions and
    /// permissions unchanged.
    pub fn filtered_indices(&self) -> Vec<usize> {
        if self.search.is_empty() {
            return (0..self.options.len()).collect();
        }
        let q = self.search.to_lowercase();
        self.options
            .iter()
            .enumerate()
            .filter(|(_, o)| {
                o.label.to_lowercase().contains(&q)
                    || o.value.as_deref().is_some_and(|v| v.to_lowercase().contains(&q))
            })
            .map(|(i, _)| i)
            .collect()
    }

    /// The option under the cursor, mapping the filtered view position back to
    /// the underlying `options`. `None` when the search matches nothing.
    fn selected_option(&self) -> Option<&PromptOption> {
        let idx = *self.filtered_indices().get(self.selected)?;
        self.options.get(idx)
    }

    /// Append to the search query and reset the cursor to the first match, the
    /// way the TS TUI rebuilds its list on each keystroke.
    pub fn search_push(&mut self, c: char) {
        self.search.push(c);
        self.selected = 0;
    }

    pub fn search_backspace(&mut self) {
        self.search.pop();
        self.selected = 0;
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
            let picked: Vec<String> = (0..self.options.len())
                .filter(|&i| self.checked.get(i).copied().unwrap_or(false))
                .filter_map(|i| self.label_for(i))
                .collect();
            if !picked.is_empty() {
                return picked;
            }
        }
        self.label_for(self.selected).map(|l| vec![l]).unwrap_or_default()
    }

    /// The answer string for option `i`: the typed text for the free-text
    /// "Other" row, the option's label otherwise. `None` when it's the "Other"
    /// row but nothing was typed, so a blank custom answer is never sent.
    fn label_for(&self, i: usize) -> Option<String> {
        if Some(i) == self.other_index {
            let t = self.other_text.trim();
            (!t.is_empty()).then(|| t.to_string())
        } else {
            self.options.get(i).map(|o| o.label.clone())
        }
    }
}

/// What the main loop should send to core after the user answers.
#[derive(Debug)]
pub enum PromptOutcome {
    /// `question.answer` — all questions in the ask are now answered.
    Answer { request_id: String, answers: Vec<String> },
    /// `permission.answer` with a decision value.
    Permission { request_id: String, decision: String },
    /// `/model` step 1: a provider was chosen; load its models next.
    Provider { provider: String },
    /// `/model` step 2: persist `provider`/`model` via `config.setCurrentModel`.
    Model { provider: String, model: String },
    /// More questions remain in this ask; nothing to send yet.
    More,
}

/// A clickable transcript chip and the message index it toggles.
#[derive(Clone, Copy)]
pub enum Chip {
    Thought(usize),
    Tool(usize),
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
    /// Message indices whose "Thought" chip is expanded. Clicking a chip toggles
    /// just that one (per-thought, not global).
    pub expanded_thoughts: HashSet<usize>,
    /// Message indices whose tool call is individually expanded by a click.
    /// Independent of `tools_expanded` (Ctrl+O), which expands all at once.
    pub expanded_tools: HashSet<usize>,
    /// Click hit-testing for "Thought" and tool chips, refreshed each render:
    /// `(wrapped_row, chip)` for each chip, plus the transcript's top row and
    /// height so a mouse row maps back to a specific chip.
    pub chip_hits: Vec<(u16, Chip)>,
    pub transcript_top: u16,
    pub transcript_height: u16,
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
    /// Highlighted row in the slash-command completion menu. Clamped to the
    /// live match count on read (`command_cursor`), so it stays valid as the
    /// user types and the match list shrinks.
    cmd_cursor: usize,
    /// First Esc "arms" quit; a second Esc within a short window confirms it.
    /// Any other key disarms. Guards against a stray Esc killing the session.
    pub esc_armed: Option<Instant>,
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
            expanded_thoughts: HashSet::new(),
            expanded_tools: HashSet::new(),
            chip_hits: Vec::new(),
            transcript_top: 0,
            transcript_height: 0,
            prompt: None,
            started: Instant::now(),
            in_progress: None,
            energy: 0.0,
            cmd_cursor: 0,
            esc_armed: None,
        }
    }

    /// Drop the transcript and reset scroll/turn state. The core session is
    /// untouched — this only clears what the frontend shows (`/clear`).
    pub fn clear_messages(&mut self) {
        self.messages.clear();
        self.expanded_thoughts.clear();
        self.expanded_tools.clear();
        self.chip_hits.clear();
        self.scroll = 0;
        self.follow = true;
        self.in_progress = None;
    }

    /// The highlighted completion row, clamped to the current `count` of
    /// matches so a stale index from a longer list never points past the end.
    pub fn command_cursor(&self, count: usize) -> usize {
        self.cmd_cursor.min(count.saturating_sub(1))
    }

    pub fn command_menu_up(&mut self) {
        self.cmd_cursor = self.cmd_cursor.saturating_sub(1);
    }

    pub fn command_menu_down(&mut self, count: usize) {
        if count > 0 {
            self.cmd_cursor = (self.cmd_cursor + 1).min(count - 1);
        }
    }

    pub fn reset_command_cursor(&mut self) {
        self.cmd_cursor = 0;
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

    pub fn is_thought_expanded(&self, msg_idx: usize) -> bool {
        self.expanded_thoughts.contains(&msg_idx)
    }

    pub fn is_tool_expanded(&self, msg_idx: usize) -> bool {
        self.expanded_tools.contains(&msg_idx)
    }

    /// Toggle whichever chip was clicked.
    pub fn toggle_chip(&mut self, chip: Chip) {
        let set = match chip {
            Chip::Thought(_) => &mut self.expanded_thoughts,
            Chip::Tool(_) => &mut self.expanded_tools,
        };
        let idx = match chip {
            Chip::Thought(i) | Chip::Tool(i) => i,
        };
        if !set.remove(&idx) {
            set.insert(idx);
        }
    }

    /// Which chip sits at absolute terminal `row`, if any. Uses the hit map
    /// recorded during the last render: a chip header occupies a single wrapped
    /// row, offset by the transcript's scroll and top.
    pub fn chip_at(&self, row: u16) -> Option<Chip> {
        if row < self.transcript_top
            || row >= self.transcript_top + self.transcript_height
        {
            return None;
        }
        let visual = self.scroll + (row - self.transcript_top);
        self.chip_hits
            .iter()
            .find(|(wrapped_row, _)| *wrapped_row == visual)
            .map(|(_, chip)| *chip)
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

        if prompt.kind == PromptKind::Permission {
            return Some(PromptOutcome::Permission {
                request_id: prompt.request_id,
                decision: permission_decision(prompt.selected),
            });
        }

        if prompt.kind == PromptKind::Provider {
            // Rows carry the provider id in `value`; the loop loads its models.
            return prompt
                .selected_option()
                .and_then(|o| o.value.clone())
                .map(|provider| PromptOutcome::Provider { provider });
        }

        if prompt.kind == PromptKind::Model {
            // Each row carries its model id in `value`; the label is the pretty
            // name. `target_provider` names the provider the list was loaded
            // for, so a cross-provider switch persists the right pair.
            let provider = prompt.target_provider.clone().unwrap_or_default();
            return prompt
                .selected_option()
                .and_then(|o| o.value.clone())
                .map(|model| PromptOutcome::Model { provider, model });
        }

        let chosen = prompt.chosen();

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

    /// Open the first `/model` step: the provider picker, pre-selecting the
    /// active provider. Re-arms follow so the transcript isn't left scrolled up
    /// behind the modal.
    pub fn open_provider_picker(
        &mut self,
        providers: Vec<crate::ipc::protocol::ProviderInfo>,
        current_provider: String,
    ) {
        self.follow = true;
        self.prompt = Some(Prompt::provider(providers, current_provider));
    }

    /// Open the second `/model` step: the model picker for `provider`,
    /// pre-selecting `current`.
    pub fn open_model_picker(
        &mut self,
        provider: String,
        current: String,
        models: Vec<crate::ipc::protocol::ModelInfo>,
    ) {
        self.follow = true;
        self.prompt = Some(Prompt::model(provider, current, models));
    }

    /// Enter (or a number key in single-select) on the picker. Choosing the
    /// free-text "Other" row opens its input field instead of submitting; every
    /// other row submits. In multi-select, Enter submits all checked options.
    pub fn activate_prompt(&mut self) -> Option<PromptOutcome> {
        let p = self.prompt.as_mut()?;
        if !p.multiple && p.selected_is_other() {
            p.start_editing_other();
            return None;
        }
        // A searchable picker with no match under the cursor: ignore Enter so
        // the modal stays open rather than closing on an empty selection.
        if p.is_searchable() && p.selected_option().is_none() {
            return None;
        }
        self.submit_prompt()
    }

    /// Space / number-key toggle. On the "Other" row this opens the free-text
    /// field; on any other row it toggles the checkbox (multi-select only).
    pub fn toggle_prompt(&mut self) {
        if let Some(p) = self.prompt.as_mut() {
            if p.selected_is_other() {
                p.start_editing_other();
            } else {
                p.toggle();
            }
        }
    }

    /// Confirm the typed free-text answer. Single-select submits it right away;
    /// multi-select records it (checking the "Other" row) and returns to the
    /// picker. Empty text just closes the field, leaving "Other" unchecked.
    pub fn confirm_other(&mut self) -> Option<PromptOutcome> {
        let p = self.prompt.as_mut()?;
        let empty = p.other_text.trim().is_empty();
        if let Some(i) = p.other_index {
            if let Some(c) = p.checked.get_mut(i) {
                *c = !empty;
            }
        }
        p.stop_editing_other();
        if empty || p.multiple {
            return None;
        }
        self.submit_prompt()
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
            // The `/model` pickers are local overlays — Esc just closes them;
            // core was never blocked, so there is nothing to unblock.
            PromptKind::Provider | PromptKind::Model => None,
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
        // Emitted by `set_current_model` after a `/model` switch so the meter's
        // denominator follows the newly selected model's window.
        if let StreamEvent::ContextLimit { limit } = &event {
            self.context.limit = *limit;
            return;
        }
        // Compaction progress — a system line, no assistant message involved.
        if let StreamEvent::CompactionStart { .. } = &event {
            self.push_system("Compacting conversation…".into());
            return;
        }
        if let StreamEvent::CompactionComplete {
            compacted,
            tokens_before,
            tokens_after,
            reason,
            trigger,
            ..
        } = &event
        {
            if *compacted {
                self.push_system(format!(
                    "Compacted context: ~{tokens_before} → ~{tokens_after} tokens"
                ));
            } else if trigger == "manual" {
                let why = reason.clone().unwrap_or_else(|| "nothing to compact".into());
                self.push_system(format!("Nothing to compact ({why})."));
            }
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
                    other_index: None,
                    editing_other: false,
                    other_text: String::new(),
                    target_provider: None,
                    search: String::new(),
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
        PromptOption { label: "Allow once".into(), description: "Run this one time".into(), value: None },
        PromptOption { label: "Allow for this session".into(), description: "Stop asking until you quit".into(), value: None },
        PromptOption { label: always, description: "Persist a permission rule".into(), value: None },
        PromptOption { label: "Deny".into(), description: "Refuse and tell the agent".into(), value: None },
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

    /// Single-select: choosing "Other" opens the field, and the typed text is
    /// what gets sent — not the literal word "Other".
    #[test]
    fn other_option_sends_typed_free_text() {
        let mut app = App::new();
        app.apply_stream_event(
            serde_json::from_value(json!({
                "type": "question_asked",
                "requestId": "r3",
                "questions": [question("pick", false)],
            }))
            .unwrap(),
        );

        // Options are [A, B, Other]; jump to the "Other" row and activate it.
        let p = app.prompt.as_mut().unwrap();
        p.selected = 2;
        assert!(app.activate_prompt().is_none(), "activating Other opens the field, does not submit");
        assert!(app.prompt.as_ref().unwrap().editing_other);

        // Type an answer, then submit it.
        let p = app.prompt.as_mut().unwrap();
        for c in "custom".chars() {
            p.other_push(c);
        }
        match app.confirm_other() {
            Some(PromptOutcome::Answer { request_id, answers }) => {
                assert_eq!(request_id, "r3");
                assert_eq!(answers, ["custom"]);
            }
            other => panic!("expected the typed answer, got {other:?}"),
        }
        assert!(app.prompt.is_none());
    }

    /// Multi-select: a typed "Other" answer is included alongside checked
    /// options, and confirming it returns to the picker rather than submitting.
    #[test]
    fn other_option_combines_with_multi_select() {
        let mut app = App::new();
        app.apply_stream_event(
            serde_json::from_value(json!({
                "type": "question_asked",
                "requestId": "r4",
                "questions": [question("pick", true)],
            }))
            .unwrap(),
        );

        // Check A, then open + type into Other (index 2).
        let p = app.prompt.as_mut().unwrap();
        p.toggle(); // A
        p.selected = 2;
        app.toggle_prompt(); // opens the Other field
        assert!(app.prompt.as_ref().unwrap().editing_other);
        for c in "extra".chars() {
            app.prompt.as_mut().unwrap().other_push(c);
        }
        assert!(app.confirm_other().is_none(), "multi-select confirm returns to picker");
        assert!(!app.prompt.as_ref().unwrap().editing_other);

        match app.submit_prompt() {
            Some(PromptOutcome::Answer { answers, .. }) => assert_eq!(answers, ["A", "extra"]),
            other => panic!("expected A + typed answer, got {other:?}"),
        }
    }

    /// The model picker pre-selects the current model and, on submit, resolves
    /// to the chosen model's *id* (from `value`) rather than its display label.
    #[test]
    fn model_picker_submits_selected_id_not_label() {
        use crate::ipc::protocol::ModelInfo;
        let mut app = App::new();
        let models = vec![
            ModelInfo { id: "opus-4-8".into(), name: Some("Opus 4.8".into()), description: None },
            ModelInfo { id: "sonnet-5".into(), name: Some("Sonnet 5".into()), description: None },
        ];
        app.open_model_picker("anthropic".into(), "sonnet-5".into(), models);
        assert_eq!(app.prompt.as_ref().unwrap().selected, 1, "current model is pre-selected");

        // Pick Opus (index 0) and submit.
        app.prompt.as_mut().unwrap().selected = 0;
        match app.submit_prompt() {
            Some(PromptOutcome::Model { provider, model }) => {
                assert_eq!(provider, "anthropic");
                assert_eq!(model, "opus-4-8");
            }
            other => panic!("expected a model outcome, got {other:?}"),
        }
        assert!(app.prompt.is_none());

        // Esc on a picker just closes it — core was never blocked.
        app.open_model_picker("anthropic".into(), "opus-4-8".into(), vec![
            ModelInfo { id: "opus-4-8".into(), name: None, description: None },
        ]);
        assert!(app.cancel_prompt().is_none());
        assert!(app.prompt.is_none());
    }

    /// Step 1 of `/model`: the provider picker pre-selects the active provider
    /// and, on submit, resolves to the chosen provider id (not its label).
    #[test]
    fn provider_picker_submits_selected_id() {
        use crate::ipc::protocol::ProviderInfo;
        let mut app = App::new();
        let providers = vec![
            ProviderInfo { id: "anthropic".into(), name: "Anthropic".into(), description: String::new(), has_api_key: true },
            ProviderInfo { id: "openai".into(), name: "OpenAI".into(), description: String::new(), has_api_key: false },
        ];
        app.open_provider_picker(providers, "openai".into());
        assert_eq!(app.prompt.as_ref().unwrap().selected, 1, "current provider is pre-selected");

        app.prompt.as_mut().unwrap().selected = 0;
        match app.submit_prompt() {
            Some(PromptOutcome::Provider { provider }) => assert_eq!(provider, "anthropic"),
            other => panic!("expected a provider outcome, got {other:?}"),
        }
        assert!(app.prompt.is_none());
    }

    /// Typing in a picker filters by substring, resets the cursor to the first
    /// match, and submits the matched id. Enter with no match keeps the modal.
    #[test]
    fn picker_search_filters_and_guards_empty() {
        use crate::ipc::protocol::ProviderInfo;
        let providers = vec![
            ProviderInfo { id: "anthropic".into(), name: "Anthropic".into(), description: String::new(), has_api_key: true },
            ProviderInfo { id: "openai".into(), name: "OpenAI".into(), description: String::new(), has_api_key: true },
            ProviderInfo { id: "gemini".into(), name: "Gemini".into(), description: String::new(), has_api_key: false },
        ];

        let mut app = App::new();
        app.open_provider_picker(providers.clone(), "anthropic".into());
        let p = app.prompt.as_mut().unwrap();
        for c in "gem".chars() {
            p.search_push(c);
        }
        assert_eq!(p.filtered_indices(), vec![2], "only Gemini matches 'gem'");
        assert_eq!(p.selected, 0, "cursor jumps to the first match");
        match app.submit_prompt() {
            Some(PromptOutcome::Provider { provider }) => assert_eq!(provider, "gemini"),
            other => panic!("expected gemini, got {other:?}"),
        }

        // A query that matches nothing: Enter is ignored, the modal stays open.
        app.open_provider_picker(providers, "anthropic".into());
        for c in "zzz".chars() {
            app.prompt.as_mut().unwrap().search_push(c);
        }
        assert!(app.activate_prompt().is_none());
        assert!(app.prompt.is_some(), "no-match Enter keeps the picker open");
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
